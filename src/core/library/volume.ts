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
import { journalExtent } from '../journal/journal';
import type { JournalDoc } from '../journal/types';
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
  | { kind: 'file'; file: File }
  /** У тетради источник — она сама: текста, который надо разбирать, там нет. */
  | { kind: 'journal'; journalId: string };

export interface VolumeRecord {
  id: string;
  /**
   * Том или тетрадь (SPEC §13).
   *
   * На полке они стоят рядом и корешок рисуется одинаково — тетрадь и есть
   * книга, просто пустая. Различие начинается на столе: том верстается из
   * текста, тетрадь верстать нечего, её страницы заданы.
   */
  kind: 'volume' | 'journal';
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
  /*
   * У тетради число страниц не оценка и не следствие набора: страницы в ней
   * заведены, а не посчитаны, и от кегля не зависят. Ключ вёрстки ей поэтому не
   * с чем сверять.
   */
  const exact = volume.kind === 'journal' || (volume.pages !== null && volume.pagesKey === paginationKey);
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
    kind: 'volume',
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

/**
 * Запись библиотеки для тетради.
 *
 * Автора у тетради нет — на корешке под ним стоит дата, как её и надписывают на
 * тетрадях. Число страниц сразу точное, поэтому корешок у неё правильной
 * толщины с первой секунды, а не после «вёрстки».
 */
export function journalRecord(journal: JournalDoc, palette?: SpinePalette): VolumeRecord {
  const extent = journalExtent(journal);
  const year = new Date(journal.createdAt).getFullYear();

  return {
    id: journal.id,
    kind: 'journal',
    title: journal.title,
    author: String(year),
    format: 'synthetic',
    language: 'en',
    charCount: 0,
    pages: extent.pages,
    pagesKey: 'journal',
    palette: palette ?? paletteFor(`journal|${journal.title}|${journal.id}`),
    source: { kind: 'journal', journalId: journal.id },
    addedAt: journal.createdAt,
  };
}
