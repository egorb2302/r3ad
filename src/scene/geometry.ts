'use client';

/**
 * Размеры тома в единицах сцены и общие для сцены константы.
 *
 * Вынесены отдельно, потому что ими пользуются и неподвижные половины книги, и
 * летящий лист: разойдись у них хоть одна величина — лист в начале переворота
 * не совпал бы с той страницей, которую он собой закрывает.
 */
import * as THREE from 'three';
import { mm, PHYS } from '@/core/units';

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

export const PAPER = '#efe6d4';
export const COVER_COLOR = '#5c2b2b';

/** Толщина блока в единицах сцены по числу листов. */
export const blockThickness = (sheets: number) =>
  Math.max(mm(sheets * PHYS.sheetThicknessMm), MIN_BLOCK);

/**
 * Заглушка под текстуру страницы.
 *
 * Материал с самого начала собирается с картой, даже когда страница ещё не
 * отрисована: если map появляется позже, three пересобирает шейдер, и первый
 * кадр после подстановки текстуры даёт заметную задержку. Один кремовый пиксель
 * стоит ничего и снимает вопрос.
 */
export const BLANK_PAGE = (() => {
  const rgba = new THREE.Color(PAPER).convertLinearToSRGB();
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
  return texture;
})();
