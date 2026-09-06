'use client';

/**
 * Размеры тома в единицах сцены и общие для сцены константы.
 *
 * Вынесены отдельно, потому что ими пользуются и неподвижные половины книги, и
 * летящий лист: разойдись у них хоть одна величина — лист в начале переворота
 * не совпал бы с той страницей, которую он собой закрывает.
 */
import * as THREE from 'three';
import { PAPERS, type PaperTint } from '@/core/theme';
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

/**
 * Заглушка под текстуру страницы.
 *
 * Материал с самого начала собирается с картой, даже когда страница ещё не
 * отрисована: если map появляется позже, three пересобирает шейдер, и первый
 * кадр после подстановки текстуры даёт заметную задержку. Один кремовый пиксель
 * стоит ничего и снимает вопрос.
 *
 * Пикселей теперь три — по одному на тон бумаги, — и держатся они в карте:
 * заглушка живёт столько же, сколько страница, и пересоздавать её на каждое
 * движение ползунка значило бы течь текстурами ровно там, где их меньше всего.
 */
const blanks = new Map<PaperTint, THREE.DataTexture>();

export function blankPage(tint: PaperTint = 'cream'): THREE.DataTexture {
  const known = blanks.get(tint);
  if (known) return known;

  const rgba = new THREE.Color(PAPERS[tint].block).convertLinearToSRGB();
  const texture = new THREE.DataTexture(
    new Uint8Array([
      Math.round(rgba.r * 255),
      Math.round(rgba.g * 255),
      Math.round(rgba.b * 255),
      255,
    ]),
    1,
    1,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  blanks.set(tint, texture);
  return texture;
}
