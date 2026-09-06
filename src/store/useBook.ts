'use client';

/**
 * Состояние тома: документ, типографика, разбивка, положение в книге, замеры.
 *
 * Разбивка — единственная тяжёлая операция, и она пересчитывается при каждом
 * изменении набора. Поэтому здесь же живёт дебаунс и отмена: пока ползунок
 * кегля ещё едет, смысла досчитывать предыдущее значение нет.
 */
import { create } from 'zustand';
import type { ContentDoc } from '@/core/content';
import { openFile, syntheticDoc } from '@/core/ingest';
import {
  computeMetrics,
  DEFAULT_TYPOGRAPHY,
  type PageMetrics,
  type TextureProfile,
  type Typography,
} from '@/core/typography';
import { paginate, type PaginationResult } from '@/core/paginate/paginate';
import type { TurnPlan } from '@/scene/turn';
import type { VolumeRecord, VolumeSource } from '@/core/library/volume';
import type { RasterizerProbe } from '@/core/rasterize/svgRasterizer';

export interface RenderStat {
  ms: number;
  timings: { build: number; decode: number; blit: number };
  svgKb: number;
  fontKb: number;
  fontFiles: string[];
}

type Status = 'idle' | 'reading' | 'paginating' | 'ready' | 'error';

interface BookState {
  doc: ContentDoc;
  /**
   * Откуда взялся текущий документ.
   *
   * Нужен библиотеке: том, уехавший на полку, обязан уметь вернуться, а держать
   * ради этого разобранный документ — держать распакованный архив на каждую
   * книгу. Источник весит ноль.
   */
  docSource: VolumeSource;
  typography: Typography;
  profile: TextureProfile;
  metrics: PageMetrics;

  pagination: PaginationResult | null;
  status: Status;
  progress: { done: number; total: number };
  /** Что именно считается сейчас — распаковка файла или вёрстка. */
  stage: string;
  error: string | null;

  /** Номер листа, на котором открыт том. Лист = разворот. */
  currentSheet: number;

  /**
   * Идущий переворот. Пока он не null, толщина половин и текстуры разворота
   * считаются от него, а не от currentSheet: лист в воздухе не принадлежит ни
   * одной из стопок.
   */
  turn: TurnPlan | null;
  /**
   * Заявка на переворот от клавиатуры или тулбара. Сцена сама решает, когда её
   * исполнить, — пружина живёт в кадре, а не в сторе.
   */
  turnRequest: { dir: 1 | -1; nonce: number } | null;

  probe: RasterizerProbe | null;
  lastRender: RenderStat | null;
  liveTextures: number;

  setTypography: (patch: Partial<Typography>) => void;
  setProfile: (profile: TextureProfile) => void;
  setSheet: (sheet: number) => void;
  requestTurn: (dir: 1 | -1) => void;
  setTurn: (plan: TurnPlan | null) => void;
  endTurn: (target: number) => void;
  runPagination: (options?: { keepPosition?: boolean }) => void;
  open: (file: File) => Promise<void>;
  openVolume: (volume: VolumeRecord) => Promise<void>;
  openSynthetic: () => void;
  setProbe: (probe: RasterizerProbe) => void;
  noteRender: (stat: RenderStat) => void;
  setLiveTextures: (n: number) => void;
}

const initialDoc = syntheticDoc();

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
let runToken = 0;

