'use client';

/**
 * Верхняя строка и нижний тулбар вьюпорта.
 *
 * Шапка — единственное, что остаётся на экране, когда панели убраны, поэтому в
 * ней ровно то, без чего не обойтись: лого, где мы, и кнопки-иконки. Подписи
 * у кнопок живут во всплывающей подсказке и в палитре: строка текста на каждую
 * кнопку превращала бы шапку в меню, а её задача — не мешать книге.
 */
import { lastSpread, sheetsToThicknessMm, spreadPages } from '@/core/units';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { useShare } from '@/store/useShare';
import { useShell } from '@/store/useShell';
import { JournalToolbar } from './journal/JournalToolbar';
import { Icon, IconButton, Logo } from './icons';

export function Topbar() {
  const pagination = useBook((s) => s.pagination);
  const deskPages = useBook((s) => s.pages);
  const deskSheets = useBook((s) => s.sheets);
  const status = useBook((s) => s.status);
  const currentSheet = useBook((s) => s.currentSheet);

  const view = useLibrary((s) => s.view);
  const desk = useLibrary((s) => s.desk);
  const flight = useLibrary((s) => s.flight);
  const shelve = useLibrary((s) => s.shelve);
  const share = useShare((s) => s.toggle);
  const panels = useShell((s) => s.panels);
  const togglePanels = useShell((s) => s.togglePanels);
  const setMode = useShell((s) => s.setMode);
  const openPalette = useShell((s) => s.openPalette);

  /*
   * На узком экране в шапке остаётся только то, без чего не обойтись: где мы,
   * панели, текстовый режим и палитра. Остальное — «поделиться», «на полку»,
   * счётчик страниц — там же, в палитре: у телефона нет ни ⌘K, ни места на
   * восемь кнопок, и палитра оказывается для него не ускорителем для знающих,
   * а основным меню.
   */
  const compact = useShell((s) => s.device.compact);
  const shared = useShare((s) => s.shared);
  const keep = useShare((s) => s.keep);

  const { right } = spreadPages(currentSheet, deskPages);
  const atDesk = view !== 'case';
  const journal = desk?.kind === 'journal';

  return (
    <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-ink-800 bg-ink-900 px-2.5">
      <div className="flex min-w-0 items-center gap-2 text-[11.5px]">
        <span className="flex items-center gap-1.5">
          <Logo size={20} />
          <span className="font-medium tracking-tight text-brass-500">r3ad</span>
        </span>
        <span className="text-ink-600">/</span>
        {/* Где мы — подпись, а не кнопка: переход живёт в углу сцены (см. ViewSwitch). */}
        <span className="flex items-center gap-1 px-1 text-ash-400">
          <Icon name={atDesk ? 'desk' : 'bookcase'} size={13} />
          {atDesk ? 'Desk' : 'Bookcase'}
        </span>
        {atDesk ? (
          <>
            <span className="text-ink-600">/</span>
            <span className="max-w-[280px] truncate text-ash-100">
              {desk ? desk.title : 'empty'}
            </span>
          </>
        ) : null}
        {atDesk && desk && right !== null && !compact ? (
          <>
            <span className="text-ink-600">/</span>
            <span className="tabular text-ash-400">p. {right + 1}</span>
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/*
          Чужая полка из короткой ссылки. Метка стоит там же, где у снапшота, и
          говорит то же самое: показанное сюда не сохраняется, пока его не
          оставили себе.
        */}
        {shared ? (
          <>
            <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ash-400">
              shared shelf — not saved
            </span>
            <button
              type="button"
              onClick={() => void keep()}
              title="Copy this shelf into your own library"
              className="mr-1 rounded bg-brass-700 px-2 py-0.5 text-[10.5px] text-ash-100 transition-colors hover:bg-brass-600"
            >
              keep it
            </button>
          </>
        ) : null}
        {compact ? null : (
          <span
            className={`tabular mr-1.5 text-[10.5px] ${
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
        )}
        {compact ? null : (
          <IconButton label="Share this shelf (Shift+S)" onClick={() => share(true)}>
            <Icon name="share" />
          </IconButton>
        )}
        {desk && !flight && !compact ? (
          <IconButton label="Close the book and send it to the shelf (S)" onClick={shelve}>
            <Icon name="shelve" />
          </IconButton>
        ) : null}
        {compact ? (
          <IconButton label="Commands (Ctrl+K)" onClick={() => openPalette('commands')}>
            <Icon name="more" />
          </IconButton>
        ) : null}
        {/*
          Плоский режим вынесен в шапку, а не спрятан в палитру: §17 обещает
          тоггл там, где его увидят, — это путь для того, кому 3D мешает читать,
          а не пасхалка для знающих про ⌘K.
        */}
        <IconButton
          label="Read this book as plain text (?mode=flat)"
          onClick={() => setMode('plain')}
        >
          <Icon name="text" />
        </IconButton>
        {/*
          Панели. Единственная кнопка с состоянием в шапке: пока она горит,
          навигатор и инспектор выдвинуты по бокам поверх сцены.
        */}
        <IconButton
          label={panels ? 'Hide the panels (Ctrl+\\)' : 'Show the panels (Ctrl+\\)'}
          active={panels}
          onClick={() => togglePanels()}
        >
          <Icon name="panels" />
        </IconButton>
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
    <div className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/92 px-3 py-2 backdrop-blur">
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
