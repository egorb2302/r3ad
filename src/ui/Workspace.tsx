'use client';

/**
 * Каркас воркспейса: навигатор слева, вьюпорт в центре, инспектор справа.
 *
 * Здесь же порядок запуска: сначала шрифты регистрируются в документе (иначе
 * композитор посчитает разбивку запасной гарнитурой и растр разойдётся с
 * вёрсткой), затем проба растеризатора, и только потом первая пагинация.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Navigator } from './Navigator';
import { Inspector } from './Inspector';
import { Topbar, Toolbar } from './Chrome';
import { FlatEditor } from './journal/FlatEditor';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { useJournal, type Tool } from '@/store/useJournal';
import { useClips } from '@/store/useClips';
import { useShare, adoptShelfFromUrl, restoreLibrary } from '@/store/useShare';
import { ShareDialog } from './share/ShareDialog';
import { R3AD_EXTENSION } from '@/core/share/pack';
import { useBoot } from './boot';

// three.js не переживает серверный рендер — грузим вьюпорт только в браузере.
const Viewport = dynamic(() => import('@/scene/Viewport').then((m) => m.Viewport), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-ink-950" />,
});

export function Workspace() {
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [dropping, setDropping] = useState(false);
  const boot = useBoot();

  const runPagination = useBook((s) => s.runPagination);
  const status = useBook((s) => s.status);
  const stage = useBook((s) => s.stage);
  const error = useBook((s) => s.error);
  const progress = useBook((s) => s.progress);
  const requestTurn = useBook((s) => s.requestTurn);
  const open = useBook((s) => s.open);

  const view = useLibrary((s) => s.view);
  const setView = useLibrary((s) => s.setView);
  const shelve = useLibrary((s) => s.shelve);
  const deskKind = useLibrary((s) => s.desk?.kind ?? null);

  const flatPage = useJournal((s) => s.flatPage);
  const flat = flatPage !== null;
  const insertImage = useJournal((s) => s.insertImage);
  const insertClipping = useJournal((s) => s.insertClipping);
  const unfurl = useClips((s) => s.unfurl);
  const importFile = useShare((s) => s.importFile);

  /**
   * Откуда взялась полка на этом экране.
   *
   * Порядок важен и разрешает спор в одну сторону: `?s=` в адресе побеждает
   * сохранённое. Человек перешёл по чужой ссылке — он пришёл смотреть её, а не
   * свою полку; своя при этом никуда не делась, она в базе, и вернётся, стоит
   * убрать параметр из адреса. Обратный порядок означал бы, что ссылка иногда
   * не открывается, и объяснить почему было бы нечем.
   *
   * И только после этого — первая вёрстка: она считает то, что в итоге лежит на
   * столе, а не то, что лежало до подъёма из базы.
   */
  useEffect(() => {
    if (boot !== 'ready') return;
    let alive = true;

    (async () => {
      const shared = new URLSearchParams(location.search).get('s');
      if (shared) {
        try {
          await adoptShelfFromUrl(shared);
        } catch {
          /* Испорченный адрес — не повод не открыться: останется своя полка. */
        }
      } else {
        await restoreLibrary();
      }
      if (alive) runPagination();
    })();

    return () => {
      alive = false;
    };
  }, [boot, runPagination]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const journal = useJournal.getState();
      const writing = deskKind === 'journal';

      // Пока на странице набирают текст, клавиатура принадлежит ему целиком.
      if (journal.editing) return;

      // Отмена — общая на всю тетрадь (SPEC §9.3), а не на страницу.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (!writing) return;
        e.preventDefault();
        if (e.shiftKey) journal.redo();
        else journal.undo();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === '\\') {
          e.preventDefault();
          setPanelsHidden((v) => !v);
        }
        return;
      }

      // Esc сначала поднимает от тетради и только потом уводит к стеллажу.
      if (e.key === 'Escape') {
        if (flat) journal.exitFlat();
        else setView(view === 'desk' ? 'case' : 'desk');
        return;
      }

      if (writing) {
        const tool = TOOL_KEYS[e.key.toLowerCase()];
        if (tool) {
          journal.setTool(tool);
          return;
        }
        if (flat && (e.key === 'Delete' || e.key === 'Backspace')) {
          journal.deleteSelection();
          return;
        }
      }

      if (e.key === 'n' || e.key === 'N') {
        journal.create();
        return;
      }

      // Ctrl+S занят браузером, поэтому «поделиться» — на Shift+S: буква та же,
      // а движение отличается ровно настолько, чтобы не путать с «на полку».
      // Проверка идёт первой: без неё Shift+S съедается «на полку» ниже.
      if (e.shiftKey && (e.key === 'S' || e.key === 's')) {
        useShare.getState().toggle(true);
        return;
      }

      if ((e.key === 's' || e.key === 'S') && !flat) {
        shelve();
        return;
      }

      /*
       * Ход по страницам. В плоском режиме единица — страница: правят её, а не
       * разворот, и стрелка обязана вести туда же, куда ведёт тулбар.
       */
      if (flat) {
        const page = journal.flatPage ?? 0;
        if (e.key === 'ArrowRight') journal.setFlatPage(page + 1);
        else if (e.key === 'ArrowLeft') journal.setFlatPage(page - 1);
        return;
      }

      if (view !== 'desk') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') requestTurn(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') requestTurn(-1);
    },
    [deskKind, flat, requestTurn, setView, shelve, view],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  /**
   * Скриншот из буфера — главный способ попасть картинке в конспект.
   *
   * Слушаем на окне, а не на холсте: событие вставки приходит туда, где фокус,
   * а фокуса на холсте может и не быть — по нему рисуют, а не кликают в него.
   */
  useEffect(() => {
    if (!flat) return;

    const onPaste = (event: ClipboardEvent) => {
      // В поле ввода вставка принадлежит полю: там набирают текст, а не кладут
      // на страницу.
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;

      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (file) {
        event.preventDefault();
        void insertImage(file).catch(() => undefined);
        return;
      }

      /*
       * Ссылка в буфере — это сценарий §4.2: вставили тред, он развернулся,
       * карточка легла на страницу. Отличаем её от обычного текста по форме,
       * а не по намерению: вставленный абзац ложиться карточкой не должен.
       */
      const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
      if (!/^https?:\/\/\S+$/i.test(text)) return;

      event.preventDefault();
      void unfurl(text).then((clipping) => {
        if (clipping) insertClipping(clipping);
      });
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [flat, insertClipping, insertImage, unfurl]);

  /**
   * Счётчик глубины перетаскивания.
   *
   * dragleave прилетает и при переходе указателя между вложенными элементами,
   * поэтому одним булевым флагом подсветка мигает. Считаем входы и выходы.
   */
  const dragDepth = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth.current += 1;
    setDropping(true);
  }, []);

  const onDragLeave = useCallback(() => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDropping(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;

      // Бандл — не книга и не картинка: это полка целиком, и она встаёт рядом
      // со своей, а не открывается на столе.
      if (file.name.toLowerCase().endsWith(R3AD_EXTENSION)) {
        void importFile(file);
        return;
      }

      // Над раскрытой тетрадью картинка ложится на страницу, а не открывается
      // книгой: перетащить скриншот в конспект — обычное движение, а «открыть
      // png томом» не значит ничего.
      if (flat && file.type.startsWith('image/')) void insertImage(file).catch(() => undefined);
      else void open(file);
    },
    [flat, importFile, insertImage, open],
  );

  return (
    <div
      className="flex h-dvh w-full flex-col bg-ink-950"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Topbar panelsHidden={panelsHidden} onTogglePanels={() => setPanelsHidden((v) => !v)} />

      <div className="flex min-h-0 flex-1">
        {!panelsHidden && <Navigator />}

        <main className="relative min-w-0 flex-1">
          {boot === 'ready' ? <Viewport /> : <div className="h-full w-full bg-ink-950" />}

          {!panelsHidden && view !== 'case' && <Toolbar />}
          {/* Ключ — номер страницы: у каждой свой масштаб и своя панорама */}
          {flat && <FlatEditor key={flatPage} />}

          {(boot !== 'ready' || status === 'reading' || status === 'paginating' || status === 'error') && (
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
              <div className="rounded-md border border-ink-700 bg-ink-900/92 px-3 py-1.5 text-[11px] text-ash-300 backdrop-blur">
                {boot === 'fonts' && 'Loading fonts and probing the rasterizer…'}
                {boot === 'failed' && 'Fonts failed to load — run node scripts/fetch-fonts.mjs'}
                {boot === 'ready' && status === 'reading' && (
                  <span className="tabular">
                    {stage || 'Reading the file'}
                    {progress.total > 0 ? ` — chapter ${progress.done} of ${progress.total}` : ''}…
                  </span>
                )}
                {boot === 'ready' && status === 'paginating' && (
                  <span className="tabular">
                    Composing chapter {progress.done} of {progress.total}…
                  </span>
                )}
                {boot === 'ready' && status === 'error' && (
                  <span className="text-red-300">{error}</span>
                )}
              </div>
            </div>
          )}

          {dropping && (
            <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-lg border-2 border-dashed border-brass-500/70 bg-ink-950/70 backdrop-blur-sm">
              <span className="text-[12.5px] text-brass-400">
              {flat ? 'Drop an image onto the page' : 'Drop an EPUB, TXT, Markdown or .r3ad file'}
            </span>
            </div>
          )}
        </main>

        {!panelsHidden && <Inspector />}
      </div>

      <ShareDialog />
    </div>
  );
}

/** Буквы инструментов из SPEC §12.3. Раскладка фигмоподобная намеренно. */
const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  b: 'pen',
  h: 'marker',
  e: 'eraser',
  t: 'text',
  i: 'image',
  l: 'clip',
};
