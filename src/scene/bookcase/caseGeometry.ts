'use client';

/**
 * Размеры стеллажа и арифметика полок.
 *
 * Всё в тех же единицах, что и книга: одна единица сцены — сантиметр. Поэтому
 * полка получается той же высоты, что и настоящая, а не «на глаз чтобы влезло»:
 * просвет считается от роста тома, а не наоборот.
 */
import { mm, PHYS } from '@/core/units';
import { COVER_H, COVER_T, COVER_W } from '../geometry';

export const CASE = {
  shelves: 3,
  /**
   * Внутренняя ширина — она же длина полки.
   *
   * Подобрана под демонстрационную библиотеку: сорок томов при наборе по
   * умолчанию занимают около восьмидесяти сантиметров, то есть полторы полки.
   * Полка на всю библиотеку выглядела бы честнее арифметически и хуже глазом —
   * ряд в один этаж читается как линейка, а не как стеллаж.
   */
  innerWidth: 60,
  /** Просвет между полками. Том плюс воздух, чтобы его можно было вынуть. */
  clearance: COVER_H + 4,
  /** Доска: боковины, полки, крышка и дно одной толщины. */
  board: 2.2,
  depth: 24,
  back: 1.2,
} as const;

export const CASE_WIDTH = CASE.innerWidth + CASE.board * 2;
export const CASE_HEIGHT = CASE.shelves * CASE.clearance + (CASE.shelves + 1) * CASE.board;

/** Стеллаж стоит позади стола: с рабочей камеры он виден фоном. */
export const CASE_Z = -78;

/** Плоскость передних кромок полок. */
export const CASE_FRONT = CASE_Z + CASE.depth / 2;

/** Насколько корешки утоплены от передней кромки. Ряд не заподлицо, так живее. */
const SETBACK = 1.4;

/** Центр стоящего тома по глубине. */
export const SHELF_BOOK_Z = CASE_FRONT - SETBACK - COVER_W / 2;

/** Высота настила полки, считая сверху вниз. */
export function shelfSurfaceY(shelf: number): number {
  return CASE.board + (CASE.shelves - 1 - shelf) * (CASE.clearance + CASE.board);
}

/** Левый внутренний край полки в мировых координатах. */
export const SHELF_LEFT = -CASE.innerWidth / 2;

/**
 * Габариты закрытого тома.
 *
 * Толщина приходит снаружи — она и есть содержание книги; высота и глубина
 * одинаковы у всех томов, потому что формат в проекте пока один (SPEC §8,
 * форматы приезжают с кастомизацией). Глубина закрытой книги — это крышка,
 * блок у неё на кант короче.
 */
export const VOLUME_HEIGHT = COVER_H;
export const VOLUME_DEPTH = COVER_W;

/** Толщина блока внутри закрытого тома: том минус две крышки. */
export const blockOfVolume = (thickness: number) =>
  Math.max(mm(PHYS.sheetThicknessMm), thickness - COVER_T * 2);