export const useBook = create<BookState>((set, get) => ({
  doc: initialDoc,
  docSource: { kind: 'synthetic', options: {} },
  typography: DEFAULT_TYPOGRAPHY,
  profile: 'desktop',
  metrics: computeMetrics(DEFAULT_TYPOGRAPHY, 'desktop'),

  pagination: null,
  status: 'idle',
  progress: { done: 0, total: 0 },
  stage: '',
  error: null,

  currentSheet: 0,
  turn: null,
  turnRequest: null,
  probe: null,
  lastRender: null,
  liveTextures: 0,

  setTypography: (patch) => {
    const typography = { ...get().typography, ...patch };
    set({ typography, metrics: computeMetrics(typography, get().profile) });
    get().runPagination();
  },

  setProfile: (profile) => {
    set({ profile, metrics: computeMetrics(get().typography, profile) });
    get().runPagination();
  },

  setSheet: (sheet) => {
    const total = get().pagination?.sheetCount ?? 1;
    set({ currentSheet: Math.min(Math.max(sheet, 0), Math.max(0, total - 1)) });
  },

  /**
   * Заявка на переворот. Если предыдущий ещё в воздухе, засчитываем его
   * состоявшимся и стартуем от нового листа — иначе удержанная стрелка
   * упиралась бы в длительность анимации и листание казалось бы залипшим.
   */
  requestTurn: (dir) => {
    const { turn, pagination } = get();
    if (turn) {
      const sheets = pagination?.sheetCount ?? 1;
      set({
        currentSheet: Math.min(Math.max(turn.toSheet, 0), Math.max(0, sheets - 1)),
        turn: null,
      });
    }
    const nonce = (get().turnRequest?.nonce ?? 0) + 1;
    set({ turnRequest: { dir, nonce } });
  },

  setTurn: (plan) => set({ turn: plan }),

  /**
   * Переворот закончился. Вызывается из кадрового цикла и потому обязан быть
   * идемпотентным: лист сообщает о покое каждый кадр, пока сцена не узнает,
   * что переворачивать больше нечего.
   */
  endTurn: (target) => {
    const plan = get().turn;
    if (!plan) return;
    set({ turn: null });
    // Пружина могла увести лист обратно — тогда разворот остаётся прежним.
    if (Math.abs(target - plan.commitAt) < 0.5) get().setSheet(plan.toSheet);
  },

  runPagination: (options = {}) => {
    const keepPosition = options.keepPosition ?? true;

    if (debounceTimer) clearTimeout(debounceTimer);
    controller?.abort();

    debounceTimer = setTimeout(() => {
      const token = ++runToken;
      const local = new AbortController();
      controller = local;

      const { doc, metrics, typography, pagination: previous } = get();

      set({
        status: 'paginating',
        stage: 'composing',
        error: null,
        progress: { done: 0, total: doc.chapters.length },
      });

      paginate(doc.chapters, metrics, typography, {
        signal: local.signal,
        onProgress: (done, total) => {
          if (token === runToken) set({ progress: { done, total } });
        },
      })
        .then((result) => {
          if (token !== runToken) return;

          /**
           * Прогресс чтения сохраняем долей, а не номером листа: после
           * перевёрстки листов стало больше или меньше, и абсолютный номер
           * увёл бы читателя в другое место книги.
           */
          const ratio =
            keepPosition && previous && previous.sheetCount > 1
              ? get().currentSheet / (previous.sheetCount - 1)
              : 0;
          const sheet = Math.round(ratio * Math.max(0, result.sheetCount - 1));

          set({ pagination: result, status: 'ready', stage: '', currentSheet: sheet, turn: null });
        })
        .catch((err: unknown) => {
          if (local.signal.aborted || token !== runToken) return;
          set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
        });
    }, 160);
  },

  open: async (file) => {
    // Отменяем вёрстку прежней книги: её результат уже никому не нужен.
    if (debounceTimer) clearTimeout(debounceTimer);
    controller?.abort();
    runToken++;

    /*
     * Прежнюю книгу с экрана не убираем. Разбор может и не удаться, а пустой
     * стол вместо того, что человек читал, — худшее, чем можно ответить на
     * неудачно выбранный файл. Замена происходит одним движением ниже, когда
     * новый документ уже разобран.
     */
    set({
      status: 'reading',
      stage: `reading ${file.name}`,
      error: null,
      progress: { done: 0, total: 0 },
    });

    try {
      const doc = await openFile(file, (done, total) => set({ progress: { done, total } }));

      /*
       * Язык книги приезжает вместе с ней и подменяет текущий. Это не
       * косметика: от языка зависит словарь переносов, а от переносов —
       * сколько в книге страниц и какой она толщины.
       */
      const typography = { ...get().typography, lang: doc.language || 'en' };

      set({
        doc,
        docSource: { kind: 'file', file },
        typography,
        metrics: computeMetrics(typography, get().profile),
        currentSheet: 0,
        turn: null,
        // Разбивка относится к прежней книге и вместе с ней теряет смысл.
        pagination: null,
      });
      get().runPagination({ keepPosition: false });
    } catch (err) {
      set({
        status: 'error',
        stage: '',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  /**
   * Открыть том, снятый с полки.
   *
   * Содержимое добывается из источника записи: синтетика генерируется заново по
   * тем же настройкам, файл разбирается повторно. Разбор укладывается в полёт
   * книги, поэтому ждать читателю нечего, а памяти это не стоит вовсе — на
   * полке лежали метаданные, а не сорок распакованных архивов.
   */
  openVolume: async (volume) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    controller?.abort();
    runToken++;

    set({
      status: 'reading',
      stage: `opening ${volume.title}`,
      error: null,
      progress: { done: 0, total: 0 },
    });

    try {
      const doc =
        volume.source.kind === 'synthetic'
          ? syntheticDoc(volume.source.options, volume.id)
          : {
              ...(await openFile(volume.source.file, (done, total) =>
                set({ progress: { done, total } }),
              )),
              // Личность тома задаёт библиотека, а не разбор: по этому
              // идентификатору книга находит свой корешок.
              id: volume.id,
            };

      const typography = { ...get().typography, lang: doc.language || 'en' };
      set({
        doc,
        docSource: volume.source,
        typography,
        metrics: computeMetrics(typography, get().profile),
        currentSheet: 0,
        turn: null,
        pagination: null,
      });
      get().runPagination({ keepPosition: false });
    } catch (err) {
      set({
        status: 'error',
        stage: '',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  openSynthetic: () => {
    const doc = syntheticDoc();
    const typography = { ...get().typography, lang: 'en' };
    set({
      doc,
      docSource: { kind: 'synthetic', options: {} },
      typography,
      metrics: computeMetrics(typography, get().profile),
      currentSheet: 0,
      turn: null,
      pagination: null,
      error: null,
    });
    get().runPagination({ keepPosition: false });
  },

  setProbe: (probe) => set({ probe }),
  noteRender: (lastRender) => set({ lastRender }),
  setLiveTextures: (liveTextures) => set({ liveTextures }),
}));

/**
 * Стор под рукой в дев-сборке. Состояние сцены иначе не осмотреть: она живёт в
 * отдельном React-корне, и React DevTools показывают там не то дерево.
 */
if (process.env.NODE_ENV !== 'production') {
  (globalThis as { __r3ad?: typeof useBook }).__r3ad = useBook;
}
