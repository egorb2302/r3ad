/**
 * Страница тетради — слоёный документ, а не растр.
 *
 * Решение из SPEC §9.2, и оно определяет весь остальной код тетради. Штрих
 * хранится вектором: точками с нажимом и временем. Растр был бы проще ровно до
 * первого вопроса — расшарить конспект (мегабайты PNG против десятков
 * килобайт), приблизиться (пиксельная каша), отменить последнее действие
 * (нечего отменять, слои уже слиты), проиграть конспект во времени (время
 * потеряно вместе с точками).
 *
 * Координаты — миллиметры страницы, начало в её левом верхнем углу. Не пиксели:
 * страница живёт одновременно текстурой 1024×1452 в 3D и холстом во весь экран
 * в плоском режиме, и ни одно из этих разрешений не имеет права быть системой
 * координат документа. Толщина пера в миллиметрах — заодно и то, что понятно
 * человеку: 0.4 мм это 0.4 мм, как на упаковке.
 */
import { PHYS } from '../units';

/** Размеры листа тетради совпадают с обрезным форматом тома: это одна и та же бумага. */
export const PAGE_W = PHYS.trimWidthMm;
export const PAGE_H = PHYS.trimHeightMm;

export type PageBackground = 'blank' | 'ruled' | 'grid' | 'dots' | 'staff';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BrushKind = 'pen' | 'marker' | 'pencil';

/**
 * Точка штриха: координаты, нажим и время от начала штриха.
 *
 * Кортежем, а не объектом с полями: точек в конспекте десятки тысяч, и разница
 * между `[x,y,p,t]` и `{x,y,pressure,t}` — это разница между сорока и полутора
 * сотнями байт в JSON на каждую.
 */
export type StrokePoint = [x: number, y: number, pressure: number, t: number];

export interface Stroke {
  id: string;
  brush: BrushKind;
  color: string;
  /** Базовая толщина в миллиметрах. Нажим множит её, а не задаёт. */
  width: number;
  /** Прозрачность. У маркера меньше единицы, у пера единица. */
  opacity: number;
  points: StrokePoint[];
}

export interface TextStyle {
  sizeMm: number;
  color: string;
  family: 'serif' | 'sans';
  weight: 400 | 600;
}

/**
 * Текстовый блок хранит текст, а не HTML.
 *
 * SPEC §13 объявляет `html`, и для DOM-редактора это было бы верно, но страница
 * тетради печатается на холст — и там нет ни одного способа отрисовать разметку.
 * Богатый текст здесь означал бы собственный движок вёрстки поверх canvas;
 * до M6, где тетрадь попадёт в снапшот, набор остаётся простым.
 */
export type Block =
  | { id: string; type: 'text'; rect: Rect; rot: number; text: string; style: TextStyle }
  | {
      id: string;
      type: 'image';
      rect: Rect;
      rot: number;
      /** sha256 блоба в хранилище ассетов: один скриншот на десяти страницах лежит один раз. */
      assetHash: string;
      frame: 'none' | 'polaroid';
    };

export type Layer =
  | { id: string; type: 'strokes'; visible: boolean; locked: boolean; strokes: Stroke[] }
  | { id: string; type: 'blocks'; visible: boolean; locked: boolean; blocks: Block[] };

export interface PageDoc {
  id: string;
  journalId: string;
  background: PageBackground;
  layers: Layer[];
}

export interface JournalDoc {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  defaultBackground: PageBackground;
  pages: PageDoc[];
}

/** Слой штрихов страницы. В M3 он один: слои как объект интерфейса — тема M6. */
export function strokeLayer(page: PageDoc) {
  return page.layers.find((l): l is Extract<Layer, { type: 'strokes' }> => l.type === 'strokes')!;
}

export function blockLayer(page: PageDoc) {
  return page.layers.find((l): l is Extract<Layer, { type: 'blocks' }> => l.type === 'blocks')!;
}
