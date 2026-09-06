'use client';

/**
 * Кэш текстур страниц с вытеснением по LRU.
 *
 * Текстура страницы — самый дорогой ресурс проекта: 1024×1452 RGBA с мипами
 * это ~8 МБ. Держать всю книгу невозможно физически, поэтому живут только те
 * страницы, которые сейчас на экране или вот-вот там окажутся. Всё остальное
 * диспозится немедленно — утечка здесь означает вылет вкладки на пятидесятой
 * странице (SPEC §6.5).
 *
 * Наружу отдаётся не «текстуры разворота», а доступ по номеру страницы:
 * во время переворота на экране одновременно четыре страницы — обе неподвижные
 * и обе стороны летящего листа, — и знать, какие именно, должна сцена, а не кэш.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PageRenderer } from '@/core/render/pageRenderer';
import { releaseCanvas } from '@/core/rasterize/svgRasterizer';
import { useBook, type RenderStat } from '@/store/useBook';

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
    private onStat: (stat: RenderStat) => void,
    private onChange: (size: number) => void,
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
        this.onStat({
          ms: page.ms,
          timings: page.timings,
          svgKb: page.svgKb,
          fontKb: page.fontKb,
          fontFiles: page.fontFiles,
        });
        this.onChange(this.entries.size);
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
    this.onChange(0);
  }
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

export interface PageTextures {
  /** Готовая текстура страницы или null, если ещё считается. */
  get: (index: number | null | undefined) => THREE.Texture | null;
  /**
   * Что нужно сейчас и что понадобится следом. Первые считаются сразу,
   * вторые — в простое, чтобы листание не ждало растеризации.
   */
  request: (needed: (number | null | undefined)[], soon?: (number | null | undefined)[]) => void;
}

const clean = (list: (number | null | undefined)[]) =>
  list.filter((i): i is number => typeof i === 'number' && i >= 0);

export function usePageTextures(): PageTextures {
  const pagination = useBook((s) => s.pagination);
  const metrics = useBook((s) => s.metrics);
  const typography = useBook((s) => s.typography);
  const chapters = useBook((s) => s.doc.chapters);
  const noteRender = useBook((s) => s.noteRender);
  const setLiveTextures = useBook((s) => s.setLiveTextures);

  const cacheRef = useRef<TextureCache | null>(null);
  // Счётчик пробуждений: текстуры приезжают асинхронно, и сцену надо
  // перерисовать ровно тогда, когда очередная встала в кэш.
  const [, bump] = useState(0);

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

  const get = useCallback((index: number | null | undefined) => {
    if (typeof index !== 'number' || index < 0) return null;
    return cacheRef.current?.peek(index) ?? null;
  }, []);

  const request = useCallback(
    (needed: (number | null | undefined)[], soon: (number | null | undefined)[] = []) => {
      const cache = cacheRef.current;
      if (!cache) return;

      let alive = true;
      const wake = () => {
        if (alive) bump((v) => v + 1);
      };

      for (const index of clean(needed)) {
        if (cache.peek(index)) continue;
        void cache.request(index).then(wake);
      }

      const idle = requestIdleCallbackSafe(() => {
        if (!alive) return;
        for (const index of clean(soon)) {
          if (cache.peek(index)) continue;
          void cache.request(index).then(wake);
        }
      });

      return () => {
        alive = false;
        cancelIdleCallbackSafe(idle);
      };
    },
    [],
  );

  return { get, request };
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
