'use client';

/**
 * Кэш текстур страниц с вытеснением по LRU.
 *
 * Текстура страницы — самый дорогой ресурс проекта: 1024×1452 RGBA с мипами
 * это ~8 МБ. Держать всю книгу невозможно физически, поэтому живут только
 * текущий разворот и соседние. Всё остальное диспозится немедленно — утечка
 * здесь означает вылет вкладки на пятидесятой странице (SPEC §6.5).
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PageRenderer } from '@/core/render/pageRenderer';
import { releaseCanvas } from '@/core/rasterize/svgRasterizer';
import { useBook } from '@/store/useBook';

const MAX_LIVE = 8;

interface Entry {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
}

class TextureCache {
  private entries = new Map<number, Entry>();
  private pending = new Map<number, Promise<THREE.Texture | null>>();

  constructor(
    private renderer: PageRenderer,
    private onStat: (stat: { ms: number; svgKb: number; fontKb: number; fontFiles: string[] }) => void,
    private onSize: (n: number) => void,
  ) {}

  peek(index: number): THREE.Texture | undefined {
    const hit = this.entries.get(index);
    if (!hit) return undefined;
    // Перекладываем в конец — Map хранит порядок вставки, это и есть LRU.
    this.entries.delete(index);
    this.entries.set(index, hit);
    return hit.texture;
  }

  async request(index: number): Promise<THREE.Texture | null> {
    const hit = this.peek(index);
    if (hit) return hit;

    const inFlight = this.pending.get(index);
    if (inFlight) return inFlight;

    const job = this.renderer
      .render(index)
      .then((page) => {
        const texture = new THREE.CanvasTexture(page.canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = 8;
        texture.needsUpdate = true;

        this.entries.set(index, { texture, canvas: page.canvas });
        this.evict();
        this.onStat({ ms: page.ms, svgKb: page.svgKb, fontKb: page.fontKb, fontFiles: page.fontFiles });
        this.onSize(this.entries.size);
        return texture;
      })
      .catch(() => null)
      .finally(() => {
        this.pending.delete(index);
      });

    this.pending.set(index, job);
    return job;
  }

  private evict() {
    while (this.entries.size > MAX_LIVE) {
      const oldest = this.entries.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      const entry = this.entries.get(oldest)!;
      entry.texture.dispose();
      releaseCanvas(entry.canvas);
      this.entries.delete(oldest);
    }
  }

  dispose() {
    for (const entry of this.entries.values()) {
      entry.texture.dispose();
      releaseCanvas(entry.canvas);
    }
    this.entries.clear();
    this.pending.clear();
    this.onSize(0);
  }
}

export interface SpreadTextures {
  left: THREE.Texture | null;
  right: THREE.Texture | null;
  /** Номера страниц разворота, с единицы. null — форзац или конец книги. */
  leftPage: number | null;
  rightPage: number | null;
}

/**
 * Разворот в книге: слева чётная страница предыдущего листа, справа — нечётная
 * текущего. Первый разворот показывает только правую: книга открывается на recto.
 */
export function spreadPages(sheet: number, pageCount: number) {
  const left = 2 * sheet - 1;
  const right = 2 * sheet;
  return {
    left: left >= 0 && left < pageCount ? left : null,
    right: right >= 0 && right < pageCount ? right : null,
  };
}

export function useSpreadTextures(): SpreadTextures {
  const pagination = useBook((s) => s.pagination);
  const metrics = useBook((s) => s.metrics);
  const typography = useBook((s) => s.typography);
  const chapters = useBook((s) => s.book.chapters);
  const sheet = useBook((s) => s.currentSheet);
  const noteRender = useBook((s) => s.noteRender);
  const setLiveTextures = useBook((s) => s.setLiveTextures);

  const cacheRef = useRef<TextureCache | null>(null);
  const [spread, setSpread] = useState<SpreadTextures>({
    left: null,
    right: null,
    leftPage: null,
    rightPage: null,
  });

  // Смена разбивки означает, что все прежние текстуры относятся к другой вёрстке.
  useEffect(() => {
    if (!pagination) return;

    const renderer = new PageRenderer(chapters, pagination, metrics, typography);
    const cache = new TextureCache(renderer, noteRender, setLiveTextures);
    cacheRef.current = cache;

    return () => {
      cache.dispose();
      renderer.destroy();
      cacheRef.current = null;
    };
  }, [pagination, metrics, typography, chapters, noteRender, setLiveTextures]);

  useEffect(() => {
    const cache = cacheRef.current;
    if (!cache || !pagination) return;

    let cancelled = false;
    const { left, right } = spreadPages(sheet, pagination.pageCount);

    setSpread((prev) => ({ ...prev, leftPage: left, rightPage: right }));

    Promise.all([
      left === null ? Promise.resolve(null) : cache.request(left),
      right === null ? Promise.resolve(null) : cache.request(right),
    ]).then(([l, r]) => {
      if (cancelled) return;
      setSpread({ left: l, right: r, leftPage: left, rightPage: right });
    });

    // Соседние развороты готовим в простое, чтобы листание не ждало растеризации.
    const idle = requestIdleCallbackSafe(() => {
      if (cancelled) return;
      for (const ahead of [sheet + 1, sheet - 1]) {
        const next = spreadPages(ahead, pagination.pageCount);
        if (next.left !== null) void cache.request(next.left);
        if (next.right !== null) void cache.request(next.right);
      }
    });

    return () => {
      cancelled = true;
      cancelIdleCallbackSafe(idle);
    };
  }, [sheet, pagination]);

  return spread;
}

/**
 * requestIdleCallback есть не везде (Safari подтянул его недавно), поэтому
 * запасаемся таймером. Тип берём через каст: lib.dom объявляет API не во всех
 * версиях TS, а тянуть @types ради двух вызовов незачем.
 */
type IdleWindow = typeof globalThis & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function requestIdleCallbackSafe(cb: () => void): number {
  const w = window as IdleWindow;
  return w.requestIdleCallback
    ? w.requestIdleCallback(cb, { timeout: 600 })
    : window.setTimeout(cb, 200);
}

function cancelIdleCallbackSafe(handle: number) {
  const w = window as IdleWindow;
  if (w.cancelIdleCallback) w.cancelIdleCallback(handle);
  else window.clearTimeout(handle);
}
