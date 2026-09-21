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
import { firstChangedPage } from '@/core/paginate/ledger';
import type { PaginationResult } from '@/core/paginate/paginate';
import { PageRenderer } from '@/core/render/pageRenderer';
import { PAPERS, type PaperTint } from '@/core/theme';
import { releaseCanvas } from '@/core/rasterize/svgRasterizer';
import { useBook, type RenderStat } from '@/store/useBook';


interface Entry {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
}

class TextureCache {
  private entries = new Map<number, Entry>();
  private pending = new Map<number, Promise<THREE.Texture | null>>();
  /**
   * Страницы, которые сейчас на экране.
   *
   * Их нельзя вытеснять ни при каком потолке: вытеснение диспозит текстуру и
   * обнуляет холст под ней, то есть страница на экране становится пустой.
   * Ровно это и происходило на телефоне — там потолок четыре, а во время
   * переворота на экране четыре страницы, и первая же приехавшая из
   * предпечати выбивала одну из видимых.
   */
  private pinned = new Set<number>();
  /**
   * Страницы, напечатанные по прежней нумерации (ленивая вёрстка, §21.5).
   *
   * Текстура такой страницы врёт, но если страница на экране, врать ей лучше,
   * чем исчезнуть: старая печать висит, пока не приедет новая, и подмена
   * занимает один кадр вместо чёрного прямоугольника на тридцать миллисекунд.
   */
  private stale = new Set<number>();
  /** Работы, начатые до смены нумерации: их результат уже никому не нужен. */
  private discarded = new WeakSet<object>();
  private tokens = new Map<number, object>();

  constructor(
    private renderer: PageRenderer,
    /**
     * Потолок живых текстур. Приходит из профиля устройства (§6.5): восемь на
     * десктопе, четыре там, где страница и так меньше, а видеопамяти меньше
     * втрое. Ниже четырёх опускаться нельзя ни на каком железе — во время
     * переворота на экране одновременно четыре страницы.
     */
    private limit: number,
    private onStat: (stat: RenderStat) => void,
    private onChange: (size: number) => void,
  ) {}

  /** Что сейчас на экране: это не вытесняется, и на это не считается запас. */
  pin(pages: number[]) {
    this.pinned = new Set(pages);

    // Устаревшая печать жила только ради экрана; ушла с него — ей незачем.
    for (const index of this.stale) {
      if (this.pinned.has(index)) continue;
      const entry = this.entries.get(index);
      if (entry) {
        entry.texture.dispose();
        releaseCanvas(entry.canvas);
        this.entries.delete(index);
      }
      this.stale.delete(index);
    }
  }

  /**
   * Сколько текстур можно занять под запас — сверх экранных.
   *
   * Ноль означает «предпечатать нечего»: всё, что можно держать, занято тем,
   * что видно. Так и должно быть на телефоне во время переворота.
   */
  spare(): number {
    return Math.max(0, this.cap() - this.pinned.size);
  }

  /** Страница напечатана, и напечатана по нынешней нумерации. */
  fresh(index: number): boolean {
    return this.entries.has(index) && !this.stale.has(index);
  }

  /**
   * Та же вёрстка, уточнённые числа: всё, что до страницы `from`, осталось
   * верным, остальное печатается заново. `null` — не изменилось ничего.
   */
  adopt(pagination: PaginationResult, from: number | null) {
    this.renderer.setPagination(pagination);
    if (from === null) return;

    for (const [index, entry] of this.entries) {
      if (index < from) continue;
      if (this.pinned.has(index)) {
        this.stale.add(index);
        continue;
      }
      entry.texture.dispose();
      releaseCanvas(entry.canvas);
      this.entries.delete(index);
    }

    for (const [index, token] of this.tokens) {
      if (index < from) continue;
      this.discarded.add(token);
      this.tokens.delete(index);
      this.pending.delete(index);
    }

    this.onChange(this.entries.size);
  }

  peek(index: number): THREE.Texture | undefined {
    const hit = this.entries.get(index);
    if (!hit) return undefined;
    // Перекладываем в конец — Map хранит порядок вставки, это и есть LRU.
    this.entries.delete(index);
    this.entries.set(index, hit);
    return hit.texture;
  }

  async request(index: number): Promise<THREE.Texture | null> {
    if (this.fresh(index)) return this.peek(index) ?? null;

    const inFlight = this.pending.get(index);
    if (inFlight) return inFlight;

    const token = {};
    this.tokens.set(index, token);

    const job = this.renderer
      .render(index)
      .then((page) => {
        if (this.discarded.has(token)) {
          releaseCanvas(page.canvas);
          return null;
        }

        // Прежняя печать этой страницы дождалась замены — теперь её можно убрать.
        const old = this.entries.get(index);
        if (old) {
          old.texture.dispose();
          releaseCanvas(old.canvas);
          this.entries.delete(index);
        }
        this.stale.delete(index);

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
        if (this.tokens.get(index) === token) {
          this.tokens.delete(index);
          this.pending.delete(index);
        }
      });

    this.pending.set(index, job);
    return job;
  }

  /** Потолок живых текстур. Ниже четырёх не опускается ни на каком железе. */
  private cap(): number {
    return Math.max(4, this.limit);
  }

  /**
   * Вытеснение по LRU, но мимо экранных.
   *
   * Порядок Map — это и есть давность обращения, поэтому идём с начала и
   * пропускаем закреплённые. Потолок при этом не может оказаться ниже числа
   * экранных страниц: лучше подержать на одну текстуру больше, чем стереть
   * страницу, на которую человек смотрит.
   */
  private evict() {
    const cap = Math.max(this.cap(), this.pinned.size);
    for (const [index, entry] of this.entries) {
      if (this.entries.size <= cap) break;
      if (this.pinned.has(index)) continue;
      entry.texture.dispose();
      releaseCanvas(entry.canvas);
      this.entries.delete(index);
    }
  }

