'use client';

/**
 * Плоский режим целиком: шапка воркспейса и книга обычным HTML (§17).
 *
 * Заменяет собой весь экран, а не только вьюпорт, и это главное решение здесь.
 * Соблазн был показать плоскую книгу внутри той же оболочки — с навигатором и
 * инспектором по краям, — но тогда режим перестал бы делать то, ради чего он
 * заведён: на машине без WebGL2 инспектор нечем наполнить (кегль меняет
 * толщину книги, которой не видно), а модуль сцены всё равно бы загрузился
 * ради разметки вокруг него. Здесь же его нет вовсе: `three` в эту ветку не
 * импортируется ни одной строкой.
 *
 * Бумага — та же, что у книги на столе (§8). Не косметика: тон бумаги человек
 * выбрал сам, и плоский режим — не другая книга, а та же самая, набранная в
 * другой среде.
 */
import { useEffect } from 'react';
import { chapterAtPage, plainFontPx } from '@/core/plain';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { forcedMode, useShell } from '@/store/useShell';
import { retryScene } from '../useDevice';
import { PlainBody } from './PlainBody';

/** Пределы кегля те же, что в инспекторе: это одна и та же настройка. */
const SIZE = { min: 7, max: 18, step: 0.5 };

export function PlainReader() {
  const doc = useBook((s) => s.doc);
  const typography = useBook((s) => s.typography);
  const setTypography = useBook((s) => s.setTypography);
  const pagination = useBook((s) => s.pagination);
  const currentSheet = useBook((s) => s.currentSheet);

  const view = useLibrary((s) => s.view);
  const setView = useLibrary((s) => s.setView);
  const desk = useLibrary((s) => s.desk);

  const device = useShell((s) => s.device);
  // На узком экране в шапке остаётся только выбор главы и кегль: остальное
  // видно и так — какая книга открыта, написано на самой странице.
  const compact = device.compact;
  const reason = useShell((s) => s.reason);
  const setMode = useShell((s) => s.setMode);
  const openPalette = useShell((s) => s.openPalette);
  const chapter = useShell((s) => s.chapter);
  const setChapter = useShell((s) => s.setChapter);

  // Та же подстановка, что в PlainBook: свой выбор главы, а если его нет — та,
  // на которой стоит книга.
  const standing = chapterAtPage(pagination, currentSheet * 2)?.id;
  const shown = chapter ?? standing ?? doc.chapters[0]?.id ?? '';

  const journal = desk?.kind === 'journal';
  const atShelf = view === 'case';

  /*
   * Стрелки листают главы. В 3D та же клавиша листает страницы, и это не
   * рассогласование, а разные единицы: страницы здесь нет (см. core/plain), и
   * ближайшее, чем стрелка может распорядиться, — глава.
   */
  useEffect(() => {
    if (atShelf || journal) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      const state = useShell.getState();
      const book = useBook.getState();
      const chapters = book.doc.chapters;
      // Своего выбора может не быть — тогда шагаем от той главы, которая видна.
      const active =
        state.chapter ?? chapterAtPage(book.pagination, book.currentSheet * 2)?.id ?? chapters[0]?.id;
      const at = Math.max(0, chapters.findIndex((c) => c.id === active));
      const next = chapters[at + (e.key === 'ArrowRight' ? 1 : -1)];
      if (next) {
        e.preventDefault();
        state.setChapter(next.id);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [atShelf, journal]);

  const title = atShelf ? 'The shelf' : desk?.title ?? doc.title;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-ink-950">
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-ink-800 bg-ink-900 px-3">
        <div className="flex min-w-0 items-center gap-2 text-[11.5px]">
          {compact ? null : (
            <>
              <span className="font-medium tracking-tight text-brass-500">r3ad</span>
              <span className="text-ink-600">/</span>
            </>
          )}
          <button
            type="button"
            onClick={() => setView(atShelf ? 'desk' : 'case')}
            className="shrink-0 rounded px-1 text-ash-400 transition-colors hover:bg-ink-800 hover:text-ash-100"
          >
            {atShelf ? 'Desk' : 'Bookcase'}
          </button>
          {compact ? null : (
            <>
              <span className="text-ink-600">/</span>
              <span className="max-w-[240px] truncate text-ash-100">{title}</span>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {!atShelf && !journal && doc.chapters.length > 1 ? (
            <select
              value={shown}
              onChange={(e) => setChapter(e.target.value)}
              aria-label="Chapter"
              className="h-[22px] min-w-0 max-w-[190px] flex-1 rounded border border-ink-700 bg-ink-850 px-1 text-[11px] text-ash-200 outline-none"
            >
              {/* Своей нумерации не добавляем: у половины книг она уже в названии главы. */}
              {doc.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          ) : null}

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTypography({ sizePt: Math.max(SIZE.min, typography.sizePt - SIZE.step) })}
              title="Smaller type"
              aria-label="Smaller type"
              className="h-[22px] w-[22px] rounded bg-ink-800 text-[12px] text-ash-300 hover:text-ash-100"
            >
              −
            </button>
            <span className="tabular w-[34px] text-center text-[10.5px] text-ash-400">
              {plainFontPx(typography)}px
            </span>
            <button
              type="button"
              onClick={() => setTypography({ sizePt: Math.min(SIZE.max, typography.sizePt + SIZE.step) })}
              title="Larger type"
              aria-label="Larger type"
              className="h-[22px] w-[22px] rounded bg-ink-800 text-[12px] text-ash-300 hover:text-ash-100"
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={() => openPalette('search')}
            title="Search this book (Ctrl+F)"
            className="rounded bg-ink-800 px-2 py-0.5 text-[10.5px] text-ash-300 transition-colors hover:bg-ink-700 hover:text-ash-100"
          >
            find
          </button>

          {/*
            Кнопки «в 3D» нет там, где 3D нет. Предлагать вернуться в сцену,
            которую машина не тянет, — это отправить человека в чёрный экран и
            обратно.
          */}
          {device.scene ? (
            <button
              type="button"
              onClick={() => setMode('scene')}
              title="Back to the book in 3D"
              className="rounded bg-ink-800 px-2 py-0.5 text-[10.5px] text-ash-300 transition-colors hover:bg-ink-700 hover:text-ash-100"
            >
              3D
            </button>
          ) : null}
        </div>
      </header>

      {/*
        Плашка объясняет не выбор, а обстоятельства, и потому у неё есть кнопка.
        Отказ железа не вечен: контекст возвращают, ускорение включают обратно,
        запись экрана заканчивается. Без кнопки единственным способом проверить,
        не прошло ли это, была бы перезагрузка страницы — а вместе с ней ушли бы
        и место в книге, и незаписанная страница тетради.
      */}
      {forcedMode(reason) ? (
        <p className="flex shrink-0 flex-wrap items-center gap-2 border-b border-brass-900/60 bg-brass-950/40 px-3 py-1.5 text-[11px] text-brass-300">
          {reason === 'no-webgl'
            ? 'This browser has no WebGL2, so the book is shown as text. Everything else works.'
            : 'The 3D view lost its graphics context, so the book is shown as text. Everything else works.'}
          <button
            type="button"
            onClick={retryScene}
            className="rounded bg-brass-900/60 px-2 py-0.5 text-[10.5px] text-brass-200 transition-colors hover:bg-brass-800/70 hover:text-brass-100"
          >
            Try 3D again
          </button>
        </p>
      ) : null}

      <main className="min-h-0 flex-1">
        <PlainBody />
      </main>

      {/*
        Номера страниц внизу — единственная ниточка между режимами, которую тут
        видно: сколько их всего и на какой стоит книга в 3D.
      */}
      {!atShelf && !journal && pagination ? (
        <footer className="tabular shrink-0 border-t border-ink-800 bg-ink-900 px-3 py-1 text-[10.5px] text-ash-400">
          {pagination.pageCount} pp · {pagination.thicknessMm.toFixed(1)} mm
        </footer>
      ) : null}
    </div>
  );
}
