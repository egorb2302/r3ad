/**
 * Расстановка томов по полкам.
 *
 * Чистая функция: порядок книг и набор → координаты корешков. Ни three, ни
 * React здесь нет намеренно — расстановку должно быть можно посчитать до того,
 * как появится сцена (в снапшоте, на сервере, в тесте), и она обязана быть
 * воспроизводимой: полка, открытая по ссылке, выглядит так же, как у автора.
 *
 * Толщина берётся из объёма тома, а объём — из набора. Поэтому у расстановки
 * есть неочевидное свойство: подвинули ползунок кегля — и вся полка поехала.
 * Это не побочный эффект, а то же самое утверждение, что и у тома на столе,
 * только сорок раз подряд.
 */
import type { PageMetrics } from '../typography';
import { mm } from '../units';
import { volumeExtent, type VolumeRecord } from './volume';

export interface CaseSpec {
  shelves: number;
  /** Внутренняя ширина полки в единицах сцены. */
  innerWidth: number;
  /**
   * Сколько корешков сцена умеет показать одновременно.
   *
   * Ограничение не мебельное, а от отрисовки: ряд инстансирован, у него один
   * атлас на всю полку и конечное число клеток в нём. Лишние тома честно
   * оказываются в overflow, а не рисуются мусором.
   */
  capacity: number;
}

export interface Placement {
  id: string;
  /** Номер полки сверху вниз, с нуля. */
  shelf: number;
  /** Центр корешка вдоль полки, от её левого края. */
  x: number;
  thickness: number;
  /**
   * Наклон последнего тома в неполном ряду. Книге не на что опереться, и она
   * заваливается — без этого ряд выглядит как забор, а не как полка.
   */
  tilt: number;
  pages: number;
  /** false — объём оценён по знакам, книга ещё не верстана при этом наборе. */
  exact: boolean;
}

export interface ShelfLayout {
  byId: Map<string, Placement>;
  order: Placement[];
  /** Занято на каждой полке. */
  used: number[];
  /** Тома, которым не хватило места. */
  overflow: string[];
}

/** Зазор между корешками. Книги в ряду стоят плотно, но не слипаются. */
const GAP = mm(0.6);

/** Отступ от боковой стенки. */
const EDGE = mm(3);

/** Дальше книга уже не заваливается, а падает. */
const MAX_TILT = 0.3;

/** Меньше этого просвета последний том стоит прямо: соседи держат. */
const LEAN_FROM = 3;

export function layoutShelves(
  volumes: VolumeRecord[],
  metrics: PageMetrics,
  paginationKey: string | null,
  spec: CaseSpec,
  bookHeight: number,
): ShelfLayout {
  const order: Placement[] = [];
  const byId = new Map<string, Placement>();
  const used = new Array<number>(spec.shelves).fill(0);
  const overflow: string[] = [];

  const rowWidth = spec.innerWidth - EDGE * 2;
  let shelf = 0;
  let cursor = 0;

  for (const volume of volumes) {
    const extent = volumeExtent(volume, metrics, paginationKey);
    const thickness = mm(extent.thicknessMm);

    // Не поместился — переходим на следующую полку целиком: разрывать том
    // между полками нечем.
    if (cursor + thickness > rowWidth && cursor > 0) {
      used[shelf] = cursor - GAP;
      shelf += 1;
      cursor = 0;
    }

    if (shelf >= spec.shelves || thickness > rowWidth || order.length >= spec.capacity) {
      overflow.push(volume.id);
      continue;
    }

    const placement: Placement = {
      id: volume.id,
      shelf,
      x: EDGE + cursor + thickness / 2,
      thickness,
      tilt: 0,
      pages: extent.pages,
      exact: extent.exact,
    };

    order.push(placement);
    byId.set(volume.id, placement);
    cursor += thickness + GAP;
  }

  if (shelf < spec.shelves) used[shelf] = Math.max(0, cursor - GAP);

  /*
   * Заваливается только последняя книга ряда: всем остальным мешают соседи.
   * Угол ограничен свободным местом — том опирается верхним углом о полку и
   * не может лечь дальше, чем эта полка позволяет.
   */
  for (let s = 0; s < spec.shelves; s++) {
    const row = order.filter((p) => p.shelf === s);
    const last = row[row.length - 1];
    if (!last) continue;

    const free = rowWidth - used[s];
    if (free < LEAN_FROM) continue;

    last.tilt = Math.min(MAX_TILT, Math.asin(Math.min(1, free / bookHeight)));
  }

  return { byId, order, used, overflow };
}
