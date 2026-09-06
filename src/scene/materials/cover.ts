'use client';

/**
 * Крышка переплёта: карта цвета и карта рельефа.
 *
 * До M6 крышка была цветным параллелепипедом, и этого хватало ровно до того
 * момента, когда цвет стало можно выбирать: одинаковая гладкая коробка в десяти
 * оттенках — это десять коробок, а не десять книг. Материал видно не по цвету,
 * а по тому, как он ловит свет, поэтому здесь две карты, а не одна.
 *
 * Разделение между ними осмысленное. Цвет тома, тиснение и потёртость у каждой
 * книги свои — их печатает `coverArt`, по холсту на книгу. Зерно материала у
 * всех тканевых книг одно и то же — оно живёт серой плиткой на четыре
 * материала, повторяется по крышке и работает картой рельефа. Иначе сорок книг
 * означали бы сорок карт рельефа, отличающихся только зерном, которого никто не
 * различит.
 *
 * Из этого же следует, что рельеф остаётся на месте при смене цвета: тянуть
 * ползунок цвета можно сколько угодно, перерисовывается только карта цвета.
 */
import * as THREE from 'three';
import { paintGrain, paintWear, SHEEN } from '@/core/library/grain';
import { paletteOf, type BookTheme, type CoverMaterial } from '@/core/theme';
import { PHYS } from '@/core/units';

/** Сторона крышки в пикселях холста. Крышка — 151×216 мм, пропорция сохранена. */
const ART_W = 512;
const ART_H = Math.round((ART_W * (PHYS.trimHeightMm + PHYS.coverSquareMm * 2)) /
  (PHYS.trimWidthMm + PHYS.coverSquareMm));
const ART_PER_MM = ART_W / (PHYS.trimWidthMm + PHYS.coverSquareMm);

/** Плитка рельефа: сорок миллиметров переплёта на 256 пикселей. */
const TILE = 256;
const TILE_MM = 40;

const tiles = new Map<CoverMaterial, THREE.CanvasTexture>();

/**
 * Серая плитка зерна — карта рельефа для всех книг этого материала.
 *
 * Нейтральный серый в основе, рисунок — отклонения от него в обе стороны:
 * `bumpMap` в three читает яркость как высоту, и середина шкалы означает
 * «поверхность там, где её задала геометрия».
 */
export function grainTile(material: CoverMaterial): THREE.CanvasTexture {
  const known = tiles.get(material);
  if (known) return known;

  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, TILE, TILE);
  paintGrain(ctx, {
    material,
    w: TILE,
    h: TILE,
    perMm: TILE / TILE_MM,
    seed: 4711,
    // Рельеф сильнее цветного зерна: на карте высот полупрозрачный штрих даёт
    // едва заметную складку, а нужна фактура, которую видно на блике.
    alpha: 2.4,
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  /*
   * Повтор задаётся здесь, а не в материале, и это обязано быть так: плитка
   * одна на все книги этого материала, а `repeat` живёт в текстуре. Ставь его
   * снаружи — и последняя смонтированная крышка задавала бы масштаб зерна всем
   * остальным. Крышка у всех томов одного размера, поэтому число тут одно.
   */
  texture.repeat.set(
    (PHYS.trimWidthMm + PHYS.coverSquareMm) / TILE_MM,
    (PHYS.trimHeightMm + PHYS.coverSquareMm * 2) / TILE_MM,
  );
  tiles.set(material, texture);
  return texture;
}

/** Насколько глубоко материал мнётся. Ткань в три раза заметнее лакированной обложки. */
const BUMP: Record<CoverMaterial, number> = {
  cloth: 0.012,
  leather: 0.02,
  board: 0.009,
  jacket: 0.004,
};

export interface CoverSurface {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  bumpScale: number;
  roughness: number;
  sheen: number;
  clearcoat: number;
}

/* ─── Печать крышки ─────────────────────────────────────────────────────── */

export interface CoverArt {
  theme: BookTheme;
  title: string;
  author: string;
  side: 'front' | 'back';
}

/**
 * Кэш крышек.
 *
 * Ограничен по той же причине, что и кэш обреза: цвет тянут ползунком, и без
 * вытеснения каждый промежуточный оттенок оставлял бы холст в полтора
 * мегапикселя. Ключ — всё, что видно на крышке; например, число страниц в него
 * не входит, и книга не перерисовывается от того, что её листают.
 */
const CACHE_LIMIT = 6;
const arts = new Map<string, THREE.CanvasTexture>();

const artKey = (art: CoverArt) =>
  [
    art.side,
    art.theme.cover.material,
    art.theme.cover.color,
    art.theme.cover.foil,
    art.theme.cover.wear.toFixed(2),
    art.side === 'front' ? art.title : '',
    art.side === 'front' ? art.author : '',
  ].join('|');

export function coverArt(art: CoverArt): THREE.CanvasTexture {
  const key = artKey(art);
  const known = arts.get(key);
  if (known) return known;

  const texture = new THREE.CanvasTexture(paintCover(art));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  if (arts.size >= CACHE_LIMIT) {
    const [oldest, stale] = arts.entries().next().value!;
    stale.dispose();
    arts.delete(oldest);
  }

  arts.set(key, texture);
  return texture;
}

function paintCover(art: CoverArt): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ART_W;
  canvas.height = ART_H;
  const ctx = canvas.getContext('2d')!;

  const { cover } = art.theme;
  const seed = hash(`${art.title}|${art.author}|${art.side}`);

  ctx.fillStyle = cover.color;
  ctx.fillRect(0, 0, ART_W, ART_H);
  paintGrain(ctx, {
    material: cover.material,
    w: ART_W,
    h: ART_H,
    perMm: ART_PER_MM,
    seed,
    // Зерно на карте цвета вполсилы: рельеф оно уже получило плиткой, здесь
    // от него нужен только неровный прокрас.
    alpha: 0.7,
  });

  if (art.side === 'front') paintFace(ctx, art);
  paintWear(ctx, ART_W, ART_H, cover.wear, seed);
  paintShading(ctx);

  return canvas;
}

