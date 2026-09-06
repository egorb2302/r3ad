'use client';

/**
 * Воркспейс со сценой: вьюпорт во весь экран, панели выдвигаются поверх него.
 *
 * Всё, что не про 3D, — запуск, приём файлов, палитра, горячие клавиши общего
 * назначения — живёт этажом выше, в `Workspace`. Разделение появилось на M7
 * вместе с плоским режимом и ровно ради него: половина оболочки нужна обоим
 * режимам, а вторая половина тянет за собой three, и на машине без WebGL2 её не
 * должно быть в загрузке вовсе.
 *
 * Клавиши книги и тетради остались здесь, а не уехали наверх: они относятся к
 * тому, что показывает эта половина. В плоском режиме «S — на полку» означало
 * бы анимацию, которой некому играть, а «B — перо» — инструмент, которым не по
 * чему рисовать.
 */
import { useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Navigator } from './Navigator';
import { Inspector } from './Inspector';
import { Topbar, Toolbar } from './Chrome';
import { Icon } from './icons';
import { FlatEditor } from './journal/FlatEditor';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { useJournal, type Tool } from '@/store/useJournal';
import { useShare } from '@/store/useShare';
import { useShell } from '@/store/useShell';
import type { BootStage } from './boot';

// three.js не переживает серверный рендер — грузим вьюпорт только в браузере.
const Viewport = dynamic(() => import('@/scene/Viewport').then((m) => m.Viewport), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-ink-950" />,
});

