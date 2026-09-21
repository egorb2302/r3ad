import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  emptyStack,
  invert,
  push,
  redo,
  undo,
  type Command,
} from '@/core/journal/commands';
import { newJournal } from '@/core/journal/journal';
import { blockLayer, strokeLayer, type Block, type Stroke } from '@/core/journal/types';

const stroke = (id: string): Stroke => ({
  id,
  brush: 'pen',
  color: '#000',
  width: 0.4,
  opacity: 1,
  points: [
    [10, 10, 0.5, 0],
    [20, 20, 0.6, 16],
  ],
});

const block = (id: string, text = 'note'): Block => ({
  id,
  type: 'text',
  rect: { x: 10, y: 10, w: 60, h: 20 },
  rot: 0,
  text,
  style: { sizeMm: 4, color: '#000', family: 'serif', weight: 400 },
});

describe('новая тетрадь', () => {
  it('лист — две страницы, и на каждой блоки лежат под штрихами', () => {
    const journal = newJournal('Notes', 3);
    expect(journal.pages).toHaveLength(6);
    for (const page of journal.pages) {
      expect(page.layers.map((l) => l.type)).toEqual(['blocks', 'strokes']);
      expect(page.journalId).toBe(journal.id);
    }
  });
});

describe('применение команды', () => {
  it('меняет только затронутую страницу: остальные сохраняют идентичность', () => {
    const journal = newJournal('Notes', 2);
    const [first, second] = journal.pages;
    const next = applyCommand(journal, {
      type: 'strokes:add',
      page: first.id,
      strokes: [stroke('s1')],
    });

    expect(next).not.toBe(journal);
    expect(next.pages[0]).not.toBe(first);
    // Нетронутая страница — тот же объект: кэш текстур держит её по ссылке.
    expect(next.pages[1]).toBe(second);
    expect(strokeLayer(next.pages[0]).strokes.map((s) => s.id)).toEqual(['s1']);
    // Исходный документ не тронут.
    expect(strokeLayer(first).strokes).toHaveLength(0);
  });

  it('пересобирает слои по списку, а не меняет два местами', () => {
    const journal = newJournal('Notes', 1);
    const page = journal.pages[0];
    const [blocks, strokes] = page.layers.map((l) => l.id);
    const next = applyCommand(journal, {
      type: 'layers:order',
      page: page.id,
      from: [blocks, strokes],
      to: [strokes, blocks],
    });
    expect(next.pages[0].layers.map((l) => l.type)).toEqual(['strokes', 'blocks']);
  });
});

describe('отмена — обратная команда, а не снимок', () => {
  it('обратная у обратной — та же команда, для каждого типа', () => {
    const journal = newJournal('Notes', 1);
    const page = journal.pages[0];
    const layer = strokeLayer(page);
    const commands: Command[] = [
      { type: 'strokes:add', page: page.id, strokes: [stroke('a')] },
      { type: 'strokes:remove', page: page.id, strokes: [stroke('a')] },
      { type: 'block:add', page: page.id, block: block('b') },
      { type: 'block:remove', page: page.id, block: block('b') },
      { type: 'block:update', page: page.id, id: 'b', from: block('b'), to: block('b', 'edited') },
      { type: 'page:background', page: page.id, from: 'ruled', to: 'grid' },
      {
        type: 'layer:flags',
        page: page.id,
        id: layer.id,
        from: { visible: true, locked: false },
        to: { visible: false, locked: true },
      },
      {
        type: 'layers:order',
        page: page.id,
        from: page.layers.map((l) => l.id),
        to: [...page.layers].reverse().map((l) => l.id),
      },
      { type: 'journal:rule', from: 8, to: 5 },
      { type: 'pages:add', at: 2, pages: [] },
      { type: 'pages:remove', at: 0, pages: [page] },
    ];
    for (const command of commands) expect(invert(invert(command))).toEqual(command);
  });

  it('undo возвращает документ к прежнему, redo — обратно', () => {
    const journal = newJournal('Notes', 1);
    const page = journal.pages[0];
    let stack = emptyStack();
    let doc = journal;

    const steps: Command[] = [
      { type: 'strokes:add', page: page.id, strokes: [stroke('s1'), stroke('s2')] },
      { type: 'block:add', page: page.id, block: block('b1') },
      { type: 'strokes:remove', page: page.id, strokes: [stroke('s1')] },
      { type: 'block:update', page: page.id, id: 'b1', from: block('b1'), to: block('b1', 'edited') },
      { type: 'page:background', page: page.id, from: 'ruled', to: 'dots' },
    ];
    for (const step of steps) {
      doc = applyCommand(doc, step);
      stack = push(stack, step);
    }

    const shape = (d: typeof doc) => ({
      strokes: strokeLayer(d.pages[0]).strokes.map((s) => s.id),
      blocks: blockLayer(d.pages[0]).blocks.map((b) => (b.type === 'text' ? b.text : b.id)),
      background: d.pages[0].background,
    });
    const edited = { strokes: ['s2'], blocks: ['edited'], background: 'dots' };
    expect(shape(doc)).toEqual(edited);

    for (let i = 0; i < steps.length; i++) ({ journal: doc, stack } = undo(doc, stack));
    expect(shape(doc)).toEqual(shape(journal));
    expect(stack.done).toHaveLength(0);
    expect(stack.undone).toHaveLength(steps.length);

    // Дальше отменять нечего — и это не ошибка.
    expect(undo(doc, stack).journal).toBe(doc);

    for (let i = 0; i < steps.length; i++) ({ journal: doc, stack } = redo(doc, stack));
    expect(shape(doc)).toEqual(edited);
    expect(redo(doc, stack).journal).toBe(doc);
  });

  it('новое действие обнуляет отменённое — история линейная', () => {
    const journal = newJournal('Notes', 1);
    const page = journal.pages[0];
    let stack = push(emptyStack(), { type: 'strokes:add', page: page.id, strokes: [stroke('s1')] });
    ({ stack } = undo(journal, stack));
    expect(stack.undone).toHaveLength(1);

    stack = push(stack, { type: 'strokes:add', page: page.id, strokes: [stroke('s2')] });
    expect(stack.undone).toHaveLength(0);
    expect(stack.done).toHaveLength(1);
  });

  it('глубина стопки ограничена, вылетает самое старое', () => {
    const page = newJournal('Notes', 1).pages[0];
    let stack = emptyStack();
    for (let i = 0; i < 300; i++) {
      stack = push(stack, { type: 'strokes:add', page: page.id, strokes: [stroke(`s${i}`)] });
    }
    expect(stack.done).toHaveLength(250);
    expect(stack.done[0]).toMatchObject({ strokes: [{ id: 's50' }] });
  });

  it('вырванный лист возвращается на своё место', () => {
    const journal = newJournal('Notes', 2);
    const leaf = journal.pages.slice(2, 4);
    const command: Command = { type: 'pages:remove', at: 2, pages: leaf };

    const removed = applyCommand(journal, command);
    expect(removed.pages.map((p) => p.id)).toEqual(journal.pages.slice(0, 2).map((p) => p.id));

    const restored = applyCommand(removed, invert(command));
    expect(restored.pages.map((p) => p.id)).toEqual(journal.pages.map((p) => p.id));
  });
});
