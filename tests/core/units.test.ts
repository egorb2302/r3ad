import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GSM,
  lastSpread,
  pagesToSheets,
  sheetsToThicknessMm,
  splitBlock,
  spreadPages,
} from '@/core/units';

describe('листы и развороты', () => {
  it('лист — две страницы, нечётная добирается пустой оборотной', () => {
    expect(pagesToSheets(0)).toBe(1);
    expect(pagesToSheets(1)).toBe(1);
    expect(pagesToSheets(2)).toBe(1);
    expect(pagesToSheets(3)).toBe(2);
    expect(pagesToSheets(646)).toBe(323);
  });

  it('последняя страница достижима при любом числе страниц (README, M3)', () => {
    for (let pages = 1; pages <= 60; pages++) {
      const { left, right } = spreadPages(lastSpread(pages), pages);
      expect([left, right]).toContain(pages - 1);
    }
  });

  it('книга открывается на recto: на первом развороте слева пусто', () => {
    expect(spreadPages(0, 10)).toEqual({ left: null, right: 0 });
    expect(spreadPages(1, 10)).toEqual({ left: 1, right: 2 });
  });

  it('за краем книги страниц нет', () => {
    expect(spreadPages(5, 10)).toEqual({ left: 9, right: null });
    expect(spreadPages(6, 10)).toEqual({ left: null, right: null });
  });
});

describe('толщина', () => {
  it('офсет 80 г/м² даёт 0.1 мм на лист — число, от которого считалось всё с M0', () => {
    expect(sheetsToThicknessMm(1)).toBeCloseTo(0.1, 6);
    expect(sheetsToThicknessMm(1, DEFAULT_GSM)).toBeCloseTo(0.1, 6);
    expect(sheetsToThicknessMm(300, 120)).toBeCloseTo(45, 6);
  });

  it('половины блока сходятся в целое и не выходят за края', () => {
    const total = 200;
    for (const sheet of [-5, 0, 37, 200, 999]) {
      const { leftMm, rightMm } = splitBlock(total, sheet);
      expect(leftMm + rightMm).toBeCloseTo(sheetsToThicknessMm(total), 6);
      expect(leftMm).toBeGreaterThanOrEqual(0);
      expect(rightMm).toBeGreaterThanOrEqual(0);
    }
    expect(splitBlock(total, -5).leftMm).toBe(0);
    expect(splitBlock(total, 999).rightMm).toBe(0);
  });
});
