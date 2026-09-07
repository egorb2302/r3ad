'use client';

/**
 * Оболочка: в каком режиме показываем книгу, что видно из панелей и на чём всё
 * это работает.
 *
 * Отдельный стор, а не состояние `Workspace`, по одной причине: то же самое
 * спрашивают палитра команд, публичная страница снимка и сама сцена, а
 * поднимать ради этого состояние в общий React-контекст значило бы
 * перерисовывать вьюпорт от нажатия «спрятать панели».
 *
 * Режимов два, и они не равноправны. `scene` — то, ради чего проект затевался.
 * `plain` — обычный HTML (§17): он и путь доступности, и «просто дай почитать»,
 * и единственное, что остаётся, когда WebGL2 нет вовсе. Поэтому переключение
 * помнит причину: выбранный руками режим переживает перезагрузку в адресе, а
 * назначенный из-за отсутствия WebGL — не выбор, и предлагать вернуться в
 * сцену, которой нет, нельзя.
 */
import { create } from 'zustand';
import { DEFAULT_PROFILE, type DeviceProfile } from '@/core/device';
import { setInstantMotion } from '@/scene/motionPrefs';

export type ShellMode = 'scene' | 'plain';
export type ModeReason = 'user' | 'url' | 'no-webgl' | 'gpu-lost';

/**
 * Режим назначен, а не выбран.
 *
 * Две причины из четырёх — не решение человека, а обстоятельства: WebGL2 нет
 * вовсе или контекст отняли на ходу (§16). Отличать их от выбора приходится в
 * трёх местах — адрес, возврат в сцену и плашка, — и правило стоит держать
 * одним куском, чтобы «назначенный» нигде не разошёлся с «выбранным».
 */
export const forcedMode = (reason: ModeReason) => reason === 'no-webgl' || reason === 'gpu-lost';

/** Что показывает палитра: команды или поиск по книге (§12.3). */
export type PaletteMode = 'commands' | 'search';

interface ShellState {
  mode: ShellMode;
  reason: ModeReason;
  /**
   * Панели выдвинуты. По умолчанию нет: сцена — это то, ради чего проект
   * есть, и первым делом на экране должна быть книга, а не два столбца
   * настроек по бокам от неё. Настройки приезжают по кнопке и лежат поверх.
   */
  panels: boolean;
  palette: PaletteMode | null;
  device: DeviceProfile;
  /** Системное «поменьше движения». Сцена читает его через motionPrefs. */
  reduced: boolean;

  /**
   * Глава, открытая в плоском режиме, — null означает «та, на которой стоит
   * книга». Единица там глава, а не страница, потому что страницы в плоском
   * режиме нет: полоса набрана под окно, а не под лист 148×210 (см. core/plain).
   */
  chapter: string | null;
  /** Что подсветить в тексте после перехода из поиска: запрос и номер совпадения. */
  find: { query: string; nth: number } | null;

  setMode: (mode: ShellMode, reason?: ModeReason) => void;
  togglePanels: (visible?: boolean) => void;
  openPalette: (mode: PaletteMode) => void;
  closePalette: () => void;
  adopt: (device: DeviceProfile) => void;
  setReduced: (reduced: boolean) => void;
  setChapter: (chapter: string | null) => void;
  reveal: (chapter: string, query: string, nth: number) => void;
  clearFind: () => void;
}

/**
 * Режим в адресе.
 *
 * `?mode=flat` из §17 — обещание ссылкой: «открой это без 3D». Пишется через
 * replaceState, а не роутером: смена режима не должна плодить записи в истории,
 * иначе «назад» после трёх переключений уводит не из книги, а по кругу. И
 * бережно к остальным параметрам — рядом живёт `?s=` с целой полкой.
 */
function writeMode(mode: ShellMode) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (mode === 'plain') url.searchParams.set('mode', 'flat');
  else url.searchParams.delete('mode');
  window.history.replaceState(window.history.state, '', url);
}

export const useShell = create<ShellState>((set, get) => ({
  mode: 'scene',
  reason: 'user',
  panels: false,
  palette: null,
  device: DEFAULT_PROFILE,
  reduced: false,
  chapter: null,
  find: null,

  setMode: (mode, reason = 'user') => {
    if (get().mode === mode && get().reason === reason) return;
    set({ mode, reason });
    // Назначенный режим в адресе не отражаем: это не выбор человека, и на
    // другой машине та же ссылка обязана открыться сценой.
    if (!forcedMode(reason)) writeMode(mode);
  },

  togglePanels: (visible) => set({ panels: visible ?? !get().panels }),
  openPalette: (palette) => set({ palette }),
  closePalette: () => set({ palette: null }),

  /**
   * Профиль устройства пересматривается при каждом изменении окна, но записи
   * достойны только настоящие перемены: `compact` меняется от перетаскивания
   * рамки браузера, а разрешение растра — нет, и перерисовывать из-за первого
   * второе означало бы печатать книгу заново на каждый пиксель ширины.
   */
  adopt: (device) => {
    const known = get().device;
    const same =
      known.kind === device.kind &&
      known.scene === device.scene &&
      known.texture === device.texture &&
      known.liveTextures === device.liveTextures &&
      known.shadows === device.shadows &&
      known.compact === device.compact &&
      known.dpr[0] === device.dpr[0] &&
      known.dpr[1] === device.dpr[1];
    if (same) return;

    /*
     * Смена класса экрана закрывает панели: на узком они лежат одним ящиком,
     * на широком — двумя по бокам, и открытое в одной раскладке в другой
     * стоит не там. Закрывать их при каждом замере — отнимать у человека то,
     * что он только что открыл, поэтому только в момент смены класса.
     */
    const panels = known.compact === device.compact ? get().panels : false;
    set({ device, panels });

    // Сцены нет — спорить не о чем: показываем то, что показать можем.
    if (!device.scene && get().mode !== 'plain') get().setMode('plain', 'no-webgl');

    /*
     * И обратно. В текст человека отправил не он, а отказ железа, и держать его
     * там после того, как железо ответило, не за что: проба повторяется по
     * кнопке (см. ui/useDevice), и её положительный ответ — единственное, чего
     * плоский режим здесь ждал.
     */
    if (device.scene && get().mode === 'plain' && forcedMode(get().reason)) {
      get().setMode('scene');
    }
  },

  setReduced: (reduced) => {
    setInstantMotion(reduced);
    set({ reduced });
  },

  // Смена главы руками снимает подсветку: она относилась к прошлому переходу,
  // и жёлтые пятна в новой главе объяснить было бы нечем.
  setChapter: (chapter) => set({ chapter, find: null }),
  reveal: (chapter, query, nth) => set({ chapter, find: { query, nth } }),
  clearFind: () => set({ find: null }),
}));

if (process.env.NODE_ENV !== 'production') {
  (globalThis as { __r3adShell?: typeof useShell }).__r3adShell = useShell;
}
