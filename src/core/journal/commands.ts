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
import type { Block, JournalDoc, Layer, PageBackground, PageDoc, Stroke } from './types';

/** Что можно переключить у слоя, не трогая его содержимого. */
export interface LayerFlags {
  visible: boolean;
  locked: boolean;
}

export type Command =
  | { type: 'strokes:add'; page: string; strokes: Stroke[] }
  | { type: 'strokes:remove'; page: string; strokes: Stroke[] }
  | { type: 'block:add'; page: string; block: Block }
  | { type: 'block:remove'; page: string; block: Block }
  | { type: 'block:update'; page: string; id: string; from: Block; to: Block }
  | { type: 'page:background'; page: string; from: PageBackground; to: PageBackground }
  /*
   * Слои (SPEC §9.2, §21.11). Видимость и замок — такие же правки документа,
   * как штрих: их отменяют тем же ⌘Z и по той же причине — выключил слой,
   * не увидел, что искал, вернул назад одним движением.
   */
  | { type: 'layer:flags'; page: string; id: string; from: LayerFlags; to: LayerFlags }
  /** Порядок слоёв — списком идентификаторов: обратная команда тогда тривиальна. */
  | { type: 'layers:order'; page: string; from: string[]; to: string[] }
  /** Шаг разлиновки — свойство тетради, а не страницы (см. types.ts). */
  | { type: 'journal:rule'; from: number | undefined; to: number | undefined }
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
    /*
     * Обратная у всех четырёх одна — поменять `from` и `to` местами, — но
     * записаны они по отдельности: в объединённой ветке типы полей сливаются
     * в союз, и проверяющий перестаёт видеть, что цвет возвращается цветом, а
     * порядок слоёв порядком.
     */
    case 'page:background':
      return { ...command, from: command.to, to: command.from };
    case 'layer:flags':
      return { ...command, from: command.to, to: command.from };
    case 'layers:order':
      return { ...command, from: command.to, to: command.from };
    case 'journal:rule':
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

    case 'layer:flags':
      return withPage(journal, command.page, (page) => ({
        ...page,
        layers: page.layers.map((layer) =>
          layer.id === command.id ? { ...layer, ...command.to } : layer,
        ),
      }));

    case 'layers:order':
      return withPage(journal, command.page, (page) => ({
        ...page,
        /*
         * Пересобираем по списку, а не меняем два элемента местами: команда
         * тогда описывает результат целиком и переживает любую перестановку,
         * включая ту, которой в интерфейсе ещё нет.
         */
        layers: command.to
          .map((id) => page.layers.find((layer) => layer.id === id))
          .filter((layer): layer is Layer => Boolean(layer)),
      }));

    case 'journal:rule':
      return { ...journal, ruleMm: command.to, updatedAt: Date.now() };

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
