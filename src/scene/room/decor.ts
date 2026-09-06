'use client';

/**
 * Убранство комнаты: из чего оно собрано и как это стоит один drawcall.
 *
 * Горшки, растения, лампа, кружка, стопка книг, полочка, рамка, ковёр,
 * плинтусы — десятки предметов, и у каждого своя форма и свой цвет. Мешем на
 * предмет это стоило бы пятидесяти вызовов отрисовки на фон, который никто не
 * трогает. Поэтому предметы собираются заранее: каждой детали красятся
 * вершины, детали ставятся на место матрицей и сливаются в одну геометрию.
 * Матовая комната целиком — один меш, глянцевые вещи — второй, светящиеся —
 * третий. Три вызова на всё.
 *
 * Формы намеренно простые и скруглённые — шары, капсулы, коробки с фаской:
 * это то, из чего сделаны игрушечные комнаты, и то, что мягкий
 * полусферический свет (см. lighting) превращает в объём без единой карты.
 * Никаких текстур: цвет здесь — свойство вершины, и его меняет пресет света,
 * а не файл.
 *
 * Ассетов, как и везде в проекте, ноль: комната — это список чисел.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CASE_Z, FLOOR_Y } from '../bookcase/caseGeometry';
import type { RoomPalette } from '../lighting';

/** Одна деталь: форма, цвет и где стоит. Углы — в радианах, порядок XYZ. */
export interface Part {
  geometry: THREE.BufferGeometry;
  color: string;
  at?: [number, number, number];
  turn?: [number, number, number];
  size?: number | [number, number, number];
  /** Глянец: керамика, эмаль, глазурь. Остальное матовое. */
  gloss?: boolean;
}

const scratch = {
  matrix: new THREE.Matrix4(),
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  euler: new THREE.Euler(),
  scale: new THREE.Vector3(),
  color: new THREE.Color(),
};

/**
 * Собрать детали в одну геометрию с вершинными цветами.
 *
 * Цвет пишется в атрибут после перевода из sRGB в линейное пространство —
 * это делает сам `Color.set`, — иначе пастель на экране выходила бы выцветшей.
 * Исходные детали после слияния не нужны и освобождаются здесь же.
 */
export function assemble(parts: Part[]): THREE.BufferGeometry {
  const pieces = parts.map((part) => {
    /*
     * Слияние требует, чтобы индекс был либо у всех деталей, либо ни у одной,
     * а скруглённая коробка приходит без него. Разворачиваем все: вершин
     * становится больше, но комната собирается один раз на пресет.
     */
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    if (geometry !== part.geometry) part.geometry.dispose();
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    scratch.color.set(part.color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = scratch.color.r;
      colors[i * 3 + 1] = scratch.color.g;
      colors[i * 3 + 2] = scratch.color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const [x, y, z] = part.at ?? [0, 0, 0];
    const [rx, ry, rz] = part.turn ?? [0, 0, 0];
    const size = part.size ?? 1;
    scratch.position.set(x, y, z);
    scratch.quaternion.setFromEuler(scratch.euler.set(rx, ry, rz));
    if (typeof size === 'number') scratch.scale.set(size, size, size);
    else scratch.scale.set(size[0], size[1], size[2]);
    scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
    geometry.applyMatrix4(scratch.matrix);
    return geometry;
  });

  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('room: nothing to assemble');
  return merged;
}

/* ─── Формы ─────────────────────────────────────────────────────────────── */

const box = (w: number, h: number, d: number, r = Math.min(w, h, d) * 0.18) =>
  new RoundedBoxGeometry(w, h, d, 2, r);
const ball = (r: number) => new THREE.SphereGeometry(r, 14, 10);
const tube = (rTop: number, rBottom: number, h: number, open = false) =>
  new THREE.CylinderGeometry(rTop, rBottom, h, 20, 1, open);
const ring = (r: number, t: number) => new THREE.TorusGeometry(r, t, 8, 20);
const pill = (r: number, h: number) => new THREE.CapsuleGeometry(r, h, 4, 12);

/** Детерминированный разброс: комната обязана быть одной и той же между заходами. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ─── Палитра предметов ─────────────────────────────────────────────────── */

const LEAF = ['#6fae6a', '#5f9d5d', '#86c07e', '#79b573'];
const TERRACOTTA = '#cf7d5b';
const CERAMIC = '#efe6d6';
const SOIL = '#4b3728';
const TEAL = '#3f7f83';
const BOOKS = ['#e07a5f', '#81b29a', '#f2cc8f', '#8e9dcb'];

/** Чуть светлее или темнее того же цвета — для кромок и вкладок. */
function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  const target = k > 0 ? new THREE.Color('#ffffff') : new THREE.Color('#000000');
  return `#${c.lerp(target, Math.abs(k)).getHexString()}`;
}

