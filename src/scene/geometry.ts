'use client';

/**
 * Размеры тома в единицах сцены и общие для сцены константы.
 *
 * Вынесены отдельно, потому что ими пользуются и неподвижные половины книги, и
 * летящий лист: разойдись у них хоть одна величина — лист в начале переворота
 * не совпал бы с той страницей, которую он собой закрывает.
 *
 * Здесь только числа: ни одного импорта three. На эти размеры ссылается и
 * стеллаж, а на стеллаж — инспектор, то есть обычная панель, которая есть и в
 * плоском режиме. Пока рядом лежала заглушка-текстура, за ней в первую загрузку
 * приезжала вся библиотека рендера; теперь она в blank.ts.
 */
import { PAPERS } from '@/core/theme';
import { DEFAULT_GSM, mm, PHYS, sheetMm } from '@/core/units';

export const TRIM_W = mm(PHYS.trimWidthMm);
export const TRIM_H = mm(PHYS.trimHeightMm);
export const COVER_T = mm(PHYS.coverThicknessMm);
export const SQUARE = mm(PHYS.coverSquareMm);
/** Полужёлоб: от оси корешка до края блока. */
export const GUTTER = mm(PHYS.hingeMm) / 2;

export const COVER_W = TRIM_W + SQUARE;
export const COVER_H = TRIM_H + SQUARE * 2;

/** Блок нулевой толщины вырождается в плоскость — в начале и в конце книги. */
export const MIN_BLOCK = 0.004;

/** Бумага по умолчанию. Тон задаётся темой, но у сцены должен быть цвет и до неё. */
export const PAPER = PAPERS.cream.block;

/**
 * Толщина блока в единицах сцены по числу листов.
 *
 * Плотность бумаги входит сюда вторым аргументом, а не константой: с M6 она
 * настраивается (SPEC §8), и это единственная настройка внешности, от которой
 * книга физически толстеет.
 */
export const blockThickness = (sheets: number, gsm: number = DEFAULT_GSM) =>
  Math.max(mm(sheets * sheetMm(gsm)), MIN_BLOCK);