/**
 * Лицо крышки.
 *
 * Тиснение и печать — разные вещи, и различие здесь не декоративное. Тиснёная
 * строка вдавлена в переплёт: под ней тень, над ней краска фольги, и читается
 * она рельефом. Печать на супер-обложке — просто краска, положенная поверх, и
 * тени у неё нет. Поэтому `foil: 'none'` — это не «без названия», а «название
 * напечатано»: у обложки в мягком переплёте оно именно такое.
 */
function paintFace(ctx: CanvasRenderingContext2D, art: CoverArt) {
  const { foil } = art.theme.cover;
  const palette = paletteOf(art.theme);
  const inset = ART_W * 0.1;

  if (foil !== 'none') {
    // Рамка в две линейки — самая обиходная выкладка переплётной крышки.
    ctx.strokeStyle = palette.foil;
    ctx.lineWidth = Math.max(1, ART_W * 0.004);
    ctx.strokeRect(inset, inset, ART_W - inset * 2, ART_H - inset * 2);
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = Math.max(1, ART_W * 0.002);
    ctx.strokeRect(inset * 1.2, inset * 1.2, ART_W - inset * 2.4, ART_H - inset * 2.4);
    ctx.globalAlpha = 1;
  }

  const ink = foil === 'none' ? printedInk(art.theme.cover.color) : palette.foil;
  const embossed = foil !== 'none';

  const titleSize = ART_W * 0.075;
  const lines = wrap(ctx, art.title, ART_W - inset * 2.8, `600 ${titleSize}px Literata, Georgia, serif`);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let y = ART_H * 0.34 - ((lines.length - 1) * titleSize * 1.2) / 2;
  for (const line of lines.slice(0, 3)) {
    stamp(ctx, line, ART_W / 2, y, ink, embossed);
    y += titleSize * 1.2;
  }

  if (art.author) {
    const authorSize = ART_W * 0.042;
    ctx.font = `400 ${authorSize}px Literata, Georgia, serif`;
    stamp(ctx, art.author, ART_W / 2, ART_H * 0.72, ink, embossed);
  }
}

/**
 * Одна строка на крышке.
 *
 * Вдавленность рисуется тенью со сдвигом вниз-вправо и светом со сдвигом
 * вверх-влево — той же парой, которой она видна на настоящем тиснении при
 * свете слева-сверху. Свет в сцене стоит именно там (см. scene/lighting.ts),
 * иначе рельеф читался бы вывернутым наизнанку.
 */
function stamp(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  embossed: boolean,
) {
  const depth = Math.max(1, ART_W * 0.0035);

  if (embossed) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(text, x + depth, y + depth);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillText(text, x - depth * 0.6, y - depth * 0.6);
  }

  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Краска на обложке: светлая на тёмной бумаге и наоборот — это печать, а не фольга. */
function printedInk(cover: string): string {
  const value = parseInt(cover.replace('#', ''), 16) || 0;
  const luma = ((value >> 16) & 255) * 0.3 + ((value >> 8) & 255) * 0.59 + (value & 255) * 0.11;
  return luma > 128 ? '#20180f' : '#f2ece0';
}

/**
 * Собственная светотень крышки.
 *
 * Кант по периметру и лёгкое затемнение к шарниру — то, что на настоящей книге
 * даёт толщина картона под тканью. Геометрией это стоило бы скруглённых углов
 * на каждом томе; на карте — ничего.
 */
function paintShading(ctx: CanvasRenderingContext2D) {
  const hinge = ctx.createLinearGradient(0, 0, ART_W * 0.14, 0);
  hinge.addColorStop(0, 'rgba(0,0,0,0.3)');
  hinge.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hinge;
  ctx.fillRect(0, 0, ART_W * 0.14, ART_H);

  const rim = Math.max(2, ART_W * 0.012);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = rim;
  ctx.strokeRect(rim / 2, rim / 2, ART_W - rim, ART_H - rim);
}

/** Разбивка названия по ширине крышки. Слова не режем — переносов на переплёте не бывает. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, font: string): string[] {
  ctx.font = font;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Коробка крышки, у которой печатается одна грань.
 *
 * Материалов у неё два, а не шесть, и это не мелочь. `BoxGeometry` приходит
 * с шестью группами, а three рисует группу отдельным вызовом: массив из шести
 * материалов стоил бы шести drawcall'ов на крышку и двенадцати на раскрытый
 * том — ради одной напечатанной стороны. Переразбиваем на три группы, где
 * пять непечатных граней делят один материал: три вызова вместо шести, а
 * лицо по-прежнему одно.
 *
 * Порядок индексов в `BoxGeometry` — +x, −x, +y, −y, +z, −z, по шесть на
 * грань. Наружу у раскрытой книги смотрит −y, то есть четвёртая шестёрка.
 */
export function coverGeometry(width: number, height: number, depth: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.clearGroups();
  geometry.addGroup(0, 18, 0);
  geometry.addGroup(18, 6, 1);
  geometry.addGroup(24, 12, 0);
  return geometry;
}

/** Всё, что нужно материалу крышки: две карты и три числа отражения. */
export function coverSurface(art: CoverArt): CoverSurface {
  const material = art.theme.cover.material;
  const sheen = SHEEN[material];

  return {
    map: coverArt(art),
    bumpMap: grainTile(material),
    bumpScale: BUMP[material],
    roughness: sheen.roughness,
    sheen: sheen.sheen,
    clearcoat: sheen.clearcoat,
  };
}
