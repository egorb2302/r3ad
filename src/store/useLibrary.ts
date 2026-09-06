'use client';

/**
 * Библиотека: что стоит на полке, что лежит на столе и что сейчас летит.
 *
 * Разделение со сторм тома жёсткое и намеренное. `useBook` знает всё про одну
 * книгу — её текст, вёрстку, положение в ней. `useLibrary` не знает про книги
 * ничего, кроме корешка: название, автор, объём, цвет и способ добыть текст
 * обратно. Иначе сорок томов на полке означали бы сорок разобранных документов
 * в памяти.
 *
 * Связь между ними односторонняя: библиотека подписана на стол, стол про
 * библиотеку не знает. Так книга, открытая перетаскиванием файла, оказывается
 * на столе без единой строчки согласования, а замкнутого импорта между сторами
 * не возникает.
 */
import { create } from 'zustand';
import type { ContentDoc } from '@/core/content';
import { demoLibrary } from '@/core/library/demo';
import { dominantColor, paletteFor, paletteFromColor } from '@/core/library/palette';
import { volumeFromDoc, type VolumeRecord, type VolumeSource } from '@/core/library/volume';
import { typographyKey } from '@/core/paginate/paginate';
import { startFlight, stopFlight, type FlightKind } from '@/scene/flight';
import type { CameraView } from '@/scene/camera/CameraRig';
import { useBook } from './useBook';

export interface FlightState {
  id: string;
  kind: FlightKind;
}

interface LibraryState {
  view: CameraView;
  /** Тома на полке, в порядке ряда. */
  volumes: VolumeRecord[];
  /** Том, раскрытый на столе. На полке его нет. */
  desk: VolumeRecord | null;

  hovered: string | null;
  /** Том, наклонённый наружу: следующий щелчок по нему вытащит книгу. */
  armed: string | null;
  flight: FlightState | null;
  /** Что снять с полки, как только нынешняя книга доедет домой. */
  pending: string | null;

  setView: (view: CameraView) => void;
  hover: (id: string | null) => void;
  select: (id: string) => void;
  reorder: (id: string, toIndex: number) => void;
  shelve: () => void;
  take: (id: string) => void;
  arrived: () => void;
  syncDesk: (doc: ContentDoc, source: VolumeSource) => void;
  noteComposed: (id: string, pages: number, key: string) => void;
}

/** Запись для книги, лежащей на столе. */
function deskRecord(doc: ContentDoc, source: VolumeSource): VolumeRecord {
  return volumeFromDoc(doc, source);
}

