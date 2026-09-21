import { describe, expect, it } from 'vitest';
import type { Chapter } from '@/core/content';
import {
  anchorOf,
  firstChangedPage,
  Ledger,
  sheetOfAnchor,
  sheetOfPage,
  shouldEmit,
  weigh,
} from '@/core/paginate/ledger';
import { LAZY, paginateLazily, wantsLazy, type PaginationResult } from '@/core/paginate/paginate';
import { computeMetrics, DEFAULT_TYPOGRAPHY } from '@/core/typography';
import { spreadPages } from '@/core/units';

const chapter = (i: number, chars: number, images = 0): Chapter => ({
  id: `c${i}`,
  title: `Chapter ${i}`,
  html: `<h1>Chapter ${i}</h1><p>${'x'.repeat(chars)}</p>${'<img src="data:image/png;base64,AAAA" width="10" height="10">'.repeat(images)}`,
});

/** Разбивка из чисел страниц по главам — в том виде, в каком её видят якоря. */
const paged = (counts: number[]) => {
  const pages: { chapterId: string; column: number }[] = [];
  const chapters = counts.map((pageCount, i) => {
    const startPage = pages.length;
    for (let c = 0; c < pageCount; c++) pages.push({ chapterId: `c${i}`, column: c });
    return { id: `c${i}`, startPage, pageCount };
  });
  return { pages, chapters };
};

describe('учёт глав', () => {
  it('вес главы — знаки без разметки и картинки; base64 в счёт не идёт', () => {
    const w = weigh(chapter(3, 1000, 2));
    expect(w).toMatchObject({ id: 'c3', title: 'Chapter 3', images: 2 });
    expect(w.chars).toBe('Chapter 3'.length + 1000);
  });

  it('оценка — знаки на страницу с округлением вверх, картинка — полстраницы', () => {
    const ledger = new Ledger([chapter(0, 2500), chapter(1, 10), chapter(2, 1000, 3)].map(weigh), 1000);
    expect(ledger.spans().map((s) => s.pageCount)).toEqual([3, 1, 3]);
    expect(ledger.spans().map((s) => s.startPage)).toEqual([0, 3, 4]);
    expect(ledger.spans().every((s) => !s.exact)).toBe(true);
    // Первая глава стоит на первой странице при любых оценках.
    expect(ledger.spans().map((s) => s.settled)).toEqual([true, false, false]);
    expect(ledger.done).toBe(false);
  });

  it('измеренные главы калибруют оценку остальных — но не дальше чем вдвое', () => {
    const ledger = new Ledger([0, 1, 2, 3].map((i) => weigh(chapter(i, 9_990))), 1000);
    expect(ledger.pagesOf(3)).toBe(10);

    ledger.resolve(0, 12);
    expect(ledger.calibration()).toBeCloseTo(1.2);
    expect(ledger.spans().map((s) => s.pageCount)).toEqual([12, 12, 12, 12]);

    ledger.resolve(1, 80);
    expect(ledger.calibration()).toBe(2);
    expect(ledger.pagesOf(2)).toBe(20);

    expect(ledger.spans().map((s) => [s.exact, s.settled])).toEqual([
      [true, true],
      [true, true],
      [false, true],
      [false, false],
    ]);
  });

  it('первой верстается глава читателя, потом всё по порядку с начала', () => {
    const ledger = new Ledger([0, 1, 2, 3, 4].map((i) => weigh(chapter(i, 100))), 1000);
    const order: number[] = [];
    for (let next = ledger.next(3); next !== null; next = ledger.next(3)) {
      order.push(next);
      ledger.resolve(next, 1);
    }
    expect(order).toEqual([3, 0, 1, 2, 4]);
    expect(ledger.done).toBe(true);
    expect(ledger.resolved).toBe(5);
  });

  it('результат показывают сразу после главы читателя, а дальше — только когда под ним ничего не сдвинется', () => {
    const ledger = new Ledger([0, 1, 2, 3].map((i) => weigh(chapter(i, 100))), 1000);

    ledger.resolve(2, 1);
    expect(shouldEmit(ledger, 2, 2, 0, 300)).toBe(true);

    // Перед читателем есть оценённые главы: копим молча, сколько бы ни прошло.
    ledger.resolve(0, 1);
    expect(shouldEmit(ledger, 0, 2, 10_000, 300)).toBe(false);

    // Всё перед ним измерено: теперь по таймеру.
    ledger.resolve(1, 1);
    expect(shouldEmit(ledger, 1, 2, 100, 300)).toBe(false);
    expect(shouldEmit(ledger, 1, 2, 300, 300)).toBe(true);
  });
});

