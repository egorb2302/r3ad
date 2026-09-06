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
import { ensureDocumentFonts, fontCssForText } from '@/core/rasterize/fonts';
import { probeRasterizer } from '@/core/rasterize/svgRasterizer';

// three.js не переживает серверный рендер — грузим вьюпорт только в браузере.
const Viewport = dynamic(() => import('@/scene/Viewport').then((m) => m.Viewport), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-ink-950" />,
});

export function Workspace() {
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [boot, setBoot] = useState<'fonts' | 'ready' | 'failed'>('fonts');
  const [dropping, setDropping] = useState(false);

  const runPagination = useBook((s) => s.runPagination);
  const setProbe = useBook((s) => s.setProbe);
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

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        await ensureDocumentFonts('body');
        if (!alive) return;

        const probeCss = await fontCssForText('Probe Ag', 'body');
        setProbe(await probeRasterizer(probeCss.css));
        if (!alive) return;

        setBoot('ready');
        runPagination();
      } catch (err) {
        if (!alive) return;
        setBoot('failed');
        setProbe({ ok: false, inkRatio: 0, note: `Fonts failed to load: ${String(err)}` });
      }
    })();

    return () => {
      alive = false;
    };
  }, [runPagination, setProbe]);

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
      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void insertImage(file).catch(() => undefined);
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [flat, insertImage]);

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

      // Над раскрытой тетрадью картинка ложится на страницу, а не открывается
      // книгой: перетащить скриншот в конспект — обычное движение, а «открыть
      // png томом» не значит ничего.
      if (flat && file.type.startsWith('image/')) void insertImage(file).catch(() => undefined);
      else void open(file);
    },
    [flat, insertImage, open],
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
              {flat ? 'Drop an image onto the page' : 'Drop an EPUB, TXT or Markdown file'}
            </span>
            </div>
          )}
        </main>

        {!panelsHidden && <Inspector />}
      </div>
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
};
