'use client';

/**
 * Вырезки: что развёрнуто по ссылкам и что из этого собрано в досье.
 *
 * Отдельный стор, а не часть тетради, потому что вырезка живёт дольше страницы,
 * на которую её положили: одна и та же уходит и в конспект, и в
 * скомпилированный том, и в снапшот (M5). Тетрадь держит на неё ссылку — так же,
 * как держит хэш картинки, а не саму картинку.
 *
 * Направление связей прежнее: этот стор знает про библиотеку и тетрадь, они про
 * него — нет. Печать страницы добирается до вырезки не импортом, а резолвером,
 * который ей передают (`clippingFor` ниже).
 */
import { create } from 'zustand';
import { isFailure, requestUnfurl, clippingFromPaste, type UnfurlFailure } from '@/core/clipping/adopt';
import { cardHeight, CARD } from '@/core/clipping/card';
import { compiledRecord } from '@/core/library/volume';
import type { Clipping } from '@/core/clipping/types';
import { useLibrary } from './useLibrary';

interface ClipState {
  clips: Record<string, Clipping>;
  /** Порядок появления: он же порядок глав в досье. */
  order: string[];

  /** Что сейчас разворачивается. Пустая строка — ничего. */
  pending: string;
  error: UnfurlFailure | null;
  /** Вырезка, выбранная для укладки на страницу. */
  chosen: string | null;

  unfurl: (url: string) => Promise<Clipping | null>;
  paste: (text: string, url?: string) => Clipping | null;
  remove: (id: string) => void;
  choose: (id: string | null) => void;
  compile: (title?: string) => void;
  dismiss: () => void;
}

export const useClips = create<ClipState>((set, get) => ({
  clips: {},
  order: [],
  pending: '',
  error: null,
  chosen: null,

  /**
   * Развернуть ссылку.
   *
   * Ошибка не бросается, а оседает в сторе: неудача здесь — обычный исход
   * (§15.1), и интерфейс по коду `paste` открывает поле ручной вставки, а не
   * показывает красное.
   */
  unfurl: async (url) => {
    if (get().pending) return null;
    set({ pending: url, error: null });

    const result = await requestUnfurl(url);
    if (isFailure(result)) {
      set({ pending: '', error: result });
      return null;
    }

    keep(set, get, result);
    set({ pending: '' });
    return result;
  },

  paste: (text, url) => {
    const clipping = clippingFromPaste(text, url);
    if (!clipping) {
      set({ error: { code: 'empty', message: 'There was no text in that.' } });
      return null;
    }
    keep(set, get, clipping);
    set({ error: null });
    return clipping;
  },

  remove: (id) => {
    const clips = { ...get().clips };
    delete clips[id];
    set({
      clips,
      order: get().order.filter((x) => x !== id),
      chosen: get().chosen === id ? null : get().chosen,
    });
  },

  choose: (chosen) => set({ chosen }),

  /**
   * Собрать досье.
   *
   * Том встаёт на полку и снимается с неё обычным движением — тем же, что и
   * тетрадь на M3. Вырезки при этом остаются в панели: досье забрало их копию
   * (см. `VolumeSource`), и продолжать собирать следующее можно с того же
   * места.
   */
  compile: (title) => {
    const clippings = get().order.map((id) => get().clips[id]).filter(Boolean);
    if (clippings.length === 0) return;

    const record = compiledRecord(title?.trim() || defaultTitle(clippings), clippings);
    const library = useLibrary.getState();
    library.add(record);
    library.take(record.id);
  },

  dismiss: () => set({ error: null }),
}));

type Setter = (patch: Partial<ClipState>) => void;
type Getter = () => ClipState;

function keep(set: Setter, get: Getter, clipping: Clipping) {
  set({
    clips: { ...get().clips, [clipping.id]: clipping },
    order: [...get().order, clipping.id],
    chosen: clipping.id,
  });
}

/**
 * Название досье по умолчанию.
 *
 * Берём имя источника, если он один, иначе — число вырезок. Придумывать
 * «Dossier» на пустом месте незачем: имя тома читается на корешке, и оно должно
 * что-то говорить о содержимом.
 */
function defaultTitle(clippings: Clipping[]): string {
  const names = [...new Set(clippings.map((c) => c.attribution.sourceName))];
  if (names.length === 1) return `Notes on ${names[0]}`;
  return `Dossier · ${clippings.length} clippings`;
}

/** Резолвер для печати страницы. Отдаётся вызовом, а не импортом ядра. */
export function clippingFor(id: string): Clipping | null {
  return useClips.getState().clips[id] ?? null;
}

/**
 * Мерная поверхность.
 *
 * Высота карточки считается разбивкой текста на строки, а разбивка требует
 * контекста холста — измерять нечем, пока неизвестно чем. Контекст здесь
 * без масштаба: кегли карточки заданы в миллиметрах, а `measureText`
 * пропорционален кеглю, поэтому мера в «миллиметрах как пикселях» точна.
 */
let ruler: CanvasRenderingContext2D | null = null;

export function measureCard(clipping: Clipping, width: number): number {
  if (!ruler && typeof document !== 'undefined') {
    ruler = document.createElement('canvas').getContext('2d');
  }
  if (!ruler) return width * 0.6;
  return cardHeight(ruler, clipping, width);
}

export { CARD };

if (process.env.NODE_ENV !== 'production') {
  (globalThis as { __r3adClips?: typeof useClips }).__r3adClips = useClips;
}