/* ─── Предметы ──────────────────────────────────────────────────────────── */

/** Горшок с землёй: усечённый конус, венчик и тёмный диск сверху. */
function pot(x: number, y: number, z: number, r: number, h: number, color: string): Part[] {
  return [
    { geometry: tube(r, r * 0.78, h), color, at: [x, y + h / 2, z], gloss: true },
    { geometry: ring(r, r * 0.12), color: shade(color, 0.12), at: [x, y + h, z], turn: [Math.PI / 2, 0, 0], gloss: true },
    { geometry: tube(r * 0.9, r * 0.9, r * 0.14), color: SOIL, at: [x, y + h, z] },
  ];
}

/** Крона из шаров: чем их больше и чем ближе они друг к другу, тем гуще куст. */
function crown(x: number, y: number, z: number, r: number, count: number, seed: number): Part[] {
  const random = rng(seed);
  const out: Part[] = [];
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const spread = r * (0.35 + random() * 0.55);
    const size = r * (0.55 + random() * 0.4);
    out.push({
      geometry: ball(size),
      color: LEAF[Math.floor(random() * LEAF.length)],
      at: [x + Math.cos(a) * spread, y + (random() - 0.3) * r * 0.9, z + Math.sin(a) * spread],
      size: [1, 0.86 + random() * 0.2, 1],
    });
  }
  return out;
}

/** Фикус в кадке: ствол и пышная крона — растение, которое ставят на пол. */
function ficus(x: number, z: number): Part[] {
  const potH = 20;
  const trunk = 34;
  return [
    ...pot(x, FLOOR_Y, z, 11, potH, TERRACOTTA),
    { geometry: tube(1.3, 1.7, trunk), color: '#7a5a3c', at: [x, FLOOR_Y + potH + trunk / 2, z] },
    ...crown(x, FLOOR_Y + potH + trunk + 8, z, 13, 9, 11),
  ];
}

/** Суккулент: горшочек и плотная розетка мелких шаров. */
function succulent(x: number, y: number, z: number): Part[] {
  const random = rng(29);
  const out: Part[] = pot(x, y, z, 4.2, 5.5, CERAMIC);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const rr = i < 6 ? 2.6 : 1.1;
    out.push({
      geometry: ball(1.5 + random() * 0.5),
      color: i < 6 ? '#9bc98c' : '#b7d9a6',
      at: [x + Math.cos(a) * rr, y + 5.5 + 1.3 + (i < 6 ? 0 : 1.4), z + Math.sin(a) * rr],
      size: [1, 0.8, 1],
    });
  }
  return out;
}

/** Кактус: капсула и две руки — под окном ему самое место. */
function cactus(x: number, z: number): Part[] {
  const potH = 12;
  const y = FLOOR_Y + potH;
  return [
    ...pot(x, FLOOR_Y, z, 7.5, potH, CERAMIC),
    { geometry: pill(3.4, 22), color: '#5f9f68', at: [x, y + 14, z] },
    { geometry: pill(2, 7), color: '#6bab72', at: [x - 5.6, y + 16, z], turn: [0, 0, 0.5] },
    { geometry: pill(1.8, 5), color: '#6bab72', at: [x + 5.2, y + 20, z], turn: [0, 0, -0.5] },
  ];
}

