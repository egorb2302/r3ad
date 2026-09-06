'use client';

/**
 * Состояние тома: типографика, разбивка, положение в книге, замеры.
 *
 * Разбивка — единственная тяжёлая операция, и она пересчитывается при каждом
 * изменении набора. Поэтому здесь же живёт дебаунс и отмена: пока ползунок
 * кегля ещё едет, смысла досчитывать предыдущее значение нет.
 */
import { create } from 'zustand';
import { generateBook, type SyntheticBook } from '@/core/text/synthetic';
import {
  computeMetrics,
  DEFAULT_TYPOGRAPHY,
  type PageMetrics,
  type TextureProfile,
  type Typography,
} from '@/core/typography';
import { paginate, type PaginationResult } from '@/core/paginate/paginate';
import type { RasterizerProbe } from '@/core/rasterize/svgRasterizer';

export interface RenderStat {
  ms: number;
  svgKb: number;
  fontKb: number;
  fontFiles: string[];
}

type Status = 'idle' | 'paginating' | 'ready' | 'error';

interface BookState {
  book: SyntheticBook;
  typography: Typography;
  profile: TextureProfile;
  metrics: PageMetrics;

  pagination: PaginationResult | null;
  status: Status;
  progress: { done: number; total: number };
  error: string | null;

  /** Номер листа, на котором открыт том. Лист = разворот. */
  currentSheet: number;

  probe: RasterizerProbe | null;
  lastRender: RenderStat | null;
  liveTextures: number;

  setTypography: (patch: Partial<Typography>) => void;
  setProfile: (profile: TextureProfile) => void;
  setSheet: (sheet: number) => void;
  turn: (delta: number) => void;
  runPagination: () => void;
  setProbe: (probe: RasterizerProbe) => void;
  noteRender: (stat: RenderStat) => void;
  setLiveTextures: (n: number) => void;
}

const book = generateBook();

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
let runToken = 0;

export const useBook = create<BookState>((set, get) => ({
  book,
  typography: DEFAULT_TYPOGRAPHY,
  profile: 'desktop',
  metrics: computeMetrics(DEFAULT_TYPOGRAPHY, 'desktop'),

  pagination: null,
  status: 'idle',
  progress: { done: 0, total: 0 },
  error: null,

  currentSheet: 0,
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

  turn: (delta) => get().setSheet(get().currentSheet + delta),

  runPagination: () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    controller?.abort();

    debounceTimer = setTimeout(() => {
      const token = ++runToken;
      const local = new AbortController();
      controller = local;

      const { book: current, metrics, typography, pagination: previous } = get();

      set({
        status: 'paginating',
        error: null,
        progress: { done: 0, total: current.chapters.length },
      });

      paginate(current.chapters, metrics, typography, {
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
          const ratio = previous && previous.sheetCount > 1
            ? get().currentSheet / (previous.sheetCount - 1)
            : 0;
          const sheet = Math.round(ratio * Math.max(0, result.sheetCount - 1));

          set({ pagination: result, status: 'ready', currentSheet: sheet });
        })
        .catch((err: unknown) => {
          if (local.signal.aborted || token !== runToken) return;
          set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
        });
    }, 160);
  },

  setProbe: (probe) => set({ probe }),
  noteRender: (lastRender) => set({ lastRender }),
  setLiveTextures: (liveTextures) => set({ liveTextures }),
}));
