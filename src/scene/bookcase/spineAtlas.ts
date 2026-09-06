'use client';

/**
 * Корешки: один атлас на всю полку.
 *
 * Ради инстансинга (SPEC §7.3, бюджет — меньше 150 drawcall'ов на стеллаж из
 * шестидесяти книг) у всех томов обязан быть один материал, а значит и одна
 * карта. Поэтому корешок каждой книги рисуется в свою клетку общего холста, а
 * меш получает координаты клетки инстансным атрибутом. Сорок корешков стоят
 * одного drawcall'а.
 *
 * Альтернатива — `troika-three-text`, как записано в спецификации, — даёт SDF и
 * идеальную чёткость на любом приближении, но это сорок отдельных мешей поверх
 * сорока корешков, зависимость на полторы сотни килобайт и своя загрузка
 * шрифта. На полке, где корешок занимает два десятка пикселей по ширине, эта
 * чёткость не видна, а drawcall'ы видны. Взяли атлас; вернуться к SDF стоит,
 * если появится режим «полка крупным планом».
 *
 * Ещё одна причина: холст умеет то, чего text-меш не умеет вовсе, — печатать
 * корешок целиком. Ткань, выпуклость, каптал, накладку под название и тиснение,
 * то есть всё, из чего корешок узнаётся, а не только буквы.
 */
import * as THREE from 'three';
import { paintGrain, paintWear } from '@/core/library/grain';
import type { VolumeRecord } from '@/core/library/volume';
import { paletteOf, PAPERS, stamped, type BookTheme } from '@/core/theme';
import { VOLUME_HEIGHT } from './caseGeometry';

const ATLAS = 2048;
const CELL_W = 128;
const CELL_H = 512;
const COLS = ATLAS / CELL_W;
const ROWS = ATLAS / CELL_H;
export const ATLAS_CAPACITY = COLS * ROWS;

/**
 * Поля клетки, из которых берут цвет остальные грани тома.
 *
 * Инстансный меш — это коробка с одной картой, и красить её грани по-разному
 * больше нечем: слева в клетке лежит ткань крышек, справа — бумага обреза,
 * между ними печатается сам корешок. Заодно поля работают защитой от растекания
 * соседних клеток при мипмаппинге.
 */
const FACE_U0 = 0.1;
const FACE_U1 = 0.9;
export const CLOTH_SWATCH: [number, number] = [0.05, 0.5];
export const PAPER_SWATCH: [number, number] = [0.95, 0.5];
export const FACE_U: [number, number] = [FACE_U0, FACE_U1];

/** Единиц на сантиметр в системе координат корешка. Единица — десятая доля миллиметра. */
const U = 100;

/**
 * Шаг квантования толщины.
 *
 * Клетка перерисовывается, когда меняется пропорция корешка, — а она меняется
 * от кегля, то есть на каждом движении ползунка. Полмиллиметра разницы в
 * пропорции глазом не берётся, а перерисовку сорока клеток экономит.
 */
const THICKNESS_STEP = 0.05;

export interface AtlasCell {
  u0: number;
  v0: number;
  du: number;
  dv: number;
}

interface Slot {
  index: number;
  cell: AtlasCell;
  key: string;
}

function cellOf(index: number): AtlasCell {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return {
    u0: (col * CELL_W) / ATLAS,
    // v растёт снизу вверх, строки холста — сверху вниз.
    v0: 1 - ((row + 1) * CELL_H) / ATLAS,
    du: CELL_W / ATLAS,
    dv: CELL_H / ATLAS,
  };
}

