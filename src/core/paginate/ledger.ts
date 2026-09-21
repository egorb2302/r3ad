/**
 * Учёт глав при ленивой вёрстке (SPEC §21.5).
 *
 * Большая книга не обязана быть свёрстана целиком, чтобы её начали читать:
 * глава, на которой стоит читатель, верстается первой, остальные — в фоне. Но
 * том — физический предмет, и толщина, номера страниц и оглавление нужны ему
 * сразу. Поэтому у каждой главы здесь одно из двух чисел: измеренное
 * композитором или оценка по знакам, — и сумма обоих даёт книгу, которую уже
 * можно листать.
 *
 * Оценка та же, что у корешка несвёрстанного тома на полке (`charsPerPage`), с
 * одной поправкой: она калибруется. Как только первые главы измерены,
 * отношение «насчитано / оценено» по ним переносится на остальные — и книга,
 * у которой абзацы короче среднего или заголовки через страницу, перестаёт
 * врать о своей толщине уже после нескольких глав, а не в самом конце.
 *
 * Здесь нет ни DOM, ни времени: только арифметика. Порядок вёрстки и момент,
 * когда результат показывают читателю, решаются тоже здесь — это правила, а не
 * механика, и проверяются они без браузера.
 */
import type { Chapter } from '../content';

/** Сколько страницы в среднем занимает иллюстрация. Грубо, и калибровка это правит. */
const IMAGE_PAGES = 0.5;

/** Калибровка не уводит оценку дальше чем вдвое: одна аномальная глава — не закон. */
const CALIBRATION_MIN = 0.5;
const CALIBRATION_MAX = 2;

export interface ChapterWeight {
  id: string;
  title: string;
  chars: number;
  images: number;
}

/** Вес главы: знаки без разметки и число картинок. Base64 внутри тегов в счёт не идёт. */
export function weigh(chapter: Chapter): ChapterWeight {
  return {
    id: chapter.id,
    title: chapter.title,
    chars: chapter.html.replace(/<[^>]*>/g, '').length,
    images: (chapter.html.match(/<img\b/g) ?? []).length,
  };
}

export interface LedgerSpan {
  id: string;
  title: string;
  startPage: number;
  pageCount: number;
  /** Число страниц измерено композитором, а не оценено. */
  exact: boolean;
  /** Все главы до этой измерены: её первая страница уже не сдвинется. */
  settled: boolean;
}

export class Ledger {
  private measured: (number | null)[];
  private raw: number[];

  constructor(
    readonly weights: ChapterWeight[],
    charsPerPage: number,
  ) {
    const perPage = Math.max(1, charsPerPage);
    this.measured = weights.map(() => null);
    // Глава всегда начинается с новой страницы, поэтому округление вверх.
    this.raw = weights.map((w) => Math.max(1, Math.ceil(w.chars / perPage + w.images * IMAGE_PAGES)));
  }

  get size(): number {
    return this.weights.length;
  }

  indexOf(chapterId: string | null | undefined): number {
    return chapterId ? this.weights.findIndex((w) => w.id === chapterId) : -1;
  }

  isExact(index: number): boolean {
    return this.measured[index] !== null;
  }

  /** Сколько глав уже измерено. */
  get resolved(): number {
    return this.measured.reduce<number>((n, m) => (m === null ? n : n + 1), 0);
  }

  get done(): boolean {
    return this.measured.every((m) => m !== null);
  }

  resolve(index: number, pages: number) {
    this.measured[index] = Math.max(1, Math.round(pages));
  }

  /**
   * Поправка к оценке: во сколько раз измеренные главы оказались длиннее
   * оценённых. Пока ничего не измерено — единица.
   */
  calibration(): number {
    let measured = 0;
    let estimated = 0;
    this.measured.forEach((m, i) => {
      if (m === null) return;
      measured += m;
      estimated += this.raw[i];
    });
    if (estimated === 0) return 1;
    return Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, measured / estimated));
  }

  pagesOf(index: number, k = this.calibration()): number {
    return this.measured[index] ?? Math.max(1, Math.round(this.raw[index] * k));
  }

  spans(): LedgerSpan[] {
    const k = this.calibration();
    const spans: LedgerSpan[] = [];
    let start = 0;
    let settled = true;

    this.weights.forEach((w, i) => {
      const pageCount = this.pagesOf(i, k);
      spans.push({
        id: w.id,
        title: w.title,
        startPage: start,
        pageCount,
        exact: this.isExact(i),
        settled,
      });
      start += pageCount;
      if (!this.isExact(i)) settled = false;
    });

    return spans;
  }

  /** Все главы до этой измерены. */
  prefixExact(index: number): boolean {
    for (let i = 0; i < index && i < this.size; i++) if (!this.isExact(i)) return false;
    return true;
  }

  /**
   * Какую главу верстать следующей.
   *
   * Сначала ту, на которой стоит читатель: пока она оценена, у неё могут быть
   * лишние пустые страницы в конце или недоступный хвост. Потом — всё по
   * порядку с начала: главы перед читателем сдвигают его страницу, и чем
   * раньше они измерены, тем раньше нумерация под ним перестанет ездить.
   */
  next(focus: number): number | null {
    if (focus >= 0 && focus < this.size && !this.isExact(focus)) return focus;
    const first = this.measured.findIndex((m) => m === null);
    return first < 0 ? null : first;
  }
}