export const useLibrary = create<LibraryState>((set, get) => ({
  view: 'desk',
  volumes: demoLibrary(),
  desk: deskRecord(useBook.getState().doc, useBook.getState().docSource),

  hovered: null,
  armed: null,
  flight: null,
  pending: null,

  setView: (view) => set({ view, armed: null }),
  hover: (hovered) => set({ hovered }),

  /**
   * Щелчок по корешку.
   *
   * Первый наклоняет том наружу, второй вытаскивает. Промежуточный шаг не
   * церемония: попасть по корешку толщиной в сантиметр легко, а вот случайно
   * выдернуть с полки не ту книгу — обидно.
   */
  select: (id) => {
    if (get().flight) return;
    if (get().armed === id) get().take(id);
    else set({ armed: id });
  },

  reorder: (id, toIndex) => {
    const volumes = [...get().volumes];
    const from = volumes.findIndex((v) => v.id === id);
    if (from < 0) return;

    const target = Math.max(0, Math.min(toIndex, volumes.length - 1));
    if (from === target) return;

    const [moved] = volumes.splice(from, 1);
    volumes.splice(target, 0, moved);
    set({ volumes });
  },

  /**
   * Книга со стола уезжает на полку.
   *
   * Запись встаёт в ряд сразу, до полёта: слот нужен уже сейчас — именно в него
   * летит книга, и именно он должен разомкнуться в ряду. Стол очищается только
   * по прилёте, потому что первый такт анимации — закрывание, а закрывается ещё
   * та самая раскрытая книга.
   */
  shelve: () => {
    const desk = get().desk;
    if (!desk || get().flight) return;

    set({
      volumes: [...get().volumes, desk],
      flight: { id: desk.id, kind: 'shelve' },
      view: 'case',
      armed: null,
      hovered: null,
    });
    startFlight('shelve');
  },

  take: (id) => {
    if (get().flight) return;

    const volume = get().volumes.find((v) => v.id === id);
    if (!volume) return;

    // Стол занят — сначала домой уезжает нынешняя книга. Две анимации подряд
    // честнее, чем книга, исчезнувшая со стола без объяснений.
    if (get().desk) {
      set({ pending: id });
      get().shelve();
      return;
    }

    set({ flight: { id, kind: 'take' }, view: 'desk', armed: null, hovered: null });
    startFlight('take');
    void useBook.getState().openVolume(volume);
  },

  /** Полёт доиграл. */
  arrived: () => {
    const current = get().flight;
    if (!current) return;
    stopFlight();

    if (current.kind === 'shelve') {
      set({ desk: null, flight: null });
      const next = get().pending;
      if (next) {
        set({ pending: null });
        get().take(next);
      }
      return;
    }

    // Снятый том больше не на полке: ряд смыкается.
    set({
      volumes: get().volumes.filter((v) => v.id !== current.id),
      flight: null,
    });
  },

  /**
   * На столе сменилась книга.
   *
   * Вызывается подпиской ниже. Цвет корешка сперва берётся из названия, а потом,
   * если у издания есть обложка, уточняется её доминантой — обложка
   * декодируется асинхронно, и ждать её книге незачем.
   */
  syncDesk: (doc, source) => {
    if (get().flight?.kind === 'shelve') return;

    const known = get().volumes.find((v) => v.id === doc.id) ?? get().desk;
    const record: VolumeRecord = {
      ...deskRecord(doc, source),
      palette: known?.id === doc.id ? known.palette : paletteFor(`${doc.title}|${doc.author}`),
    };
    set({ desk: record });

    if (!doc.cover) return;
    void dominantColor(doc.cover).then((hsl) => {
      if (!hsl) return;
      const desk = get().desk;
      if (desk?.id !== doc.id) return;
      set({ desk: { ...desk, palette: paletteFromColor(hsl) } });
    });
  },

  /**
   * Книга свёрстана — толщина корешка перестаёт быть оценкой.
   *
   * До этого объём тома считается по числу знаков, и ошибка там доходит до
   * десятка процентов. Точное число страниц есть только у той книги, которую
   * действительно верстали, поэтому корешок и уточняется ровно один — её.
   */
  noteComposed: (id, pages, key) => {
    const patch = (v: VolumeRecord) =>
      v.id === id ? { ...v, pages, pagesKey: key } : v;
    set({
      volumes: get().volumes.map(patch),
      desk: get().desk ? patch(get().desk!) : null,
    });
  },
}));

/*
 * Стол → библиотека. Одна подписка вместо вызовов из useBook: так стор тома
 * остаётся ничего не знающим о полке, и его можно завести в отрыве от неё —
 * в тесте, в плоском режиме, в снапшоте.
 */
useBook.subscribe((state, previous) => {
  if (state.doc !== previous.doc) {
    useLibrary.getState().syncDesk(state.doc, state.docSource);
  }

  if (state.pagination && state.pagination !== previous.pagination) {
    useLibrary
      .getState()
      .noteComposed(
        state.doc.id,
        state.pagination.pageCount,
        typographyKey(state.metrics, state.typography),
      );
  }
});

if (process.env.NODE_ENV !== 'production') {
  (globalThis as { __r3adLibrary?: typeof useLibrary }).__r3adLibrary = useLibrary;
}
