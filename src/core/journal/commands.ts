/**
 * Команды тетради и стопка отмены.
 *
 * Каждое изменение документа — это команда, у которой есть обратная. Отмена
 * тогда не «сохранённая копия страницы», а применение обратной команды, и
 * стоит она столько же, сколько само действие. Разница видна на конспекте в
 * тысячу штрихов: снимков там были бы сотни мегабайт.
 *
 * Команды сериализуемы (SPEC §9.3) — в них нет ни ссылок на объекты сцены, ни
 * функций, ни классов. Это нужно не только отмене: на них же поедет
 * совместное редактирование и «проигрывание» конспекта.
 *
 * Применение — чистое: возвращается новый документ, старый не трогается.
 * Затронутые страницы получают новую идентичность, нетронутые сохраняют
 * прежнюю, и кэш текстур может держать их прямо по ссылке на объект.
 */
import type { Block, JournalDoc, PageBackground, PageDoc, Stroke } from './types';

export type Command =
  | { type: 'strokes:add'; page: string; strokes: Stroke[] }
  | { type: 'strokes:remove'; page: string; strokes: Stroke[] }
  | { type: 'block:add'; page: string; block: Block }
  | { type: 'block:remove'; page: string; block: Block }
  | { type: 'block:update'; page: string; id: string; from: Block; to: Block }
  | { type: 'page:background'; page: string; from: PageBackground; to: PageBackground }
  | { type: 'pages:add'; at: number; pages: PageDoc[] }
  | { type: 'pages:remove'; at: number; pages: PageDoc[] };

export interface CommandStack {
  done: Command[];
  undone: Command[];
}

export const emptyStack = (): CommandStack => ({ done: [], undone: [] });

/** Глубина отмены. Дальше конспект всё равно правят не отменой, а ластиком. */
const DEPTH = 250;

export function invert(command: Command): Command {
  switch (command.type) {
    case 'strokes:add':
      return { type: 'strokes:remove', page: command.page, strokes: command.strokes };
    case 'strokes:remove':
      return { type: 'strokes:add', page: command.page, strokes: command.strokes };
    case 'block:add':
      return { type: 'block:remove', page: command.page, block: command.block };
    case 'block:remove':
      return { type: 'block:add', page: command.page, block: command.block };
    case 'block:update':
      return { ...command, from: command.to, to: command.from };
    case 'page:background':
      return { ...command, from: command.to, to: command.from };
    case 'pages:add':
      return { type: 'pages:remove', at: command.at, pages: command.pages };
    case 'pages:remove':
      return { type: 'pages:add', at: command.at, pages: command.pages };
  }
}

function withPage(
  journal: JournalDoc,
  pageId: string,
  edit: (page: PageDoc) => PageDoc,
): JournalDoc {
  return {
    ...journal,
    updatedAt: Date.now(),
    pages: journal.pages.map((page) => (page.id === pageId ? edit(page) : page)),
  };
}

/** Правка одного слоя страницы с сохранением порядка остальных. */
function withStrokes(page: PageDoc, edit: (strokes: Stroke[]) => Stroke[]): PageDoc {
  return {
    ...page,
    layers: page.layers.map((layer) =>
      layer.type === 'strokes' ? { ...layer, strokes: edit(layer.strokes) } : layer,
    ),
  };
}

function withBlocks(page: PageDoc, edit: (blocks: Block[]) => Block[]): PageDoc {
  return {
    ...page,
    layers: page.layers.map((layer) =>
      layer.type === 'blocks' ? { ...layer, blocks: edit(layer.blocks) } : layer,
    ),
  };
}

export function applyCommand(journal: JournalDoc, command: Command): JournalDoc {
  switch (command.type) {
    case 'strokes:add':
      return withPage(journal, command.page, (page) =>
        withStrokes(page, (strokes) => [...strokes, ...command.strokes]),
      );

    case 'strokes:remove': {
      const gone = new Set(command.strokes.map((s) => s.id));
      return withPage(journal, command.page, (page) =>
        withStrokes(page, (strokes) => strokes.filter((s) => !gone.has(s.id))),
      );
    }

    case 'block:add':
      return withPage(journal, command.page, (page) =>
        withBlocks(page, (blocks) => [...blocks, command.block]),
      );

    case 'block:remove':
      return withPage(journal, command.page, (page) =>
        withBlocks(page, (blocks) => blocks.filter((b) => b.id !== command.block.id)),
      );

    case 'block:update':
      return withPage(journal, command.page, (page) =>
        withBlocks(page, (blocks) => blocks.map((b) => (b.id === command.id ? command.to : b))),
      );

    case 'page:background':
      return withPage(journal, command.page, (page) => ({ ...page, background: command.to }));

    case 'pages:add': {
      const pages = [...journal.pages];
      pages.splice(command.at, 0, ...command.pages);
      return { ...journal, pages, updatedAt: Date.now() };
    }

    case 'pages:remove': {
      const gone = new Set(command.pages.map((p) => p.id));
      return {
        ...journal,
        pages: journal.pages.filter((p) => !gone.has(p.id)),
        updatedAt: Date.now(),
      };
    }
  }
}

/**
 * Выполнить команду и запомнить её.
 *
 * Новое действие обнуляет отменённое — обычная семантика линейной истории:
 * ветвление истории правок в тетради никому не нужно, а объяснять его в
 * интерфейсе пришлось бы.
 */
export function push(stack: CommandStack, command: Command): CommandStack {
  const done = [...stack.done, command];
  return { done: done.slice(Math.max(0, done.length - DEPTH)), undone: [] };
}

export function undo(
  journal: JournalDoc,
  stack: CommandStack,
): { journal: JournalDoc; stack: CommandStack } {
  const command = stack.done[stack.done.length - 1];
  if (!command) return { journal, stack };

  return {
    journal: applyCommand(journal, invert(command)),
    stack: { done: stack.done.slice(0, -1), undone: [...stack.undone, command] },
  };
}

export function redo(
  journal: JournalDoc,
  stack: CommandStack,
): { journal: JournalDoc; stack: CommandStack } {
  const command = stack.undone[stack.undone.length - 1];
  if (!command) return { journal, stack };

  return {
    journal: applyCommand(journal, command),
    stack: { done: [...stack.done, command], undone: stack.undone.slice(0, -1) },
  };
}
