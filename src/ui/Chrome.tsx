'use client';

/** Верхняя строка и нижний тулбар вьюпорта. */
import { lastSpread, sheetsToThicknessMm } from '@/core/units';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { spreadPages } from '@/scene/usePageTextures';
import { JournalToolbar } from './journal/JournalToolbar';

export function Topbar({ onTogglePanels, panelsHidden }: { onTogglePanels: () => void; panelsHidden: boolean }) {
  const pagination = useBook((s) => s.pagination);
  const deskPages = useBook((s) => s.pages);
  const deskSheets = useBook((s) => s.sheets);
  const status = useBook((s) => s.status);
  const currentSheet = useBook((s) => s.currentSheet);

  const view = useLibrary((s) => s.view);
  const setView = useLibrary((s) => s.setView);
  const desk = useLibrary((s) => s.desk);
  const flight = useLibrary((s) => s.flight);
  const shelve = useLibrary((s) => s.shelve);

  const { right } = spreadPages(currentSheet, deskPages);
  const atDesk = view !== 'case';
  const journal = desk?.kind === 'journal';

  return (
    <header className="flex h-9 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-3">
      <div className="flex items-center gap-2 text-[11.5px]">
        <span className="font-medium tracking-tight text-brass-500">r3ad</span>
        <span className="text-ink-600">/</span>
        <button
          type="button"
          onClick={() => setView(atDesk ? 'case' : 'desk')}
          title={atDesk ? 'Look at the bookcase (Esc)' : 'Back to the desk (Esc)'}
          className="rounded px-1 text-ash-400 transition-colors hover:bg-ink-800 hover:text-ash-100"
        >
          {atDesk ? 'Desk' : 'Bookcase'}
        </button>
        {atDesk ? (
          <>
            <span className="text-ink-600">/</span>
            <span className="max-w-[280px] truncate text-ash-100">
              {desk ? desk.title : 'empty'}
            </span>
          </>
        ) : null}
        {atDesk && desk && right !== null ? (
          <>
            <span className="text-ink-600">/</span>
            <span className="tabular text-ash-400">p. {right + 1}</span>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        {desk && !flight ? (
          <button
            type="button"
            onClick={shelve}
            title="Close the book and send it to the shelf (S)"
            className="rounded bg-ink-800 px-2 py-0.5 text-[10.5px] text-ash-300 transition-colors hover:bg-ink-700 hover:text-ash-100"
          >
            shelve
          </button>
        ) : null}
        <span
          className={`tabular text-[10.5px] ${
            status === 'paginating' ? 'text-brass-500' : 'text-ash-400'
          }`}
        >
          {/* Пустой стол — нечего и считать: цифры прошлой книги тут врут */}
          {!desk
            ? '—'
            : journal
            ? `${deskPages} pp · ${sheetsToThicknessMm(deskSheets).toFixed(1)} mm`
            : status === 'reading'
              ? 'reading…'
              : status === 'paginating'
                ? 'composing…'
                : status === 'error'
                  ? 'error'
                  : pagination
                    ? `${pagination.pageCount} pp · ${pagination.thicknessMm.toFixed(1)} mm`
                    : 'preparing'}
        </span>
        <button
          type="button"
          onClick={onTogglePanels}
          title="Hide panels (Ctrl+\)"
          className="rounded px-1.5 py-0.5 text-[10.5px] text-ash-400 transition-colors hover:bg-ink-800 hover:text-ash-100"
        >
          {panelsHidden ? 'show panels' : 'hide panels'}
        </button>
      </div>
    </header>
  );
}

export function Toolbar() {
  const deskPages = useBook((s) => s.pages);
  const currentSheet = useBook((s) => s.currentSheet);
  const setSheet = useBook((s) => s.setSheet);
  const requestTurn = useBook((s) => s.requestTurn);
  const desk = useLibrary((s) => s.desk);

  // У тетради свой тулбар: там инструменты, а не только ход по книге.
  if (desk?.kind === 'journal') return <JournalToolbar />;
  if (!desk) return null;

  const last = lastSpread(deskPages);
  const { left, right } = spreadPages(currentSheet, deskPages);

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-ink-700 bg-ink-900/92 px-3 py-2 backdrop-blur">
      <button
        type="button"
        onClick={() => requestTurn(-1)}
        disabled={currentSheet === 0}
        className="h-6 w-6 rounded text-ash-300 transition-colors hover:bg-ink-800 hover:text-ash-100 disabled:opacity-30"
        aria-label="Previous spread"
      >
        ←
      </button>

      <input
        type="range"
        className="w-[280px]"
        min={0}
        max={last}
        step={1}
        value={currentSheet}
        onChange={(e) => setSheet(Number(e.target.value))}
        aria-label="Position in book"
      />

      <button
        type="button"
        onClick={() => requestTurn(1)}
        disabled={currentSheet >= last}
        className="h-6 w-6 rounded text-ash-300 transition-colors hover:bg-ink-800 hover:text-ash-100 disabled:opacity-30"
        aria-label="Next spread"
      >
        →
      </button>

      <span className="tabular w-[92px] shrink-0 text-right text-[11px] text-ash-400">
        {left !== null ? left + 1 : '—'} · {right !== null ? right + 1 : '—'}
      </span>
    </div>
  );
}