describe('место читателя', () => {
  it('страница лежит на том развороте, который её показывает', () => {
    for (let page = 0; page < 40; page++) {
      const { left, right } = spreadPages(sheetOfPage(page), 40);
      expect([left, right]).toContain(page);
    }
  });

  it('уточнились числа — колонка в главе остаётся той же колонкой', () => {
    const before = paged([4, 10, 6]);
    const anchor = anchorOf(before, sheetOfPage(4 + 7))!;
    expect(anchor).toEqual({ chapterId: 'c1', column: 7, of: 10 });

    // Первая глава оказалась длиннее оценки, а глава читателя — короче.
    const after = paged([9, 8, 6]);
    expect(sheetOfAnchor(after, anchor, 'column')).toBe(sheetOfPage(9 + 7));
    // Колонки, которой в главе больше нет, не бывает: встаём на последнюю.
    expect(sheetOfAnchor(paged([9, 5, 6]), anchor, 'column')).toBe(sheetOfPage(9 + 4));
  });

  it('сменился набор — сохраняется доля главы, а не номер колонки', () => {
    const anchor = anchorOf(paged([4, 10, 6]), sheetOfPage(4 + 5))!;
    expect(anchor.column).toBe(5);
    expect(sheetOfAnchor(paged([6, 20, 9]), anchor, 'fraction')).toBe(sheetOfPage(6 + 10));
    expect(sheetOfAnchor(paged([6]), anchor, 'fraction')).toBeNull();
  });

  it('первый разворот якорится правой страницей, пустая книга — ничем', () => {
    expect(anchorOf(paged([3]), 0)).toEqual({ chapterId: 'c0', column: 0, of: 3 });
    expect(anchorOf(paged([]), 0)).toBeNull();
  });

  it('первая разошедшаяся страница: до неё текстуры остаются верными', () => {
    expect(firstChangedPage(paged([4, 10, 6]), paged([4, 10, 6]))).toBeNull();
    // Глава выросла: её первые десять страниц те же, расходится одиннадцатая.
    expect(firstChangedPage(paged([4, 10, 6]), paged([4, 12, 6]))).toBe(14);
    // Глава сжалась: расходится с первой исчезнувшей.
    expect(firstChangedPage(paged([4, 10, 6]), paged([4, 7, 6]))).toBe(11);
    expect(firstChangedPage(paged([4, 10]), paged([4, 10, 6]))).toBe(14);
  });
});

describe('ленивая вёрстка', () => {
  const metrics = computeMetrics(DEFAULT_TYPOGRAPHY, 'desktop');

  it('порог — по знакам (на телефоне ниже), по файлу и по картинкам', () => {
    const small = { charCount: 700_000, sourceBytes: 600_000, imageBytes: 0 };
    expect(wantsLazy(small, 'desktop')).toBe(false);
    expect(wantsLazy(small, 'mobile')).toBe(true);
    expect(wantsLazy({ ...small, charCount: LAZY.chars + 1 }, 'desktop')).toBe(true);
    expect(wantsLazy({ ...small, sourceBytes: LAZY.sourceBytes + 1 }, 'desktop')).toBe(true);
    expect(wantsLazy({ ...small, imageBytes: LAZY.imageBytes + 1 }, 'desktop')).toBe(true);
  });

  it('книга ложится на стол после главы читателя; итог точный и полный', async () => {
    const chapters = Array.from({ length: 10 }, (_, i) => chapter(i, 3000));
    const measured: string[] = [];
    const updates: PaginationResult[] = [];

    const result = await paginateLazily(chapters, metrics, DEFAULT_TYPOGRAPHY, {
      focus: () => 'c6',
      everyMs: 0,
      measure: (c) => {
        measured.push(c.id);
        return 3 + (Number(c.id.slice(1)) % 3);
      },
      onUpdate: (partial) => updates.push(partial),
    });

    expect(measured).toEqual(['c6', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c7', 'c8', 'c9']);

    // Первое обновление — сразу после главы читателя, и она в нём точная.
    expect(updates[0].exact).toBe(false);
    expect(updates[0].chapters.filter((c) => c.exact).map((c) => c.id)).toEqual(['c6']);
    expect(updates[0].pages).toHaveLength(updates[0].pageCount);

    // Второе — только когда всё перед читателем измерено: сдвиг под ним один.
    expect(updates[1].chapters.filter((c) => c.exact).map((c) => c.id)).toEqual(
      ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
    );
    expect(updates[1].chapters[6].settled).toBe(true);
    expect(updates).toHaveLength(4);
    expect(new Set(updates.map((u) => u.key))).toEqual(new Set([result.key]));

    expect(result.exact).toBe(true);
    expect(result.chapters.every((c) => c.exact && c.settled)).toBe(true);
    expect(result.pageCount).toBe(chapters.reduce((n, _, i) => n + 3 + (i % 3), 0));
    expect(result.pages.map((p) => p.index)).toEqual(result.pages.map((_, i) => i));
    expect(result.pages[result.chapters[6].startPage]).toMatchObject({ chapterId: 'c6', column: 0 });
  });

  it('читатель перешёл в другую главу — следующей верстается она', async () => {
    const chapters = Array.from({ length: 6 }, (_, i) => chapter(i, 3000));
    const measured: string[] = [];
    let reader = 'c0';

    await paginateLazily(chapters, metrics, DEFAULT_TYPOGRAPHY, {
      focus: () => reader,
      measure: (c) => {
        measured.push(c.id);
        if (c.id === 'c1') reader = 'c4';
        return 2;
      },
    });

    expect(measured).toEqual(['c0', 'c1', 'c4', 'c2', 'c3', 'c5']);
  });

  it('отмена останавливает вёрстку', async () => {
    const chapters = Array.from({ length: 6 }, (_, i) => chapter(i, 3000));
    const controller = new AbortController();
    let count = 0;

    await expect(
      paginateLazily(chapters, metrics, DEFAULT_TYPOGRAPHY, {
        signal: controller.signal,
        measure: () => {
          if (++count === 2) controller.abort();
          return 2;
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(count).toBe(2);
  });
});
