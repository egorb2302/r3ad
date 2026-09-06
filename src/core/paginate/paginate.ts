/**
 * Разбивка книги на страницы и вывод физических размеров тома.
 *
 * Работаем главами, а не всей книгой сразу: на 400 страницах единый DOM-узел
 * даёт заметный фриз, а по главам между шагами можно отдавать управление
 * браузеру и показывать прогресс. Побочно это правильно и типографски — глава
 * начинается с новой страницы.
 */
import { Compositor } from './compositor';
import type { Chapter } from '../content';
import type { PageMetrics, Typography } from '../typography';
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
}

export interface PaginationResult {
  key: string;
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
    pageCount: pages.length,
    sheetCount,
    thicknessMm: sheetsToThicknessMm(sheetCount),
    pages,
    chapters: spans,
    tookMs: performance.now() - started,
  };
}
