/**
 * Том как запись библиотеки.
 *
 * На полке книга живёт метаданными, а не содержимым. Сорок открытых `ContentDoc`
 * — это сорок распакованных архивов с картинками в base64, десятки мегабайт
 * впустую: на полке от книги видно ровно корешок. Поэтому запись хранит только
 * то, из чего корешок строится, плюс способ добыть текст обратно (SPEC §7.3:
 * «полная модель книги подгружается только для той, которую вытаскивают»).
 *
 * Отдельная тонкость — толщина. Пока книга не свёрстана при текущем наборе,
 * числа страниц у неё нет, а корешок рисовать надо. Тогда объём оценивается по
 * числу знаков, и оценка пересчитывается вместе с кеглем: полка полнеет и
 * худеет от ползунка так же, как том на столе.
 */
import type { DocFormat, ContentDoc } from '../content';
import type { PageMetrics } from '../typography';
import { pagesToSheets, PHYS, sheetsToThicknessMm } from '../units';
import { paletteFor, type SpinePalette } from './palette';
import type { SyntheticOptions } from '../text/synthetic';

/**
 * Откуда взять текст, когда том снимут с полки.
 *
 * Файл держим ссылкой, а не разобранным документом: `File` — это дескриптор, он
 * не занимает памяти, а повторный разбор укладывается в анимацию полёта.
 */
export type VolumeSource =
  | { kind: 'synthetic'; options: SyntheticOptions }
  | { kind: 'file'; file: File };

export interface VolumeRecord {
  id: string;
  title: string;
  author: string;
  format: DocFormat;
  language: string;
  /** Знаков в тексте. По ним оценивается объём, пока книга не свёрстана. */
  charCount: number;
  /** Точное число страниц — есть только после вёрстки при этом наборе. */
  pages: number | null;
  /**
   * Ключ вёрстки, при котором посчитано `pages`. Разошёлся с текущим — значит,
   * набор сменили, и точное число снова становится оценкой.
   */
  pagesKey: string | null;
  palette: SpinePalette;
  source: VolumeSource;
  addedAt: number;
}

/**
 * Средняя ширина знака в кеглях.
 *
 * Величина гарнитуро-зависимая; 0.5 em — то, что даёт Literata на латинице с
 * обычной долей пробелов. Она нужна только для оценки корешка ещё не свёрстанной
 * книги: как только том открывают, оценка заменяется настоящим числом страниц.
 */
const AVG_ADVANCE_EM = 0.5;

/**
 * Доля полосы, которую текст занимает на самом деле.
 *
 * Абзацы кончаются неполной строкой, главы — неполной страницей, заголовки
 * съедают по две строки. Величина не выведена, а подогнана по замеру: на книге,
 * где известно и число знаков, и посчитанное вёрсткой число страниц, при 0.9
 * оценка сходится в пределах процента, а без поправки вовсе занижает объём на
 * девять. На другом языке и другой гарнитуре разойдётся сильнее — 0.5 em выше
 * тоже гарнитуро-зависимы.
 */
const FILL = 0.9;

/** Сколько знаков помещается на страницу при этом наборе. */
export function charsPerPage(m: PageMetrics): number {
  const lines = Math.max(1, Math.floor(m.boxHeightPx / m.lineHeightPx));
  const perLine = m.boxWidthPx / (m.fontSizePx * AVG_ADVANCE_EM);
  return Math.max(1, Math.round(lines * perLine * FILL));
}

export interface VolumeExtent {
  pages: number;
  sheets: number;
  thicknessMm: number;
  /** true — число страниц посчитано вёрсткой, false — оценено по знакам. */
  exact: boolean;
}

/**
 * Физический объём тома при данном наборе.
 *
 * Толщина корешка — это `blockThickness + две крышки`, а не только блок:
 * на полке переплёт виден целиком, и без картона тонкая книга выглядела бы
 * листом бумаги.
 */
export function volumeExtent(
  volume: VolumeRecord,
  metrics: PageMetrics,
  paginationKey: string | null,
): VolumeExtent {
  const exact = volume.pages !== null && volume.pagesKey === paginationKey;
  const pages = exact
    ? volume.pages!
    : Math.max(2, Math.round(volume.charCount / charsPerPage(metrics)));
  const sheets = pagesToSheets(pages);

  return {
    pages,
    sheets,
    thicknessMm: sheetsToThicknessMm(sheets) + PHYS.coverThicknessMm * 2,
    exact,
  };
}

/** Запись библиотеки из разобранного документа. */
export function volumeFromDoc(
  doc: ContentDoc,
  source: VolumeSource,
  palette?: SpinePalette,
): VolumeRecord {
  return {
    id: doc.id,
    title: doc.title,
    author: doc.author,
    format: doc.format,
    language: doc.language,
    charCount: doc.charCount,
    pages: null,
    pagesKey: null,
    palette: palette ?? paletteFor(`${doc.title}|${doc.author}`),
    source,
    addedAt: Date.now(),
  };
}
