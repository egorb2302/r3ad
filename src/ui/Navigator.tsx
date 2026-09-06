'use client';

/** Левая панель — оглавление и положение в книге. */
import { useBook } from '@/store/useBook';

export function Navigator() {
  const book = useBook((s) => s.book);
  const pagination = useBook((s) => s.pagination);
  const status = useBook((s) => s.status);
  const progress = useBook((s) => s.progress);
  const currentSheet = useBook((s) => s.currentSheet);
  const setSheet = useBook((s) => s.setSheet);

  const currentPage = currentSheet * 2;
  const activeChapter = pagination?.chapters.findLast((c) => c.startPage <= currentPage);

  return (
    <aside className="flex h-full w-[236px] shrink-0 flex-col border-r border-ink-800 bg-ink-900">
      <div className="border-b border-ink-800 px-3 py-3">
        <div className="text-[13px] font-medium text-ash-100">{book.title}</div>
        <div className="text-[11px] text-ash-400">{book.author}</div>
        <div className="tabular mt-1 text-[10.5px] text-ash-400">
          {(book.charCount / 1000).toFixed(0)}k characters · {book.chapters.length} chapters
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.13em] text-ash-400">
          Contents
        </span>
        {status === 'paginating' ? (
          <span className="tabular text-[10px] text-brass-500">
            {progress.done}/{progress.total}
          </span>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto py-1">
        {pagination
          ? pagination.chapters.map((chapter) => {
              const active = chapter.id === activeChapter?.id;
              return (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => setSheet(Math.floor(chapter.startPage / 2))}
                  className={`flex w-full items-baseline justify-between gap-2 px-3 py-[5px] text-left text-[11.5px] transition-colors ${
                    active
                      ? 'bg-ink-800 text-ash-100'
                      : 'text-ash-300 hover:bg-ink-850 hover:text-ash-100'
                  }`}
                >
                  <span className="truncate">{chapter.title}</span>
                  <span className="tabular shrink-0 text-[10.5px] text-ash-400">
                    {chapter.startPage + 1}
                  </span>
                </button>
              );
            })
          : (
            <p className="px-3 py-2 text-[11px] leading-relaxed text-ash-400">
              {status === 'paginating'
                ? 'Counting pages…'
                : 'Contents will appear once the text is composed.'}
            </p>
          )}
      </nav>
    </aside>
  );
}