class SpineAtlas {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private slots = new Map<string, Slot>();
  /** Порядок обращения — по нему вытесняется самая давняя клетка, если атлас полон. */
  private recent: string[] = [];

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS;
    this.canvas.height = ATLAS;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
  }

  /** Клетка под корешок этого тома при этой толщине. Рисуется по требованию. */
  cellFor(volume: VolumeRecord, thickness: number): AtlasCell {
    const quantized = Math.max(THICKNESS_STEP, Math.round(thickness / THICKNESS_STEP) * THICKNESS_STEP);
    /*
     * В ключ входит вся тема целиком, а не один цвет: с M6 корешок меняется и
     * от материала, и от тиснения, и от потёртости, и от краски среза. Дешевле
     * сравнить полсотни знаков, чем однажды не перерисовать клетку.
     */
    const key = `${volume.title}|${volume.author}|${JSON.stringify(volume.theme)}|${quantized.toFixed(2)}`;

    const known = this.slots.get(volume.id);
    this.touch(volume.id);

    if (known && known.key === key) return known.cell;

    const index = known?.index ?? this.claim();
    const slot: Slot = { index, cell: cellOf(index), key };
    this.slots.set(volume.id, slot);

    this.paint(index, volume, quantized);
    this.texture.needsUpdate = true;
    return slot.cell;
  }

  private touch(id: string) {
    const at = this.recent.indexOf(id);
    if (at >= 0) this.recent.splice(at, 1);
    this.recent.push(id);
  }

  /** Свободный номер клетки, а если свободных нет — самый давно не нужный. */
  private claim(): number {
    if (this.slots.size < ATLAS_CAPACITY) return this.slots.size;

    const victim = this.recent.find((id) => id !== this.recent[this.recent.length - 1]);
    const slot = victim ? this.slots.get(victim) : undefined;
    if (victim && slot) {
      this.slots.delete(victim);
      this.recent.splice(this.recent.indexOf(victim), 1);
      return slot.index;
    }
    return 0;
  }

  /**
   * Печать корешка.
   *
   * Рисуем в координатах самого корешка — в десятых долях миллиметра, — а
   * несовпадение пропорций клетки и книги снимает неравномерный масштаб холста.
   * Отображение «клетка → грань» ему в точности обратно, поэтому буквы на
   * тонком томе не растягиваются: они просто мельче, как и на бумажном.
   */
  private paint(index: number, volume: VolumeRecord, thickness: number) {
    const ctx = this.ctx;
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const x0 = col * CELL_W;
    const y0 = row * CELL_H;

    const theme = volume.theme;
    const { cloth, panel, foil, head } = paletteOf(theme);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, CELL_W, CELL_H);
    ctx.clip();

    // Поля: слева ткань крышек, справа обрез. Обрез — не всегда бумага: у
    // крашеного и золочёного тома его видно с полки, и красить его надо там же,
    // где и всё остальное, иначе книга на полке и книга на столе разойдутся.
    ctx.fillStyle = cloth;
    ctx.fillRect(x0, y0, CELL_W, CELL_H);
    ctx.fillStyle = edgeSwatch(theme);
    ctx.fillRect(x0 + CELL_W * FACE_U1, y0, CELL_W * (1 - FACE_U1), CELL_H);

    // Дальше — координаты корешка: x поперёк, y от головки к хвосту.
    const T = thickness * U;
    const H = VOLUME_HEIGHT * U;
    const faceX = x0 + CELL_W * FACE_U0;
    const faceW = CELL_W * (FACE_U1 - FACE_U0);

    ctx.translate(faceX, y0);
    ctx.scale(faceW / T, CELL_H / H);

    ctx.fillStyle = cloth;
    ctx.fillRect(0, 0, T, H);

    /*
     * Фактура — та же функция, что печатает крышку тома на столе (core/grain).
     * Один рисунок на два масштаба: иначе книга, снятая с полки, оказывалась бы
     * из другого материала, чем корешок, который на неё показывал.
     */
    paintGrain(this.ctx, {
      material: theme.cover.material,
      w: T,
      h: H,
      // Единица координат корешка — десятая доля миллиметра (см. U).
      perMm: 10,
      seed: volume.charCount + volume.title.length * 7919,
    });

    this.paintBands(T, H, head);
    this.paintPanel(T, H, panel, foil);
    if (stamped(theme)) this.paintText(T, H, volume, foil);
    paintWear(this.ctx, T, H, theme.cover.wear, volume.title.length * 131 + 7);
    this.paintRelief(T, H);

    ctx.restore();
  }

  /** Каптал у головки и хвоста — полосатая тесьма, которой закрыт край блока. */
  private paintBands(T: number, H: number, head: string) {
    const ctx = this.ctx;
    const band = Math.min(34, H * 0.016);

    for (const y of [0, H - band]) {
      ctx.fillStyle = head;
      ctx.fillRect(0, y, T, band);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let x = 0; x < T; x += 14) ctx.fillRect(x, y, 6, band);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, y === 0 ? band : y - 2, T, 2);
    }
  }

  /** Накладка под название и линейки, которыми набирают поле корешка. */
  private paintPanel(T: number, H: number, panel: string, foil: string) {
    const ctx = this.ctx;
    const inset = T * 0.11;

    ctx.fillStyle = panel;
    ctx.fillRect(inset, H * 0.15, T - inset * 2, H * 0.47);

    ctx.fillStyle = foil;
    for (const y of [H * 0.13, H * 0.64, H * 0.77, H * 0.93]) {
      ctx.fillRect(inset, y, T - inset * 2, Math.max(2, T * 0.012));
    }
  }

  /**
   * Название и автор вдоль корешка.
   *
   * Читается сверху вниз — так набирают английские и американские издания;
   * европейская традиция снизу вверх осталась бы в другую сторону, и в одном
   * ряду это выглядело бы разнобоем.
   */
  private paintText(T: number, H: number, volume: VolumeRecord, foil: string) {
    const ctx = this.ctx;

    ctx.save();
    ctx.rotate(Math.PI / 2);
    // После поворота: x — вдоль корешка от головки, y — поперёк, к левой кромке.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    this.stamp(volume.title, {
      along: H * 0.385,
      across: -T * 0.5,
      size: Math.min(Math.max(T * 0.44, 30), 150),
      minSize: T * 0.24,
      limit: H * 0.44,
      weight: 600,
      color: foil,
    });

    this.stamp(volume.author, {
      along: H * 0.85,
      across: -T * 0.5,
      size: Math.min(Math.max(T * 0.3, 22), 100),
      minSize: T * 0.18,
      limit: H * 0.13,
      weight: 400,
      color: foil,
    });

    ctx.restore();
  }

  /**
   * Одна строка тиснения.
   *
   * Кегль подбирается под длину: сначала уменьшаем, а если и в минимальном
   * строка не влезает — обрезаем. Корешок, у которого название вылезло за поле,
   * читается как ошибка вёрстки, а не как длинное название.
   */
  private stamp(
    text: string,
    options: {
      along: number;
      across: number;
      size: number;
      minSize: number;
      limit: number;
      weight: number;
      color: string;
    },
  ) {
    const ctx = this.ctx;
    const font = (size: number) => `${options.weight} ${size}px Literata, Georgia, serif`;

    let size = options.size;
    ctx.font = font(size);
    let width = ctx.measureText(text).width;

    if (width > options.limit) {
      size = Math.max(options.minSize, (size * options.limit) / width);
      ctx.font = font(size);
      width = ctx.measureText(text).width;
    }

    let line = text;
    while (width > options.limit && line.length > 1) {
      line = line.slice(0, -1);
      width = ctx.measureText(`${line}…`).width;
    }
    if (line !== text) line = `${line}…`;

    // Тиснение — вдавленный след плюс краска. Отсюда и объём на плоской карте.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(line, options.along + size * 0.05, options.across + size * 0.06);
    ctx.fillStyle = options.color;
    ctx.fillText(line, options.along, options.across);
  }

  /**
   * Свет на круглёном корешке — последним слоем, поверх накладки и тиснения.
   *
   * Середина ловит блик, кромки у шарниров уходят в тень. Геометрией такое
   * стоило бы лишних вершин на каждом из сорока томов; градиентом — ничего, и
   * ложится он ровно так же, как на бумажном корешке: на всё сразу.
   */
  private paintRelief(T: number, H: number) {
    const ctx = this.ctx;

    const round = ctx.createLinearGradient(0, 0, T, 0);
    round.addColorStop(0, 'rgba(0,0,0,0.42)');
    round.addColorStop(0.16, 'rgba(0,0,0,0.1)');
    round.addColorStop(0.44, 'rgba(255,255,255,0.11)');
    round.addColorStop(0.7, 'rgba(0,0,0,0.08)');
    round.addColorStop(1, 'rgba(0,0,0,0.44)');
    ctx.fillStyle = round;
    ctx.fillRect(0, 0, T, H);

    const hinge = ctx.createLinearGradient(0, 0, T, 0);
    hinge.addColorStop(0, 'rgba(20,12,6,0.5)');
    hinge.addColorStop(0.07, 'rgba(20,12,6,0)');
    hinge.addColorStop(0.93, 'rgba(20,12,6,0)');
    hinge.addColorStop(1, 'rgba(20,12,6,0.5)');
    ctx.fillStyle = hinge;
    ctx.fillRect(0, 0, T, H);
  }

  dispose() {
    this.texture.dispose();
    this.slots.clear();
    this.recent = [];
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

let shared: SpineAtlas | null = null;

/** Атлас один на страницу: инстансинг ради того и затевался. */
export function spineAtlas(): SpineAtlas {
  shared ??= new SpineAtlas();
  return shared;
}

/**
 * Цвет граней обреза для развёртки закрытого тома.
 *
 * Одна точка карты на три грани — головку, хвост и передний обрез, — поэтому
 * рисунка тут быть не может, только краска. Мрамор с полки и не разглядеть:
 * корешок занимает два десятка пикселей, и разводы на нём превратились бы в
 * грязь. Берём преобладающий тон — он и есть то, что видно издали.
 */
function edgeSwatch(theme: BookTheme): string {
  const { edge, edgeColor, tint } = theme.paper;
  if (edge === 'gilded') return '#c9a24a';
  if (edge === 'sprayed' || edge === 'marbled') return edgeColor;
  return PAPERS[tint].edge;
}

export type { SpineAtlas };
