'use client';

/** Верхняя строка и нижний тулбар вьюпорта. */
import { useBook } from '@/store/useBook';
import { spreadPages } from '@/scene/usePageTextures';

export function Topbar({ onTogglePanels, panelsHidden }: { onTogglePanels: () => void; panelsHidden: boolean }) {
  const doc = useBook((s) => s.doc);
  const pagination = useBook((s) => s.pagination);
  const status = useBook((s) => s.status);
  const currentSheet = useBook((s) => s.currentSheet);

  const { right } = spreadPages(currentSheet, pagination?.pageCount ?? 0);

  return (
    <header className="flex h-9 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-3">
      <div className="flex items-center gap-2 text-[11.5px]">
        <span className="font-medium tracking-tight text-brass-500">r3ad</span>
        <span className="text-ink-600">/</span>
        <span className="text-ash-400">Desk</span>
        <span className="text-ink-600">/</span>
        <span className="max-w-[280px] truncate text-ash-100">{doc.title}</span>
        {right !== null ? (
          <>
            <span className="text-ink-600">/</span>
            <span className="tabular text-ash-400">p. {right + 1}</span>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <span
          className={`tabular text-[10.5px] ${
            status === 'paginating' ? 'text-brass-500' : 'text-ash-400'
          }`}
        >
          {status === 'reading'
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
  const pagination = useBook((s) => s.pagination);
  const currentSheet = useBook((s) => s.currentSheet);
  const setSheet = useBook((s) => s.setSheet);
  const requestTurn = useBook((s) => s.requestTurn);

  const sheets = pagination?.sheetCount ?? 1;
  const { left, right } = spreadPages(currentSheet, pagination?.pageCount ?? 0);

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
        max={Math.max(0, sheets - 1)}
        step={1}
        value={currentSheet}
        onChange={(e) => setSheet(Number(e.target.value))}
        aria-label="Position in book"
      />

      <button
        type="button"
        onClick={() => requestTurn(1)}
        disabled={currentSheet >= sheets - 1}
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
