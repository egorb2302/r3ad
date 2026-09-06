'use client';

/**
 * Заглушка под текстуру страницы — единственное, ради чего размерам книги
 * понадобился бы three. Поэтому она лежит отдельно от них (см. geometry.ts).
 */
import * as THREE from 'three';
import { PAPERS, type PaperTint } from '@/core/theme';

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