  dispose() {
    for (const entry of this.entries.values()) {
      entry.texture.dispose();
      releaseCanvas(entry.canvas);
    }
    this.entries.clear();
    this.pending.clear();
    this.tokens.clear();
    this.stale.clear();
    this.onChange(0);
  }
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

export function usePageTextures(tint: PaperTint, limit = 8): PageTextures {
  const pagination = useBook((s) => s.pagination);
  /*
   * Ключ вёрстки, а не сама разбивка: ленивая вёрстка (§21.5) отдаёт несколько
   * результатов подряд с одним ключом, и пересобирать из-за каждого весь кэш
   * значило бы перепечатывать разворот, на который человек смотрит, раз в треть
   * секунды. Кэш живёт, пока жива вёрстка; уточнения он принимает ниже.
   */
  const layoutKey = pagination?.key ?? null;
  /** Разбивка, по которой напечатано то, что лежит в кэше. */
  const adopted = useRef<PaginationResult | null>(null);
  const metrics = useBook((s) => s.metrics);
  const typography = useBook((s) => s.typography);
  const chapters = useBook((s) => s.doc.chapters);
  const noteRender = useBook((s) => s.noteRender);
  const setLiveTextures = useBook((s) => s.setLiveTextures);

  const cacheRef = useRef<TextureCache | null>(null);
  // Счётчик пробуждений: текстуры приезжают асинхронно, и сцену надо
  // перерисовать ровно тогда, когда очередная встала в кэш.
  const [, bump] = useState(0);

  /**
   * Что сцена просила последним.
   *
   * Нужно новому кэшу, а не старому. Заказ приходит от эффекта во Viewport, и
   * тот перезапускается по развороту — но кэш пересобирается и от того, что
   * разворота не касается: сменился тон бумаги, а он запечён в растр. Тогда
   * заказывать было бы некому: разворот тот же, эффект спит, новый кэш пуст, а
   * на странице висит ссылка на текстуру, выброшенную вместе со старым кэшем, —
   * то есть чёрный прямоугольник. Пусть новый кэш сам печатает то, что просили
   * у предыдущего.
   */
  const wanted = useRef<{ needed: number[]; soon: number[] }>({ needed: [], soon: [] });

  /*
   * Смена разбивки означает, что все прежние текстуры относятся к другой
   * вёрстке. Тон бумаги — тот же случай: он запечён в растр, и страница,
   * напечатанная на кремовой, на состаренной полке была бы заплаткой.
   */
  useEffect(() => {
    const current = useBook.getState().pagination;
    if (!current || !layoutKey) return;

    const renderer = new PageRenderer(chapters, current, metrics, typography, PAPERS[tint]);
    const cache = new TextureCache(renderer, limit, noteRender, setLiveTextures);
    cacheRef.current = cache;
    adopted.current = current;

    // Печатаем то, что было заказано у прежнего кэша. Пробуждение — то же, что
    // и в `request`: текстура приезжает асинхронно, и сцену будит её приезд.
    let alive = true;
    cache.pin(wanted.current.needed);
    for (const index of wanted.current.needed) {
      void cache.request(index).then(() => {
        if (alive) bump((v) => v + 1);
      });
    }

    return () => {
      alive = false;
      cache.dispose();
      renderer.destroy();
      cacheRef.current = null;
    };
  }, [layoutKey, metrics, typography, chapters, tint, limit, noteRender, setLiveTextures]);

  /*
   * Уточнение чисел при той же вёрстке. Страницы до первой разошедшейся
   * остаются как есть; экранные из остальных перепечатываются — и до приезда
   * новой печати на них висит старая (см. `stale`).
   */
  useEffect(() => {
    const cache = cacheRef.current;
    const before = adopted.current;
    if (!cache || !pagination || !before || before === pagination) return;

    adopted.current = pagination;
    const from = firstChangedPage(before, pagination);
    cache.adopt(pagination, from);
    if (from === null) return;

    let alive = true;
    cache.pin(wanted.current.needed);
    for (const index of wanted.current.needed) {
      if (cache.fresh(index)) continue;
      void cache.request(index).then(() => {
        if (alive) bump((v) => v + 1);
      });
    }

    return () => {
      alive = false;
    };
  }, [pagination]);

  const get = useCallback((index: number | null | undefined) => {
    if (typeof index !== 'number' || index < 0) return null;
    return cacheRef.current?.peek(index) ?? null;
  }, []);

  const request = useCallback(
    (needed: (number | null | undefined)[], soon: (number | null | undefined)[] = []) => {
      const cache = cacheRef.current;
      if (!cache) return;

      const want = clean(needed);
      wanted.current = { needed: want, soon: clean(soon) };

      let alive = true;
      const wake = () => {
        if (alive) bump((v) => v + 1);
      };

      // Сначала закрепляем экранные: всё, что печатается следом, не должно их
      // выбить, а запас считается уже от остатка.
      cache.pin(want);
      for (const index of want) {
        if (cache.fresh(index)) continue;
        void cache.request(index).then(wake);
      }

      const idle = requestIdleCallbackSafe(() => {
        if (!alive) return;
        /*
         * Предпечать берёт только свободные места. Без этого счёта она
         * заказывает вчетверо больше, чем кэш может держать, и разница уходит
         * в вытеснение — то есть в стирание уже напечатанного, включая то, что
         * прямо сейчас на экране.
         */
        let room = cache.spare();
        for (const index of clean(soon)) {
          if (room <= 0) break;
          room -= 1;
          if (cache.fresh(index)) continue;
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
