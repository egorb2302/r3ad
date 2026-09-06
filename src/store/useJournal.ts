'use client';

/**
 * Состояние тетради: документ, инструмент, плоский режим, история правок.
 *
 * Здесь нет ни одной точки текущего штриха. Пока перо ведут, точки копятся в
 * самом холсте — стилус на 120 Гц дал бы полторы сотни обновлений стора в
 * секунду ради линии, которая ещё не дорисована. В стор попадает готовый штрих,
 * и попадает командой: единица истории — действие, а не кадр.
 *
 * Связь с остальными сторами односторонняя, как и у библиотеки: тетрадь знает
 * про стол и полку, они про неё — нет. Тетрадь оказывается на столе не вызовом,
 * а подпиской (внизу файла): библиотека кладёт на стол запись, тетрадь узнаёт в
 * ней себя и открывается.
 */
import { create } from 'zustand';
import { putImage } from '@/core/journal/assets';
import {
  applyCommand,
  emptyStack,
  push,
  redo as redoStack,
  undo as undoStack,
  type Command,
  type CommandStack,
} from '@/core/journal/commands';
import { demoJournal } from '@/core/journal/demo';
import { journalExtent, newJournal, newLeaf } from '@/core/journal/journal';
import { PAGE_H, PAGE_W } from '@/core/journal/paint';
import { id as makeId } from '@/core/journal/ids';
import {
  blockLayer,
  type Block,
  type BrushKind,
  type JournalDoc,
  type PageBackground,
  type PageDoc,
} from '@/core/journal/types';
import { journalRecord } from '@/core/library/volume';
import { useBook } from './useBook';
import { useLibrary } from './useLibrary';

export type Tool = 'select' | 'pen' | 'marker' | 'eraser' | 'text' | 'image';

export interface BrushSettings {
  color: string;
  /** Толщина в миллиметрах — та же единица, что и у страницы. */
  width: number;
  opacity: number;
}

/** Инструменты, которыми рисуют. Остальные ничего не оставляют на бумаге. */
export const BRUSH_OF: Partial<Record<Tool, BrushKind>> = {
  pen: 'pen',
  marker: 'marker',
};

const starter = demoJournal();

interface JournalState {
  docs: Record<string, JournalDoc>;
  stacks: Record<string, CommandStack>;

  /** Тетрадь, лежащая на столе. */
  openId: string | null;
  /**
   * Номер страницы, раскрытой плоско. null — плоского режима нет.
   *
   * Именно страница, а не разворот: рисуют по одной странице, и вторая
   * половина разворота в этот момент только мешала бы точности.
   */
  flatPage: number | null;

  tool: Tool;
  brushes: Record<BrushKind, BrushSettings>;
  eraser: number;

  /** Выбранный блок и блок, который сейчас правят текстом. */
  selection: string | null;
  editing: string | null;

  setTool: (tool: Tool) => void;
  setBrush: (patch: Partial<BrushSettings>) => void;
  setEraser: (radius: number) => void;

  apply: (command: Command) => void;
  undo: () => void;
  redo: () => void;

  enterFlat: (page?: number) => void;
  exitFlat: () => void;
  setFlatPage: (page: number) => void;

  create: () => void;
  addLeaf: () => void;
  setBackground: (background: PageBackground) => void;
  insertImage: (file: Blob) => Promise<void>;

  select: (blockId: string | null) => void;
  edit: (blockId: string | null) => void;
  deleteSelection: () => void;
}

/** Тетрадь на столе и её страница — то, к чему сводится почти каждое действие. */
export function openJournal(state: JournalState): JournalDoc | null {
  return state.openId ? state.docs[state.openId] ?? null : null;
}

export function flatPageDoc(state: JournalState): PageDoc | null {
  const journal = openJournal(state);
  if (!journal || state.flatPage === null) return null;
  return journal.pages[state.flatPage] ?? null;
}

/** Разворот и сторона, на которых лежит страница. */
export function spreadOf(page: number): { sheet: number; side: 'left' | 'right' } {
  return page % 2 === 0
    ? { sheet: page / 2, side: 'right' }
    : { sheet: (page + 1) / 2, side: 'left' };
}