/**
 * Показывать ли читателю промежуточный результат прямо сейчас.
 *
 * Каждое обновление может сдвинуть страницу под читателем: номера едут, текст
 * перескакивает с левой полосы на правую. Поэтому правило скупое. Сразу — если
 * только что измерена глава читателя: ради этого всё и затевалось. Иначе — не
 * чаще раза в `everyMs` и только когда всё перед читателем уже измерено: тогда
 * обновление меняет толщину и оглавление дальше по книге, а под ним не
 * двигается ничего. Пока перед ним есть оценённые главы, копим молча — и
 * сдвигаем его один раз, а не по разу на главу.
 */
export function shouldEmit(
  ledger: Ledger,
  composed: number,
  focus: number,
  sinceLastMs: number,
  everyMs: number,
): boolean {
  if (composed === focus) return true;
  if (!ledger.prefixExact(Math.max(focus, 0))) return false;
  return sinceLastMs >= everyMs;
}

/* ─── Положение читателя ────────────────────────────────────────────────── */

interface Paged {
  pages: { chapterId: string; column: number }[];
  chapters: { id: string; startPage: number; pageCount: number }[];
}

/** Место в книге, не зависящее от нумерации: глава и колонка в ней. */
export interface Anchor {
  chapterId: string;
  column: number;
  /** Сколько страниц было в главе, когда ставили якорь. */
  of: number;
}

/** Разворот, на котором лежит страница: слева 2s−1, справа 2s (см. `spreadPages`). */
export const sheetOfPage = (page: number) => Math.max(0, Math.ceil(page / 2));

/** Якорь разворота — по левой странице, а на первом развороте по правой. */
export function anchorOf(pagination: Paged, sheet: number): Anchor | null {
  const left = 2 * sheet - 1;
  const ref = pagination.pages[left >= 0 ? left : 0] ?? pagination.pages[2 * sheet];
  if (!ref) return null;
  const span = pagination.chapters.find((c) => c.id === ref.chapterId);
  return { chapterId: ref.chapterId, column: ref.column, of: span?.pageCount ?? 1 };
}

/**
 * Разворот, на котором якорь оказался в новой разбивке.
 *
 * `column` — вёрстка та же, уточнились только числа: колонка в главе остаётся
 * той же колонкой. `fraction` — сменился набор: колонок в главе стало другое
 * число, и сохраняется доля главы, а не номер.
 */
export function sheetOfAnchor(
  pagination: Paged,
  anchor: Anchor,
  mode: 'column' | 'fraction',
): number | null {
  const span = pagination.chapters.find((c) => c.id === anchor.chapterId);
  if (!span) return null;

  const column =
    mode === 'column'
      ? anchor.column
      : Math.round((anchor.column / Math.max(1, anchor.of)) * span.pageCount);

  return sheetOfPage(span.startPage + Math.min(Math.max(column, 0), span.pageCount - 1));
}

/**
 * Первая страница, с которой две разбивки одной вёрстки расходятся.
 *
 * Всё, что до неё, — те же главы в тех же колонках под теми же номерами, и
 * напечатанные текстуры этих страниц остаются верными. `null` — разбивки
 * совпадают целиком.
 */
export function firstChangedPage(
  before: { chapters: { startPage: number; pageCount: number }[] },
  after: { chapters: { startPage: number; pageCount: number }[] },
): number | null {
  const n = Math.max(before.chapters.length, after.chapters.length);
  for (let i = 0; i < n; i++) {
    const a = before.chapters[i];
    const b = after.chapters[i];
    if (!a || !b) return Math.min(a?.startPage ?? Infinity, b?.startPage ?? Infinity);
    if (a.startPage !== b.startPage) return Math.min(a.startPage, b.startPage);
    if (a.pageCount !== b.pageCount) return a.startPage + Math.min(a.pageCount, b.pageCount);
  }
  return null;
}