/** Стопка книг: три тома разного цвета, слегка вразнобой. */
function stack(x: number, y: number, z: number, w: number, d: number, seed: number): Part[] {
  const random = rng(seed);
  const out: Part[] = [];
  let top = y;
  for (let i = 0; i < 3; i++) {
    const h = 2 + random() * 1.4;
    out.push({
      geometry: box(w - random() * 2, h, d - random() * 2, 0.5),
      color: BOOKS[(seed + i) % BOOKS.length],
      at: [x + (random() - 0.5) * 2, top + h / 2, z + (random() - 0.5) * 2],
      turn: [0, (random() - 0.5) * 0.22, 0],
    });
    top += h;
  }
  return out;
}

/** Кружка: стакан, ручка и тёмное нутро. */
function mug(x: number, y: number, z: number): Part[] {
  return [
    { geometry: tube(4, 3.6, 9.5), color: '#f2c14e', at: [x, y + 4.75, z], gloss: true },
    { geometry: tube(3.5, 3.5, 0.6), color: '#3a2a20', at: [x, y + 9.3, z] },
    { geometry: ring(2.7, 0.75), color: '#f2c14e', at: [x + 4.4, y + 5.2, z], gloss: true },
  ];
}

/** Стакан с карандашами. */
function pencils(x: number, y: number, z: number): Part[] {
  const out: Part[] = [{ geometry: tube(3.4, 3.1, 9, true), color: TEAL, at: [x, y + 4.5, z], gloss: true }];
  out.push({ geometry: tube(3.1, 3.1, 0.4), color: shade(TEAL, -0.5), at: [x, y + 0.3, z] });
  const colors = ['#f4a261', '#e9c46a', '#8ab4f8', '#e76f51'];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    out.push({
      geometry: tube(0.45, 0.45, 15),
      color: colors[i],
      at: [x + Math.cos(a) * 1.6, y + 8.5, z + Math.sin(a) * 1.6],
      turn: [Math.sin(a) * 0.16, 0, -Math.cos(a) * 0.16],
    });
  }
  return out;
}

/**
 * Настольная лампа: основание, стойка, наклонное плечо и купол-абажур.
 *
 * Абажур — полусфера, а не конус: конус с открытым низом читался как воронка,
 * купол с ободом и светящимся кругом в проёме читается лампой с любой стороны.
 * Купол закрыт снизу диском: полусфера с изнанки — дыра, и диск заодно и есть
 * свет — тёплый круг, который красится безо всякого освещения.
 *
 * Купол смотрит на книгу: ключевой свет пресета «лампа» стоит слева-сверху, и
 * лампа на столе слева и есть тот источник.
 */
