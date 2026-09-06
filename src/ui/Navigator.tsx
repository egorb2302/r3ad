'use client';

/** Левая панель — источник, оглавление и положение в книге; у стеллажа — список полки. */
import { useMemo, useRef } from 'react';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { volumeExtent } from '@/core/library/volume';
import { typographyKey } from '@/core/paginate/paginate';

export function Navigator() {
  const doc = useBook((s) => s.doc);
  const pagination = useBook((s) => s.pagination);
  const status = useBook((s) => s.status);
  const progress = useBook((s) => s.progress);
  const currentSheet = useBook((s) => s.currentSheet);
  const setSheet = useBook((s) => s.setSheet);
  const open = useBook((s) => s.open);
  const openSynthetic = useBook((s) => s.openSynthetic);
  const metrics = useBook((s) => s.metrics);
  const typography = useBook((s) => s.typography);

  const view = useLibrary((s) => s.view);
  const shelved = useLibrary((s) => s.volumes);
  const hovered = useLibrary((s) => s.hovered);
  const armed = useLibrary((s) => s.armed);
  const hover = useLibrary((s) => s.hover);
  const take = useLibrary((s) => s.take);

  const typeKey = useMemo(() => typographyKey(metrics, typography), [metrics, typography]);

  const input = useRef<HTMLInputElement>(null);

  const currentPage = currentSheet * 2;
  const activeChapter = pagination?.chapters.findLast((c) => c.startPage <= currentPage);

  /**
   * Вложенность берём из оглавления книги, а нумерацию страниц — из разбивки.
   * Порядок и страницы знает только конвейер, иерархию — только исходный файл.
   */
  const depthOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of doc.toc) {
      const known = map.get(entry.chapterId);
      if (known === undefined || entry.depth < known) map.set(entry.chapterId, entry.depth);
    }
    return map;
  }, [doc.toc]);

  return (
    <aside className="flex h-full w-[236px] shrink-0 flex-col border-r border-ink-800 bg-ink-900">
      <div className="border-b border-ink-800 px-3 py-3">
        <div className="truncate text-[13px] font-medium text-ash-100" title={doc.title}>
          {doc.title}
        </div>
        <div className="truncate text-[11px] text-ash-400">{doc.author}</div>
        <div className="tabular mt-1 text-[10.5px] text-ash-400">
          {(doc.charCount / 1000).toFixed(0)}k characters · {doc.chapters.length} chapters
          {doc.imageCount > 0 ? ` · ${doc.imageCount} images` : ''}
        </div>

        <div className="mt-2.5 flex gap-1.5">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="h-[22px] flex-1 rounded bg-ink-700 text-[11px] text-ash-100 transition-colors hover:bg-ink-600"
          >
            Open book
          </button>
          {doc.format !== 'synthetic' ? (
            <button
              type="button"
              onClick={openSynthetic}
              title="Back to the generated demo volume"
              className="h-[22px] rounded bg-ink-800 px-2 text-[11px] text-ash-400 transition-colors hover:text-ash-100"
            >
              demo
            </button>
          ) : null}
        </div>

        <input
          ref={input}
          type="file"
          accept=".epub,.txt,.md,.markdown"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Сбрасываем значение: иначе повторный выбор того же файла не сработает.
            e.target.value = '';
            if (file) void open(file);
          }}
        />
      </div>

      <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.13em] text-ash-400">
          {view === 'case' ? `Shelf · ${shelved.length}` : 'Contents'}
        </span>
        {status === 'paginating' ? (
          <span className="tabular text-[10px] text-brass-500">
            {progress.done}/{progress.total}
          </span>
        ) : null}
      </div>

      {/*
        У стеллажа список — это сама полка: те же тома, тот же порядок, те же
        цвета. Панель и сцена показывают одно и то же двумя способами, и щелчок
        в списке делает ровно то же, что щелчок по корешку.
      */}
      {view === 'case' ? (
        <nav className="flex-1 overflow-y-auto py-1" onPointerLeave={() => hover(null)}>
          {shelved.map((volume) => {
            const extent = volumeExtent(volume, metrics, typeKey);
            const active = volume.id === hovered || volume.id === armed;
            return (
              <button
                key={volume.id}
                type="button"
                onPointerEnter={() => hover(volume.id)}
                onClick={() => take(volume.id)}
                className={`flex w-full items-center gap-2 py-[5px] pl-3 pr-3 text-left transition-colors ${
                  active ? 'bg-ink-800' : 'hover:bg-ink-850'
                }`}
              >
                <span
                  className="h-[18px] w-[3px] shrink-0 rounded-sm"
                  style={{ backgroundColor: volume.palette.cloth }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] text-ash-100" title={volume.title}>
                    {volume.title}
                  </span>
                  <span className="block truncate text-[10px] text-ash-400">{volume.author}</span>
                </span>
                <span
                  className="tabular shrink-0 text-[10.5px] text-ash-400"
                  title={extent.exact ? 'Composed' : 'Estimated from the character count'}
                >
                  {extent.exact ? '' : '~'}
                  {extent.pages}
                </span>
              </button>
            );
          })}
        </nav>
      ) : (
      <nav className="flex-1 overflow-y-auto py-1">
        {pagination ? (
          pagination.chapters.map((chapter) => {
            const active = chapter.id === activeChapter?.id;
            const depth = Math.min(depthOf.get(chapter.id) ?? 0, 3);
            return (
              <button
                key={chapter.id}
                type="button"
                onClick={() => setSheet(Math.floor(chapter.startPage / 2))}
                style={{ paddingLeft: 12 + depth * 11 }}
                className={`flex w-full items-baseline justify-between gap-2 py-[5px] pr-3 text-left text-[11.5px] transition-colors ${
                  active
                    ? 'bg-ink-800 text-ash-100'
                    : 'text-ash-300 hover:bg-ink-850 hover:text-ash-100'
                }`}
              >
                <span className="truncate" title={chapter.title}>
                  {chapter.title}
                </span>
                <span className="tabular shrink-0 text-[10.5px] text-ash-400">
                  {chapter.startPage + 1}
                </span>
              </button>
            );
          })
        ) : (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-ash-400">
            {status === 'reading'
              ? 'Unpacking the file…'
              : status === 'paginating'
                ? 'Counting pages…'
                : 'Contents will appear once the text is composed.'}
          </p>
        )}
      </nav>
      )}
    </aside>
  );
}
