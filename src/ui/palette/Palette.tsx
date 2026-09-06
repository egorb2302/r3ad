'use client';

/**
 * Палитра команд и поиск по книге (⌘K / ⌘F, §12.3).
 *
 * Два режима в одном окне, потому что это одно движение: открыл, набрал,
 * выбрал. Разница только в том, по чему идёт набранное — по списку команд или
 * по тексту книги.
 *
 * Поиск отвечает разным в разных режимах, и это следствие §6.4, а не небрежность.
 * В плоском режиме текст главы лежит в DOM, поэтому найденное подсвечивается на
 * своём месте и туда же прокручивается. В сцене текста нет — есть растр, а
 * содержимое колонки браузер наружу не отдаёт, — и самое точное, что можно
 * сделать, это открыть главу, в которой найдено. Поэтому у каждой находки два
 * действия: ↵ ведёт туда, где мы есть, ⇧↵ открывает то же место текстом.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchDoc, type Hit } from '@/core/plain';
import { useBook } from '@/store/useBook';
import { useShell, type PaletteMode } from '@/store/useShell';
import { buildCommands, type Command } from './commands';

export function Palette() {
  const mode = useShell((s) => s.palette);
  // Ключ по режиму: переключение ⌘K → ⌘F начинает набор заново, а не дописывает
  // запрос к предыдущему.
  return mode ? <PaletteBox key={mode} mode={mode} /> : null;
}

/** Простое вхождение подстроки по названию и группе. Нечёткий поиск тут только мешает. */
function match(command: Command, query: string): boolean {
  if (!query) return true;
  const haystack = `${command.group} ${command.title}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

function PaletteBox({ mode }: { mode: PaletteMode }) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);

  const close = useShell((s) => s.closePalette);
  const reveal = useShell((s) => s.reveal);
  const setMode = useShell((s) => s.setMode);
  const plain = useShell((s) => s.mode === 'plain');

  const chapters = useBook((s) => s.doc.chapters);
  const pagination = useBook((s) => s.pagination);

  const list = useRef<HTMLDivElement>(null);

  const commands = useMemo(() => (mode === 'commands' ? buildCommands() : []), [mode]);

  const shown = useMemo(
    () => (mode === 'commands' ? commands.filter((c) => match(c, query)) : []),
    [commands, mode, query],
  );

  /*
   * Поиск по всей книге на каждое нажатие. Это indexOf по паре сотен тысяч
   * знаков — доли миллисекунды, дешевле любого индекса, который пришлось бы
   * пересобирать на каждой смене книги.
   */
  const hits = useMemo(
    () => (mode === 'search' ? searchDoc(chapters, pagination, query) : []),
    [chapters, mode, pagination, query],
  );

  const count = mode === 'commands' ? shown.length : hits.length;
  const cursor = Math.min(at, Math.max(0, count - 1));

  // Держим выбранное в поле зрения: список длиннее окна почти всегда.
  useEffect(() => {
    list.current?.querySelector('[data-at="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, count]);

  const openHit = (hit: Hit, asText: boolean) => {
    reveal(hit.chapterId, query, hit.nth);
    if (hit.page !== null) useBook.getState().setSheet(Math.floor(hit.page / 2));
    if (asText && !plain) setMode('plain');
    close();
  };

  const run = (shift: boolean) => {
    if (mode === 'commands') {
      const command = shown[cursor];
      if (!command) return;
      close();
      command.run();
      return;
    }
    const hit = hits[cursor];
    if (hit) openHit(hit, shift);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setAt(Math.min(cursor + 1, count - 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setAt(Math.max(cursor - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(e.shiftKey);
    }
  };

  let group = '';

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center bg-ink-950/55 pt-[12vh] backdrop-blur-[2px]"
      onPointerDown={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'search' ? 'Search this book' : 'Commands'}
        className="flex max-h-[70vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={onKey}
          placeholder={mode === 'search' ? 'Find in this book…' : 'Type a command…'}
          aria-label={mode === 'search' ? 'Find in this book' : 'Type a command'}
          className="h-11 shrink-0 border-b border-ink-800 bg-transparent px-3.5 text-[13.5px] text-ash-100 outline-none placeholder:text-ash-400/60"
        />

        <div ref={list} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {count === 0 ? (
            <p className="px-3.5 py-3 text-[12px] text-ash-400">
              {mode === 'search'
                ? query.trim().length < 2
                  ? 'Two letters or more.'
                  : 'Nothing in this book.'
                : 'No such command.'}
            </p>
          ) : null}

          {mode === 'commands'
            ? shown.map((command, i) => {
                const heading = command.group !== group ? command.group : null;
                group = command.group;
                return (
                  <div key={command.id}>
                    {heading ? (
                      <p className="px-3.5 pb-1 pt-2.5 text-[10px] uppercase tracking-[0.13em] text-ash-400/70">
                        {heading}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      data-at={i === cursor}
                      onPointerEnter={() => setAt(i)}
                      onClick={() => {
                        close();
                        command.run();
                      }}
                      className={`flex w-full items-baseline justify-between gap-3 px-3.5 py-1.5 text-left text-[12.5px] ${
                        i === cursor ? 'bg-ink-800 text-ash-100' : 'text-ash-300'
                      }`}
                    >
                      <span className="truncate">{command.title}</span>
                      {command.hint ? (
                        <span className="tabular shrink-0 text-[10.5px] text-ash-400">
                          {command.hint}
                        </span>
                      ) : null}
                    </button>
                  </div>
                );
              })
            : hits.map((hit, i) => (
                <button
                  key={`${hit.chapterId}:${hit.nth}`}
                  type="button"
                  data-at={i === cursor}
                  onPointerEnter={() => setAt(i)}
                  onClick={(e) => openHit(hit, e.shiftKey)}
                  className={`block w-full px-3.5 py-1.5 text-left ${
                    i === cursor ? 'bg-ink-800' : ''
                  }`}
                >
                  <span className="block truncate text-[12.5px] text-ash-300">
                    <span className="opacity-60">{hit.before}</span>
                    <mark className="bg-brass-700/60 text-ash-100">{hit.match}</mark>
                    <span className="opacity-60">{hit.after}</span>
                  </span>
                  <span className="tabular block truncate text-[10.5px] text-ash-400">
                    {hit.title}
                    {hit.page !== null ? ` · p. ${hit.page + 1}` : ''}
                  </span>
                </button>
              ))}
        </div>

        <p className="tabular shrink-0 border-t border-ink-800 px-3.5 py-1.5 text-[10px] text-ash-400">
          {mode === 'search'
            ? plain
              ? '↵ go to the line · Esc close'
              : '↵ open that chapter · ⇧↵ open it as text · Esc close'
            : '↑↓ move · ↵ run · Esc close'}
        </p>
      </div>
    </div>
  );
}