export const useJournal = create<JournalState>((set, get) => ({
  docs: { [starter.id]: starter },
  stacks: {},

  openId: null,
  flatPage: null,

  tool: 'pen',
  brushes: {
    pen: { color: '#1b2b3f', width: 0.5, opacity: 1 },
    marker: { color: '#f0c93f', width: 6, opacity: 0.42 },
    pencil: { color: '#3a3a3a', width: 0.7, opacity: 0.8 },
  },
  eraser: 3,

  selection: null,
  editing: null,

  /**
   * Смена инструмента.
   *
   * Взять перо — значит сесть писать, поэтому инструмент сам вводит в плоский
   * режим (SPEC §9.1). Обратное неверно: выйдя из режима, перо из руки не
   * выпадает, и вернуться к рисованию можно тем же щелчком.
   */
  setTool: (tool) => {
    set({ tool, selection: tool === 'select' ? get().selection : null, editing: null });
    if (get().openId && get().flatPage === null) get().enterFlat();
  },

  setBrush: (patch) => {
    const brush = BRUSH_OF[get().tool];
    if (!brush) return;
    set({ brushes: { ...get().brushes, [brush]: { ...get().brushes[brush], ...patch } } });
  },

  setEraser: (eraser) => set({ eraser }),

  apply: (command) => {
    const openId = get().openId;
    if (!openId) return;

    const before = get().docs[openId];
    const journal = applyCommand(before, command);

    set({
      docs: { ...get().docs, [openId]: journal },
      stacks: { ...get().stacks, [openId]: push(get().stacks[openId] ?? emptyStack(), command) },
    });
    publish(journal, before);
  },

  undo: () => {
    const openId = get().openId;
    if (!openId) return;

    const before = get().docs[openId];
    const result = undoStack(before, get().stacks[openId] ?? emptyStack());
    set({
      docs: { ...get().docs, [openId]: result.journal },
      stacks: { ...get().stacks, [openId]: result.stack },
      selection: null,
      editing: null,
    });
    publish(result.journal, before);
  },

  redo: () => {
    const openId = get().openId;
    if (!openId) return;

    const before = get().docs[openId];
    const result = redoStack(before, get().stacks[openId] ?? emptyStack());
    set({
      docs: { ...get().docs, [openId]: result.journal },
      stacks: { ...get().stacks, [openId]: result.stack },
    });
    publish(result.journal, before);
  },

  /**
   * Лечь к тетради.
   *
   * Страница по умолчанию — правая на текущем развороте: разворот открыт именно
   * на ней, и щелчок пером продолжает то, на что человек смотрит.
   */
  enterFlat: (page) => {
    const journal = openJournal(get());
    if (!journal) return;

    const wanted = page ?? useBook.getState().currentSheet * 2;
    const target = Math.min(Math.max(wanted, 0), journal.pages.length - 1);

    set({ flatPage: target, selection: null, editing: null });
    useBook.getState().setSheet(spreadOf(target).sheet);
    useLibrary.getState().setView('flat');
  },

  exitFlat: () => {
    if (get().flatPage === null) return;
    set({ flatPage: null, selection: null, editing: null });
    useLibrary.getState().setView('desk');
  },

  setFlatPage: (page) => {
    const journal = openJournal(get());
    if (!journal || get().flatPage === null) return;

    const target = Math.min(Math.max(page, 0), journal.pages.length - 1);
    set({ flatPage: target, selection: null, editing: null });
    useBook.getState().setSheet(spreadOf(target).sheet);
  },

  /**
   * Новая тетрадь.
   *
   * Заводится на полке, а не на столе, и оттуда её снимают обычным движением:
   * тетрадь — такая же книга библиотеки, и заводить для неё отдельный путь
   * означало бы два способа оказаться на столе.
   */
  create: () => {
    const journal = newJournal(`Notebook ${Object.keys(get().docs).length + 1}`);
    set({ docs: { ...get().docs, [journal.id]: journal } });

    const library = useLibrary.getState();
    library.add(journalRecord(journal));
    library.take(journal.id);
  },

  addLeaf: () => {
    const journal = openJournal(get());
    if (!journal) return;
    get().apply({ type: 'pages:add', at: journal.pages.length, pages: newLeaf(journal) });
  },

  setBackground: (background) => {
    const page = flatPageDoc(get());
    if (!page || page.background === background) return;
    get().apply({
      type: 'page:background',
      page: page.id,
      from: page.background,
      to: background,
    });
  },

  /**
   * Вставка картинки — из буфера, перетаскиванием или через выбор файла.
   *
   * Размер подбирается по месту: картинка вписывается в две трети страницы с
   * сохранением пропорций и ложится по центру. Скриншот в оригинальных пикселях
   * оказался бы либо маркой, либо больше листа.
   */
  insertImage: async (file) => {
    const page = flatPageDoc(get());
    if (!page) return;

    const stored = await putImage(file);
    const fit = Math.min((PAGE_W * 0.66) / stored.width, (PAGE_H * 0.5) / stored.height);
    const w = stored.width * fit;
    const h = stored.height * fit;

    const block: Block = {
      id: makeId(),
      type: 'image',
      rect: { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, w, h },
      rot: 0,
      assetHash: stored.hash,
      frame: 'none',
    };

    get().apply({ type: 'block:add', page: page.id, block });
    set({ tool: 'select', selection: block.id });
  },

  select: (selection) => set({ selection }),
  edit: (editing) => set({ editing }),

  deleteSelection: () => {
    const page = flatPageDoc(get());
    const selection = get().selection;
    if (!page || !selection) return;

    const block = blockLayer(page).blocks.find((b) => b.id === selection);
    if (!block) return;

    set({ selection: null });
    get().apply({ type: 'block:remove', page: page.id, block });
  },
}));