function lamp(x: number, y: number, z: number): { body: Part[]; glow: Part[] } {
  const post = 24;
  const arm = 24;
  const lean = -0.85;
  const shadeR = 9.5;
  /* Наклон купола: ось смотрит вверх-влево, проём — вниз-вправо, на книгу. */
  const tilt = 0.5;
  const axis: [number, number] = [-Math.sin(tilt), Math.cos(tilt)];

  const top: [number, number] = [x, y + 2.2 + post];
  const tip: [number, number] = [top[0] - Math.sin(lean) * arm, top[1] + Math.cos(lean) * arm];
  const dome: [number, number] = [tip[0] + 2.5, tip[1] + 1];
  const shadeColor = '#efc27b';

  const along = (k: number): [number, number, number] => [dome[0] + axis[0] * k, dome[1] + axis[1] * k, z];

  return {
    body: [
      /* Основание: тяжёлый диск и скруглённый холм под стойкой */
      { geometry: tube(7.5, 8.4, 1.8), color: TEAL, at: [x, y + 0.9, z], gloss: true },
      { geometry: ball(3), color: TEAL, at: [x, y + 1.6, z], size: [1, 0.5, 1], gloss: true },
      { geometry: tube(1.2, 1.2, post), color: TEAL, at: [x, y + 2.2 + post / 2, z], gloss: true },
      /* Шарнир и плечо к книге */
      { geometry: ball(2), color: shade(TEAL, 0.1), at: [top[0], top[1], z], gloss: true },
      {
        geometry: tube(1, 1, arm),
        color: TEAL,
        at: [(top[0] + tip[0]) / 2, (top[1] + tip[1]) / 2, z],
        turn: [0, 0, lean],
        gloss: true,
      },
      { geometry: ball(2), color: shade(TEAL, 0.1), at: [tip[0], tip[1], z], gloss: true },
      /* Купол, обод по проёму и колпачок сверху */
      {
        geometry: new THREE.SphereGeometry(shadeR, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        color: shadeColor,
        at: [dome[0], dome[1], z],
        turn: [0, 0, tilt],
        gloss: true,
      },
      { geometry: tube(shadeR + 0.5, shadeR + 0.5, 1.6, true), color: shade(shadeColor, -0.18), at: along(0), turn: [0, 0, tilt], gloss: true },
      { geometry: ball(1.6), color: shade(shadeColor, -0.18), at: along(shadeR - 0.4), gloss: true },
    ],
    glow: [
      /* Свет в проёме — диск, и лампочка, чуть выглядывающая из-под него */
      { geometry: tube(shadeR - 0.2, shadeR - 0.2, 0.5), color: '#ffe3ad', at: along(-0.4), turn: [0, 0, tilt] },
      { geometry: ball(2.4), color: '#fff3d6', at: along(-1.6), size: [1, 0.7, 1] },
    ],
  };
}

/** Полочка на стене с двумя кронштейнами. */
function wallShelf(x: number, y: number, z: number, w: number, trim: string): Part[] {
  const d = 15;
  return [
    { geometry: box(w, 2.4, d, 0.6), color: trim, at: [x, y, z + d / 2] },
    ...[-w / 2 + 5, w / 2 - 5].map<Part>((dx) => ({
      geometry: box(2, 8, d - 3, 0.4),
      color: trim,
      at: [x + dx, y - 5.2, z + (d - 3) / 2],
    })),
  ];
}

/** Картина в рамке: пастельный прямоугольник и кремовый круг — солнце или луна. */
function picture(x: number, y: number, z: number, trim: string): Part[] {
  return [
    { geometry: box(36, 28, 1.8, 0.4), color: trim, at: [x, y, z] },
    { geometry: box(31, 23, 1.2, 0.2), color: '#e9b08b', at: [x, y, z + 0.6] },
    { geometry: tube(5, 5, 0.5), color: '#fbe9c6', at: [x + 6, y + 3, z + 1.3], turn: [Math.PI / 2, 0, 0] },
    { geometry: box(20, 6, 0.6, 0.2), color: '#c98a6e', at: [x - 2, y - 7, z + 1.35] },
  ];
}

/* ─── Комната ───────────────────────────────────────────────────────────── */

export interface RoomShapes {
  /** Матовое: стены, ковёр, растения, книги — почти всё. */
  matte: THREE.BufferGeometry;
  /** Глянцевое: керамика, лампа, кружка. */
  glossy: THREE.BufferGeometry;
  /** Светящееся: стекло окна, лампочка. Красится безо всякого света. */
  glow: THREE.BufferGeometry;
  /** Деревянное: стол и полочка, под текстуру породы. */
  wood: THREE.BufferGeometry;
  dispose: () => void;
}

/** Задняя стена: за стеллажом, с запасом на его глубину. */
export const WALL_Z = CASE_Z - 24;
/** Боковые стены. */
export const WALL_X = 170;
export const WALL_H = 250;

/**
 * Стол. Книга лежит в нуле, а сам стол сдвинут вправо: слева от него стоит
 * стеллаж, и книге на столе от этого ничего — она там же, где была.
 */
export const DESK = { x: 26, w: 162, d: 80, top: 3.6 } as const;

/**
 * Собрать комнату под палитру пресета.
 *
 * Вызывается на смену света, а не на кадр: слияние двух десятков деталей —
 * несколько миллисекунд, и делать это раз в кадр незачем, а раз на пресет
 * незаметно.
 */
export function buildRoom(palette: RoomPalette): RoomShapes {
  const { wall, rug, trim } = palette;
  const matte: Part[] = [];
  const glossy: Part[] = [];
  const glow: Part[] = [];
  const wood: Part[] = [];

  /* Стены и плинтус */
  matte.push(
    { geometry: new THREE.PlaneGeometry(WALL_X * 2 + 40, WALL_H), color: wall, at: [0, FLOOR_Y + WALL_H / 2, WALL_Z] },
    {
      geometry: new THREE.PlaneGeometry(WALL_Z * -1 + 260, WALL_H),
      color: shade(wall, -0.06),
      at: [-WALL_X, FLOOR_Y + WALL_H / 2, 20],
      turn: [0, Math.PI / 2, 0],
    },
    {
      geometry: new THREE.PlaneGeometry(WALL_Z * -1 + 260, WALL_H),
      color: shade(wall, -0.06),
      at: [WALL_X, FLOOR_Y + WALL_H / 2, 20],
      turn: [0, -Math.PI / 2, 0],
    },
    { geometry: box(WALL_X * 2, 7, 1.6, 0.4), color: trim, at: [0, FLOOR_Y + 3.5, WALL_Z + 0.9] },
    { geometry: box(1.6, 7, 280, 0.4), color: trim, at: [-WALL_X + 0.9, FLOOR_Y + 3.5, 20] },
    { geometry: box(1.6, 7, 280, 0.4), color: trim, at: [WALL_X - 0.9, FLOOR_Y + 3.5, 20] },
  );

  /* Ковёр под столом: кайма и поле */
  matte.push(
    { geometry: box(214, 0.8, 144, 0.4), color: rug, at: [DESK.x, FLOOR_Y + 0.4, 12] },
    { geometry: box(196, 0.9, 126, 0.4), color: shade(rug, 0.14), at: [DESK.x, FLOOR_Y + 0.45, 12] },
  );

  /*
   * Окно за столом: рама, переплёт, подоконник, свет за стеклом.
   *
   * Низкое — подоконник на высоте колена. Из-за стола видна только полоса
   * стены над дальним краем столешницы, и обычное окно, начинающееся выше
   * стола, в рабочий кадр не попадало бы вовсе.
   */
  const wx = DESK.x + 4;
  const wy = 16;
  const ww = 64;
  const wh = 90;
  const wz = WALL_Z + 1;
  matte.push(
    { geometry: box(ww + 8, 4, 3, 0.6), color: trim, at: [wx, wy + wh / 2 + 2, wz] },
    { geometry: box(ww + 8, 4, 3, 0.6), color: trim, at: [wx, wy - wh / 2 - 2, wz] },
    { geometry: box(4, wh + 8, 3, 0.6), color: trim, at: [wx - ww / 2 - 2, wy, wz] },
    { geometry: box(4, wh + 8, 3, 0.6), color: trim, at: [wx + ww / 2 + 2, wy, wz] },
    { geometry: box(1.8, wh, 1.4, 0.3), color: trim, at: [wx, wy, wz + 0.4] },
    { geometry: box(ww, 1.8, 1.4, 0.3), color: trim, at: [wx, wy + 6, wz + 0.4] },
    { geometry: box(ww + 14, 3, 9, 0.6), color: trim, at: [wx, wy - wh / 2 - 5.5, wz + 3] },
  );
  glow.push({ geometry: new THREE.PlaneGeometry(ww, wh), color: palette.glow, at: [wx, wy, wz - 0.6] });

  /* Полочка и картина правее окна; на полочке стопка и суккулент */
  const things: Part[] = [
    ...wallShelf(108, 30, WALL_Z + 1.5, 46, trim),
    ...picture(108, 76, WALL_Z + 1.4, trim),
    ...stack(116, 31.2, WALL_Z + 9, 12, 13, 5),
    ...succulent(98, 31.2, WALL_Z + 9),
    /*
     * Растения на полу. Фикус — в правом углу у окна: между стеллажом и
     * столом он стоял вплотную к боковине и с полки его крона сливалась с
     * краем стеллажа в одно тёмное пятно. В углу ему есть место, и с полки он
     * виден отдельно, справа. Кактус, наоборот, мал и низок — ему в просвете
     * у стола самое место, и стеллаж он не загораживает.
     */
    ...ficus(142, -56),
    ...cactus(-74, -22),
    /*
     * На столе: кружка и стопка справа, суккулент слева, карандаши дальше.
     * Рабочий ракурс показывает от книги примерно по тридцать сантиметров в
     * стороны, и всё, что стоит дальше, видно только с полки или при
     * вращении. Поэтому вещи стоят вплотную к тому месту, где лежит книга,
     * но не заходят на него: у раскрытого тома 31 сантиметр от обреза до
     * обреза плюс место рукам.
     */
    ...mug(37, 0, -24),
    ...pencils(50, 0, -6),
    ...stack(39, 0, 14, 16, 22, 2),
    ...succulent(-36, 0, 16),
  ];
  for (const part of things) (part.gloss ? glossy : matte).push(part);

  /* Лампа слева: корпус глянцевый, лампочка светится сама */
  const light = lamp(-46, 0, -16);
  glossy.push(...light.body);
  glow.push(...light.glow);

  /* Стол: столешница и четыре ноги — под дерево */
  wood.push({ geometry: box(DESK.w, DESK.top, DESK.d, 1.4), color: '#ffffff', at: [DESK.x, -DESK.top / 2, 0] });
  const legH = -FLOOR_Y - DESK.top;
  for (const [lx, lz] of [
    [-DESK.w / 2 + 7, -DESK.d / 2 + 7],
    [DESK.w / 2 - 7, -DESK.d / 2 + 7],
    [-DESK.w / 2 + 7, DESK.d / 2 - 7],
    [DESK.w / 2 - 7, DESK.d / 2 - 7],
  ]) {
    wood.push({
      geometry: box(5.2, legH, 5.2, 1.2),
      color: '#ffffff',
      at: [DESK.x + lx, FLOOR_Y + legH / 2, lz],
    });
  }

  const shapes = {
    matte: assemble(matte),
    glossy: assemble(glossy),
    glow: assemble(glow),
    wood: assemble(wood),
  };

  return {
    ...shapes,
    dispose: () => {
      for (const shape of Object.values(shapes)) shape.dispose();
    },
  };
}

/* ─── Пол ───────────────────────────────────────────────────────────────── */

const planks = new Map<string, THREE.CanvasTexture>();

/**
 * Половая доска: полосы с тёмным швом и сдвигом стыков через ряд.
 *
 * Не породная текстура стеллажа — у той рисунок волокна, а полу с двух метров
 * нужен только ритм досок; всё остальное с такого расстояния сливается.
 */
export function plankTexture(color: string): THREE.CanvasTexture {
  const known = planks.get(color);
  if (known) return known;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const random = rng(77);

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);

  const rows = 4;
  const h = size / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * h;
    ctx.fillStyle = `rgba(0,0,0,${0.04 + random() * 0.05})`;
    if (random() < 0.5) ctx.fillRect(0, y, size, h);
    // Шов между досками и стык, сдвинутый через ряд.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, y, size, 2);
    const joint = ((r % 2) * size) / 2 + random() * size * 0.3;
    ctx.fillRect(joint, y, 2, h);
    // Лёгкие продольные волокна, чтобы доска не была заливкой.
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + random() * 0.04})`;
      ctx.fillRect(0, y + 4 + random() * (h - 8), size, 1);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.repeat.set(4, 4);
  planks.set(color, texture);
  return texture;
}
