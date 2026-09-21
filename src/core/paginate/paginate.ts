/**
 * Разбивка книги на страницы и вывод физических размеров тома.
 *
 * Работаем главами, а не всей книгой сразу: на 400 страницах единый DOM-узел
 * даёт заметный фриз, а по главам между шагами можно отдавать управление
 * браузеру и показывать прогресс. Побочно это правильно и типографски — глава
 * начинается с новой страницы.
 */
import { Compositor } from './compositor';
import { Ledger, shouldEmit, weigh, type LedgerSpan } from './ledger';
import type { Chapter } from '../content';
import { charsPerPage } from '../library/volume';
import type { PageMetrics, TextureProfile, Typography } from '../typography';
import { pagesToSheets, sheetsToThicknessMm } from '../units';

export type { Chapter };

export interface PageRef {
  /** Сквозной номер страницы, с нуля. */
  index: number;
  chapterId: string;
  /** Номер колонки внутри главы — по нему композитор отматывается на нужное место. */
  column: number;
}

export interface ChapterSpan {
  id: string;
  title: string;
  startPage: number;
  pageCount: number;
  /** Число страниц измерено композитором. `false` — оценка по знакам (ленивая вёрстка). */
  exact: boolean;
  /** Все главы до этой измерены: номер её первой страницы окончательный. */
  settled: boolean;
}

export interface PaginationResult {
  key: string;
  /**
   * Книга свёрстана целиком. `false` бывает только у ленивой вёрстки (§21.5):
   * часть глав оценена, число страниц и толщина — тоже оценка, и за этим
   * результатом придёт следующий с тем же `key`.
   */
  exact: boolean;
  pageCount: number;
  sheetCount: number;
  thicknessMm: number;
  pages: PageRef[];
  chapters: ChapterSpan[];
  tookMs: number;
}

/** Дешёвый строковый хэш. Нужен только для инвалидации кэша, не для криптографии. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const ENGINE_VERSION = 1;

/**
 * Ключ кэша разбивки. Совпал — том не перевёрстывается; разошёлся — считаем
 * заново, и толщина книги меняется на глазах. Ровно эта строка отвечает за то,
 * что кегль физически влияет на модель.
 */
export function paginationKey(
  contentHash: string,
  m: PageMetrics,
  t: Typography,
): string {
  return hash([ENGINE_VERSION, contentHash, typographyKey(m, t)].join('|'));
}

/**
 * Ключ одного только набора, без содержимого.
 *
 * Нужен библиотеке. У тома на полке толщина посчитана при каком-то наборе, и
 * узнать, устарела она или нет, можно лишь сравнив наборы, — а `paginationKey`
 * для этого не годится: в нём есть содержимое, и у двух разных книг он разный
 * всегда, даже если набраны они одинаково.
 */
export function typographyKey(m: PageMetrics, t: Typography): string {
  return hash(
    [
      ENGINE_VERSION,
      m.boxWidthPx,
      m.boxHeightPx,
      m.fontSizePx.toFixed(3),
      m.lineHeightPx.toFixed(3),
      t.family,
      t.lang,
      t.hyphens ? 'h' : '-',
      t.justify ? 'j' : '-',
      t.indentEm,
    ].join('|'),
  );
}

export function contentHash(chapters: Chapter[]): string {
  return hash(chapters.map((c) => `${c.id}:${c.html.length}:${c.title}`).join('|'));
}

export interface PaginateOptions {
  onProgress?: (done: number, total: number) => void;
  /** Отмена при быстрой смене кегля: держать в живых имеет смысл только последний запуск. */
  signal?: AbortSignal;
}

type SchedulerWindow = typeof globalThis & { scheduler?: { yield?: () => Promise<void> } };

/**
 * Отдать управление браузеру между главами.
 *
 * Намеренно НЕ requestAnimationFrame: он привязан к отрисовке, а отрисовку
 * тормозит наш же 3D-вьюпорт, и в свёрнутой или фоновой вкладке он просто
 * перестаёт вызываться — вёрстка зависает вместе с ним. Замерено в M0: на
 * скрытой панели пагинация растянулась с полусекунды до шестнадцати.
 *
 * setTimeout работает независимо от кадров и всё равно оставляет браузеру
 * возможность нарисовать прогресс.
 */
const yieldToBrowser = () => {
  const scheduler = (globalThis as SchedulerWindow).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
};

export async function paginate(
  chapters: Chapter[],
  metrics: PageMetrics,
  typography: Typography,
  options: PaginateOptions = {},
): Promise<PaginationResult> {
  const started = performance.now();
  const compositor = new Compositor(metrics, typography);

  const pages: PageRef[] = [];
  const spans: ChapterSpan[] = [];

  try {
    for (let i = 0; i < chapters.length; i++) {
      if (options.signal?.aborted) throw new DOMException('Pagination aborted', 'AbortError');

      const chapter = chapters[i];
      compositor.setContent(chapter.html);
      const columns = compositor.count();

      spans.push({
        id: chapter.id,
        title: chapter.title,
        startPage: pages.length,
        pageCount: columns,
        exact: true,
        settled: true,
      });

      for (let c = 0; c < columns; c++) {
        pages.push({ index: pages.length, chapterId: chapter.id, column: c });
      }

      options.onProgress?.(i + 1, chapters.length);
      // Отдаём кадр браузеру: без этого прогресс не успевает нарисоваться.
      await yieldToBrowser();
    }
  } finally {
    compositor.destroy();
  }

  const sheetCount = pagesToSheets(pages.length);

  return {
    key: paginationKey(contentHash(chapters), metrics, typography),
    exact: true,
    pageCount: pages.length,
    sheetCount,
    thicknessMm: sheetsToThicknessMm(sheetCount),
    pages,
    chapters: spans,
    tookMs: performance.now() - started,
  };
}

