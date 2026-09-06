'use client';

/**
 * Тулбар тетради: инструменты, отмена, ход по страницам.
 *
 * Раскладка и буквы — из SPEC §12.3, то есть фигмоподобные намеренно: человек,
 * который рисует, эти клавиши уже знает, и переучивать его ради оригинальности
 * незачем.
 *
 * Листание здесь идёт по страницам, а не по разворотам. В плоском режиме
 * страница и есть единица работы, и «следующая» означает следующую страницу, а
 * не следующую пару.
 */
import { lastSpread } from '@/core/units';
import { useBook } from '@/store/useBook';
import { useJournal, type Tool } from '@/store/useJournal';
import { ToolIcon, UndoIcon } from './icons';

const TOOLS: { tool: Tool; key: string; title: string }[] = [
  { tool: 'select', key: 'V', title: 'Select and move blocks' },
  { tool: 'pen', key: 'B', title: 'Pen — pressure sensitive' },
  { tool: 'marker', key: 'H', title: 'Marker — multiply blend' },
  { tool: 'eraser', key: 'E', title: 'Eraser — removes whole strokes' },
  { tool: 'text', key: 'T', title: 'Text block' },
  { tool: 'image', key: 'I', title: 'Insert an image' },
  { tool: 'clip', key: 'L', title: 'Place the chosen clipping' },
];

export function JournalToolbar() {
  const openId = useJournal((s) => s.openId);
  const docs = useJournal((s) => s.docs);
  const stacks = useJournal((s) => s.stacks);
  const tool = useJournal((s) => s.tool);
  const flatPage = useJournal((s) => s.flatPage);
  const setTool = useJournal((s) => s.setTool);
  const setFlatPage = useJournal((s) => s.setFlatPage);
  const enterFlat = useJournal((s) => s.enterFlat);
  const exitFlat = useJournal((s) => s.exitFlat);
  const undo = useJournal((s) => s.undo);
  const redo = useJournal((s) => s.redo);

  const currentSheet = useBook((s) => s.currentSheet);
  const requestTurn = useBook((s) => s.requestTurn);

  const journal = openId ? docs[openId] ?? null : null;
  if (!journal) return null;

  const stack = openId ? stacks[openId] : undefined;
  const flat = flatPage !== null;
  const page = flat ? flatPage : currentSheet * 2;
  const last = journal.pages.length - 1;

  const step = (dir: 1 | -1) => {
    if (flat) setFlatPage(Math.min(Math.max(page + dir, 0), last));
    else requestTurn(dir);
  };

  // z-30 — поверх затемнения плоского режима: инструменты нужны как раз в нём.
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/92 px-2.5 py-2 backdrop-blur">
      <div className="flex items-center gap-0.5">
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            type="button"
            onClick={() => setTool(entry.tool)}
            title={`${entry.title} (${entry.key})`}
            aria-pressed={tool === entry.tool && flat}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              tool === entry.tool && flat
                ? 'bg-brass-500/20 text-brass-300'
                : 'text-ash-400 hover:bg-ink-800 hover:text-ash-100'
            }`}
          >
            <ToolIcon tool={entry.tool} />
          </button>
        ))}
      </div>

      <span className="h-5 w-px bg-ink-700" />

      <button
        type="button"
        onClick={undo}
        disabled={!stack || stack.done.length === 0}
        title="Undo (Ctrl+Z)"
        className="flex h-7 w-7 items-center justify-center rounded text-ash-400 transition-colors hover:bg-ink-800 hover:text-ash-100 disabled:opacity-25 disabled:hover:bg-transparent"
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!stack || stack.undone.length === 0}
        title="Redo (Ctrl+Shift+Z)"
        className="flex h-7 w-7 items-center justify-center rounded text-ash-400 transition-colors hover:bg-ink-800 hover:text-ash-100 disabled:opacity-25 disabled:hover:bg-transparent"
      >
        <UndoIcon flip />
      </button>

      <span className="h-5 w-px bg-ink-700" />

      <button
        type="button"
        onClick={() => step(-1)}
        disabled={page <= 0}
        className="h-7 w-7 rounded text-ash-300 transition-colors hover:bg-ink-800 hover:text-ash-100 disabled:opacity-30"
        aria-label="Previous page"
      >
        ←
      </button>
      <span className="tabular w-[74px] shrink-0 text-center text-[11px] text-ash-400">
        p. {page + 1} / {journal.pages.length}
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={flat ? page >= last : currentSheet >= lastSpread(journal.pages.length)}
        className="h-7 w-7 rounded text-ash-300 transition-colors hover:bg-ink-800 hover:text-ash-100 disabled:opacity-30"
        aria-label="Next page"
      >
        →
      </button>

      <span className="h-5 w-px bg-ink-700" />

      <button
        type="button"
        onClick={() => (flat ? exitFlat() : enterFlat())}
        title={flat ? 'Back to the desk (Esc)' : 'Lean in and write'}
        className={`h-7 rounded px-2 text-[11px] transition-colors ${
          flat
            ? 'bg-ink-800 text-ash-300 hover:bg-ink-700 hover:text-ash-100'
            : 'bg-brass-500/20 text-brass-300 hover:bg-brass-500/30'
        }`}
      >
        {flat ? 'done' : 'write'}
      </button>
    </div>
  );
}