/**
 * Сообщить остальным, что тетрадь изменилась.
 *
 * Числа две: сколько сейчас листов на столе (иначе листать будет нечего) и
 * сколько страниц у записи на полке (иначе корешок останется прежней толщины).
 * Дёргаем только когда страниц стало больше или меньше: штрих объёма тетради не
 * меняет.
 */
function publish(journal: JournalDoc, before?: JournalDoc) {
  if (before && before.pages.length === journal.pages.length) return;

  const extent = journalExtent(journal);
  useBook.getState().setExtent(extent.pages, extent.sheets);
  useLibrary.getState().noteComposed(journal.id, extent.pages, 'journal');
}

/*
 * Стол → тетрадь. Библиотека кладёт на стол запись; если это тетрадь, она
 * открывается здесь. Обратной ссылки нет: библиотека про этот стор не знает и
 * знать не должна — иначе полке пришлось бы разбираться, чем том отличается от
 * тетради, а она про содержимое вообще ничего не знает.
 */
useLibrary.subscribe((state, previous) => {
  /*
   * Из плоского режима выходят не только кнопкой «done»: хлебные крошки, Esc и
   * полёт книги тоже уводят камеру. Ракурс здесь первичен — если он больше не
   * над страницей, значит, и режима нет.
   */
  if (state.view !== previous.view && state.view !== 'flat') {
    if (useJournal.getState().flatPage !== null) {
      useJournal.setState({ flatPage: null, selection: null, editing: null });
    }
  }

  if (state.desk === previous.desk) return;

  const source = state.desk?.source;
  const journal = useJournal.getState();

  if (source?.kind === 'journal') {
    if (journal.openId === source.journalId) return;
    const doc = journal.docs[source.journalId];
    if (!doc) return;

    useJournal.setState({ openId: source.journalId, flatPage: null });
    const extent = journalExtent(doc);
    useBook.getState().setExtent(extent.pages, extent.sheets);
    return;
  }

  if (journal.openId === null) return;
  useJournal.setState({ openId: null, flatPage: null, selection: null, editing: null });
  // Со стола убрали всё — листать больше нечего.
  if (!state.desk) useBook.getState().setExtent(0, 1);
});

if (process.env.NODE_ENV !== 'production') {
  (globalThis as { __r3adJournal?: typeof useJournal }).__r3adJournal = useJournal;
}