export function SceneWorkspace({ boot }: { boot: BootStage }) {
  const status = useBook((s) => s.status);
  const stage = useBook((s) => s.stage);
  const error = useBook((s) => s.error);
  const progress = useBook((s) => s.progress);
  const requestTurn = useBook((s) => s.requestTurn);

  const view = useLibrary((s) => s.view);
  const setView = useLibrary((s) => s.setView);
  const shelve = useLibrary((s) => s.shelve);
  const deskKind = useLibrary((s) => s.desk?.kind ?? null);
  const deskTint = useLibrary((s) => s.desk?.theme.paper.tint ?? 'cream');

  const flatPage = useJournal((s) => s.flatPage);
  const flat = flatPage !== null;

  const panels = useShell((s) => s.panels);
  const compact = useShell((s) => s.device.compact);

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

      // Остальные сочетания с модификатором — общие, их разбирает Workspace.
      if (e.ctrlKey || e.metaKey) return;

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

  /*
   * Панели лежат поверх сцены, а не рядом с ней, и по умолчанию убраны.
   *
   * Сцена — то, ради чего проект есть, и первым на экране должна быть книга,
   * а не два столбца настроек по бокам. Кнопка в шапке выдвигает оба, и
   * сцена под ними не перевёрстывается: холст не меняет размер, камера не
   * пересчитывает кадр, а книга не ёрзает от того, что открыли инспектор.
   *
   * На узком экране обе панели лежат в одном ящике слева, навигатор над
   * инспектором: 236 и 214 пикселей на телефоне — это весь экран.
   */
  const togglePanels = useShell((s) => s.togglePanels);

  /*
   * Тулбар — часть панелей у тома и часть страницы у тетради. Читающему в
   * чистой сцене не нужно ничего: листают жестом и стрелками. Пишущему нужны
   * инструменты, и они остаются на месте при любом состоянии панелей — это
   * ровно тот набор, которым делаются заметки, картинки и вырезки.
   */
  const toolbar = view !== 'case' && (panels || deskKind === 'journal');

  return (
    <>
      <Topbar />

      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1" aria-label="The scene">
          {boot === 'ready' ? <Viewport /> : <div className="h-full w-full bg-ink-950" />}

          {toolbar && <Toolbar />}
          {/*
           * Переход стол ↔ полка — своя кнопка в углу сцены, а не строка в шапке.
           * Это не навигация по оболочке, а поворот головы в комнате, и жить ему
           * место там же, где стоит тулбар: над сценой. Над страницей тетради
           * её нет: оттуда сперва поднимаются (Esc), потом идут к полке.
           */}
          {!flat && <ViewSwitch />}
          {/* Ключ — номер страницы: у каждой свой масштаб и своя панорама */}
          {flat && <FlatEditor key={flatPage} tint={deskTint} />}

          {(boot !== 'ready' ||
            status === 'reading' ||
            status === 'paginating' ||
            status === 'error') && (
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
              <div
                role="status"
                className="rounded-md border border-ink-700 bg-ink-900/92 px-3 py-1.5 text-[11px] text-ash-300 backdrop-blur"
              >
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
        </main>

        {compact ? (
          panels ? (
            <>
              {/* Заслонка: тычок мимо ящика закрывает его — так это работает везде. */}
              <button
                type="button"
                aria-label="Close the panels"
                onClick={() => togglePanels(false)}
                className="absolute inset-0 z-30 bg-ink-950/50"
              />
              <div className="absolute inset-y-0 left-0 z-30 flex w-[min(340px,86vw)] flex-col overflow-y-auto border-r border-ink-800 bg-ink-900 shadow-[0_0_40px_rgba(0,0,0,0.55)]">
                <Navigator />
                <Inspector />
              </div>
            </>
          ) : null
        ) : (
          <>
            {/*
              Ящики остаются в дереве и уезжают за край, а не размонтируются:
              списки в них длинные, и собирать оглавление заново на каждое
              нажатие Ctrl+\ незачем. За краем они не видны и не ловят ни
              фокус, ни указатель.
            */}
            <aside
              aria-label="Navigator"
              aria-hidden={!panels}
              inert={!panels}
              className={`absolute inset-y-0 left-0 z-30 w-[236px] border-r border-ink-800 bg-ink-900/96 shadow-[8px_0_32px_rgba(0,0,0,0.45)] backdrop-blur transition-transform duration-200 ease-out ${
                panels ? 'translate-x-0' : '-translate-x-full shadow-none'
              }`}
            >
              <Navigator />
            </aside>
            <aside
              aria-label="Inspector"
              aria-hidden={!panels}
              inert={!panels}
              className={`absolute inset-y-0 right-0 z-30 w-[232px] border-l border-ink-800 bg-ink-900/96 shadow-[-8px_0_32px_rgba(0,0,0,0.45)] backdrop-blur transition-transform duration-200 ease-out ${
                panels ? 'translate-x-0' : 'translate-x-full shadow-none'
              }`}
            >
              <Inspector />
            </aside>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Кнопка «к полке» / «к столу».
 *
 * В правом нижнем углу сцены; когда выдвинут инспектор, отъезжает влево на
 * его ширину, чтобы не оказаться под ним. На телефоне ящик один и слева, и
 * кнопке ничто не мешает.
 */
function ViewSwitch() {
  const view = useLibrary((s) => s.view);
  const setView = useLibrary((s) => s.setView);
  const flight = useLibrary((s) => s.flight);
  const panels = useShell((s) => s.panels);
  const compact = useShell((s) => s.device.compact);
  const atDesk = view !== 'case';

  return (
    <button
      type="button"
      onClick={() => setView(atDesk ? 'case' : 'desk')}
      disabled={flight !== null}
      title={atDesk ? 'Look at the bookcase (Esc)' : 'Back to the desk (Esc)'}
      className={`pointer-events-auto absolute bottom-4 z-20 flex h-9 items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/92 pl-2.5 pr-3.5 text-[11.5px] text-ash-100 shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur transition-[right,background-color,color] duration-200 ease-out hover:bg-ink-800 disabled:opacity-50 ${
        panels && !compact ? 'right-[248px]' : 'right-4'
      }`}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brass-500/20 text-brass-300">
        <Icon name={atDesk ? 'bookcase' : 'desk'} size={15} />
      </span>
      {atDesk ? 'Bookcase' : 'Desk'}
    </button>
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
