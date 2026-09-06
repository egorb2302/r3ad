/**
 * Тетрадь: создание и обмер.
 *
 * Страницы заводятся парами. Лист бумаги имеет две стороны, и тетрадь с
 * нечётным числом страниц — это тетрадь с вырванным листом; в модели, где
 * толщина выводится из числа листов (SPEC §6.3), такая страница означала бы
 * половину листа. Поэтому «добавить страницу» — это добавить лист.
 */
import { pagesToSheets, PHYS, sheetsToThicknessMm } from '../units';
import { id } from './ids';
import type { JournalDoc, PageBackground, PageDoc } from './types';

/** Сколько листов в новой тетради. */
export const DEFAULT_LEAVES = 8;

export function newPage(journalId: string, background: PageBackground): PageDoc {
  return {
    id: id(),
    journalId,
    background,
    /*
     * Порядок слоёв — снизу вверх: сначала блоки, потом штрихи. Скриншот
     * ложится на страницу, а обводят его поверх, а не под ним.
     */
    layers: [
      { id: id(), type: 'blocks', visible: true, locked: false, blocks: [] },
      { id: id(), type: 'strokes', visible: true, locked: false, strokes: [] },
    ],
  };
}

export function newLeaf(journal: JournalDoc): PageDoc[] {
  return [newPage(journal.id, journal.defaultBackground), newPage(journal.id, journal.defaultBackground)];
}

export function newJournal(title: string, leaves = DEFAULT_LEAVES, background: PageBackground = 'ruled'): JournalDoc {
  const journalId = id();
  const now = Date.now();

  const journal: JournalDoc = {
    id: journalId,
    title,
    createdAt: now,
    updatedAt: now,
    defaultBackground: background,
    pages: [],
  };

  for (let i = 0; i < leaves * 2; i++) journal.pages.push(newPage(journalId, background));
  return journal;
}

export interface JournalExtent {
  pages: number;
  sheets: number;
  thicknessMm: number;
}

/**
 * Объём тетради.
 *
 * Считается ровно тем же способом, что и объём тома: число листов на толщину
 * листа плюс две крышки. Тетрадь на полке обязана толстеть от того, что в ней
 * пишут, — это тот же закон, из-за которого том толстеет от кегля.
 */
export function journalExtent(journal: JournalDoc): JournalExtent {
  const sheets = pagesToSheets(journal.pages.length);
  return {
    pages: journal.pages.length,
    sheets,
    thicknessMm: sheetsToThicknessMm(sheets) + PHYS.coverThicknessMm * 2,
  };
}

/**
 * Сколько всего штрихов, блоков и картинок в тетради — для инспектора.
 *
 * Картинки считаем по хэшам, а не по блокам: один скриншот, вставленный на трёх
 * страницах, — это одна картинка, и в хранилище он тоже один (см. assets.ts).
 * Вырезки — по идентификаторам, ровно по той же причине.
 */
export function journalStats(journal: JournalDoc) {
  let strokes = 0;
  let blocks = 0;
  let points = 0;
  const images = new Set<string>();
  const clips = new Set<string>();

  for (const page of journal.pages) {
    for (const layer of page.layers) {
      if (layer.type === 'strokes') {
        strokes += layer.strokes.length;
        for (const stroke of layer.strokes) points += stroke.points.length;
      } else {
        blocks += layer.blocks.length;
        for (const block of layer.blocks) {
          if (block.type === 'image') images.add(block.assetHash);
          if (block.type === 'clipping') clips.add(block.clippingId);
        }
      }
    }
  }

  return { strokes, blocks, points, images: [...images], clips: [...clips] };
}