/* ─── Ленивая вёрстка (SPEC §21.5) ──────────────────────────────────────── */

/**
 * С какого объёма книга верстается лениво.
 *
 * Знаки — потому что цена вёрстки меряется ими, а не мегабайтами: текст на
 * 3.2 млн знаков весит полтора мегабайта и верстается 1.4 с на десктопе — всё
 * это время на столе нет ни одной страницы. На телефоне та же работа идёт
 * вчетверо-вшестеро дольше, отсюда второй порог. Байты — для книг, у которых
 * дорог не текст, а картинки: их разметка заливается в композитор целиком.
 *
 * Ниже порогов всё по-прежнему: книга верстается разом, числа в ней точные с
 * первой секунды, и смена кегля перевёрстывает её одним движением.
 */
export const LAZY = {
  chars: 1_500_000,
  charsMobile: 500_000,
  sourceBytes: 20 * 1024 * 1024,
  imageBytes: 8 * 1024 * 1024,
} as const;

export function wantsLazy(
  doc: { charCount: number; sourceBytes: number; imageBytes: number },
  profile: TextureProfile,
): boolean {
  return (
    doc.charCount > (profile === 'mobile' ? LAZY.charsMobile : LAZY.chars) ||
    doc.sourceBytes > LAZY.sourceBytes ||
    doc.imageBytes > LAZY.imageBytes
  );
}

export interface LazyOptions extends PaginateOptions {
  /** Глава, на которой стоит читатель. Спрашивается перед каждой главой заново. */
  focus?: () => string | null | undefined;
  /** Промежуточный результат: книгу уже можно листать, числа в ней ещё оценка. */
  onUpdate?: (partial: PaginationResult) => void;
  /** Не чаще какого срока обновлять числа, пока читателя это не касается. */
  everyMs?: number;
  /**
   * Чем мерить главу. По умолчанию — композитором; подменяется в тестах, где
   * вёрстки нет: правила порядка и показа от неё не зависят.
   */
  measure?: (chapter: Chapter) => number;
}

type IdleWindow = typeof globalThis & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

/**
 * Пауза между главами, когда книгу уже читают.
 *
 * До первой страницы спешим (`yieldToBrowser`), после — уступаем: вёрстка
 * главы занимает десятки миллисекунд, и подряд они съедали бы кадры у
 * переворота листа. Простой ждём не дольше 120 мс, а в скрытой вкладке не
 * ждём вовсе — там он не наступает (см. выше про requestAnimationFrame).
 */
const whenIdle = () => {
  const w = globalThis as IdleWindow;
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (hidden || !w.requestIdleCallback) return yieldToBrowser();
  return new Promise<void>((resolve) => w.requestIdleCallback!(() => resolve(), { timeout: 120 }));
};

function resultOf(
  key: string,
  spans: LedgerSpan[],
  exact: boolean,
  tookMs: number,
): PaginationResult {
  const pages: PageRef[] = [];
  for (const span of spans) {
    for (let c = 0; c < span.pageCount; c++) {
      pages.push({ index: pages.length, chapterId: span.id, column: c });
    }
  }
  const sheetCount = pagesToSheets(pages.length);

  return {
    key,
    exact,
    pageCount: pages.length,
    sheetCount,
    thicknessMm: sheetsToThicknessMm(sheetCount),
    pages,
    chapters: spans,
    tookMs,
  };
}

/**
 * Вёрстка, которая не заставляет ждать всю книгу.
 *
 * Первой верстается глава читателя — и книга сразу ложится на стол: остальные
 * главы в ней оценены по знакам (`Ledger`), а страница оценённой главы всё
 * равно печатается настоящей, потому что печать верстает главу сама. Дальше
 * главы измеряются по порядку в простое, оценки заменяются числами, и
 * результат время от времени отдаётся наружу — по правилу `shouldEmit`, которое
 * бережёт страницу под читателем. Последний результат точный и ничем не
 * отличается от того, что дала бы обычная `paginate`.
 */
export async function paginateLazily(
  chapters: Chapter[],
  metrics: PageMetrics,
  typography: Typography,
  options: LazyOptions = {},
): Promise<PaginationResult> {
  const started = performance.now();
  const key = paginationKey(contentHash(chapters), metrics, typography);
  const everyMs = options.everyMs ?? 300;
  const ledger = new Ledger(chapters.map(weigh), charsPerPage(metrics));

  const compositor = options.measure ? null : new Compositor(metrics, typography);
  const measure =
    options.measure ??
    ((chapter: Chapter) => {
      compositor!.setContent(chapter.html);
      return compositor!.count();
    });

  const snapshot = () => resultOf(key, ledger.spans(), ledger.done, performance.now() - started);

  let lastEmit = performance.now();
  let reading = false;

  try {
    for (;;) {
      if (options.signal?.aborted) throw new DOMException('Pagination aborted', 'AbortError');

      // Читателя, про которого ничего не известно, считаем стоящим в начале.
      const focus = Math.max(0, ledger.indexOf(options.focus?.()));
      const index = ledger.next(focus);
      if (index === null) break;

      ledger.resolve(index, measure(chapters[index]));
      options.onProgress?.(ledger.resolved, ledger.size);
      if (ledger.done) break;

      const now = performance.now();
      if (shouldEmit(ledger, index, focus, now - lastEmit, everyMs)) {
        options.onUpdate?.(snapshot());
        lastEmit = now;
        reading = true;
      }

      await (reading ? whenIdle() : yieldToBrowser());
    }
  } finally {
    compositor?.destroy();
  }

  return snapshot();
}
