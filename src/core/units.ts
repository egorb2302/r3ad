/**
 * Физические размеры книги и перевод их в единицы сцены.
 *
 * Одна единица сцены = 1 см. Книга получается ~15×21×2 — удобные числа для
 * камеры, света и теней, без возни с near/far.
 */

/** Миллиметры → единицы сцены. */
export const mm = (v: number) => v / 10;

export const PHYS = {
  /** Обрезной формат блока. Ближе всего к покетбуку / A5. */
  trimWidthMm: 148,
  trimHeightMm: 210,

  /**
   * Толщина одного листа. Офсет 80 г/м² — примерно 0.10 мм.
   * Отсюда берётся вся толщина тома, см. sheetsToThicknessMm.
   */
  sheetThicknessMm: 0.1,

  /** Переплётный картон. */
  coverThicknessMm: 2.4,

  /** Кант — насколько обложка выступает за блок с трёх сторон. */
  coverSquareMm: 3,

  /** Зазор между блоком и корешком у переплёта. */
  hingeMm: 6,
} as const;

/** Лист = две страницы. Нечётная страница добирается пустой оборотной. */
export const pagesToSheets = (pages: number) => Math.max(1, Math.ceil(pages / 2));

/** Главная формула проекта: число страниц определяет физическую толщину тома. */
export const sheetsToThicknessMm = (sheets: number) => sheets * PHYS.sheetThicknessMm;

/**
 * Толщина блока слева и справа в зависимости от прогресса чтения.
 * Именно это заставляет открытый том выглядеть «прочитанным наполовину».
 */
export function splitBlock(totalSheets: number, currentSheet: number) {
  const clamped = Math.min(Math.max(currentSheet, 0), totalSheets);
  return {
    leftMm: sheetsToThicknessMm(clamped),
    rightMm: sheetsToThicknessMm(totalSheets - clamped),
  };
}
