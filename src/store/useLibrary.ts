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
import { dominantColor } from '@/core/library/palette';
import { themeFor, themeFromCover, type BookTheme } from '@/core/theme';
import { volumeFromDoc, type VolumeRecord, type VolumeSource } from '@/core/library/volume';
import { typographyKey } from '@/core/paginate/paginate';
import { stage, startFlight, stopFlight, type FlightKind } from '@/scene/flight';
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
  add: (record: VolumeRecord) => void;
  hover: (id: string | null) => void;
  select: (id: string) => void;
  reorder: (id: string, toIndex: number) => void;
  shelve: () => void;
  take: (id: string) => void;
  arrived: () => void;
  syncDesk: (doc: ContentDoc, source: VolumeSource) => void;
  noteComposed: (id: string, pages: number, key: string) => void;
  dress: (id: string, theme: BookTheme) => void;
}

/** Запись для книги, лежащей на столе. */
function deskRecord(doc: ContentDoc, source: VolumeSource): VolumeRecord {
  return volumeFromDoc(doc, source);
}

/**
 * Предельный срок полёта.
 *
 * Втрое больше самого пути: закрывание и перелёт занимают 0.52 + 0.9 секунды на
 * машине, которая их рисует, и запас нужен только на медленную.
 */
const FLIGHT_LIMIT_MS = 4200;

let watchdog: ReturnType<typeof setTimeout> | null = null;

function clearWatchdog() {
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
}

/**
 * Досчитать полёт там, где его некому играть.
 *
 * Анимацию доводит до конца кадровый цикл сцены, и пока он не сообщил о посадке,
 * книга не лежит ни на столе, ни на полке. В плоском режиме (§17) сцены нет
 * вовсе — и без этой строчки «снять книгу с полки» там оставляло бы её в
 * воздухе навсегда. Мгновенно, а не быстро: показывать нечего, значит и время
 * тратить не на что.
 *
 * Сцена бывает и на месте, а кадров всё равно нет. Вкладка ушла в фон, экран
 * телефона погас, браузер отнял контекст WebGL — и полёт замирает там, где его
 * застали. Плохо здесь не то, что книга повисла: незавершённый полёт запирает
 * библиотеку целиком (`take`, `shelve` и кнопка перехода смотрят на него), и
 * человек остаётся с интерфейсом, который ни на что не отвечает. Поэтому у
 * полёта есть предельный срок: не доиграли — считаем, что долетели. Книга
 * окажется там, куда её отправили, и это честнее запертого экрана.
 */
function land() {
  clearWatchdog();
  if (!stage.mounted) {
    useLibrary.getState().arrived();
    return;
  }
  watchdog = setTimeout(() => {
    watchdog = null;
    useLibrary.getState().arrived();
  }, FLIGHT_LIMIT_MS);
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
  add: (record) => set({ volumes: [...get().volumes, record] }),
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
    land();
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

    /*
     * Тетрадь ложится на стол сразу, книга — когда разберётся файл. Разница не
     * в поспешности: у тетради нечего разбирать, её содержимое уже здесь, а
     * пустой стол на время полёта означал бы, что и рисовать не на чем.
     */
    set({
      flight: { id, kind: 'take' },
      view: 'desk',
      armed: null,
      hovered: null,
      desk: volume.kind === 'journal' ? volume : get().desk,
    });
    startFlight('take');
    if (volume.kind !== 'journal') void useBook.getState().openVolume(volume);
    land();
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

    const previous = get().desk;
    const known = get().volumes.find((v) => v.id === doc.id) ?? previous;
    const record: VolumeRecord = {
      ...deskRecord(doc, source),
      theme: known?.id === doc.id ? known.theme : themeFor(`${doc.title}|${doc.author}`),
    };

    /*
     * Тетрадь, которую вытеснили со стола открытым файлом, возвращается на
     * полку. Том на её месте просто пропал бы: его текст лежит в файле, и файл
     * никуда не делся. Тетрадь же нигде больше не хранится — исписанные
     * страницы обязаны остаться в библиотеке, а не исчезнуть вместе со столом.
     */
    const returning = previous?.kind === 'journal' && previous.id !== doc.id ? [previous] : [];
    set({ desk: record, volumes: [...get().volumes, ...returning] });

    /*
     * Обложка уточняет цвет только у книги, которую ещё не переодевали руками:
     * иначе выбранный человеком переплёт перебивался бы доминантой обложки
     * через полсекунды после выбора — молча и без всякого повода.
     */
    if (!doc.cover || known?.id === doc.id) return;
    void dominantColor(doc.cover).then((hsl) => {
      if (!hsl) return;
      const desk = get().desk;
      if (desk?.id !== doc.id) return;
      set({ desk: { ...desk, theme: themeFromCover(hsl, `${doc.title}|${doc.author}`) } });
    });
  },

  /**
   * Переодеть том.
   *
   * Патчем по идентификатору, а не «правь запись на столе»: книга, которую
   * перекрашивают, может в этот момент лететь на полку, и тогда её запись есть
   * и в ряду, и на столе (см. `shelve`). Обе обязаны обновиться разом — иначе
   * приземлившийся том окажется прежнего цвета.
   */
  dress: (id, theme) => {
    const patch = (v: VolumeRecord) => (v.id === id ? { ...v, theme } : v);
    set({
      volumes: get().volumes.map(patch),
      desk: get().desk ? patch(get().desk!) : null,
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
 * Полёта не стало — значит, и анимации нет.
 *
 * Обнулить `flight` умеет не только посадка: полку целиком заменяет снимок по
 * ссылке и подъём из базы, и делают они это через `setState`, мимо `arrived`.
 * Изменяемый объект анимации об этом бы не узнал, а он решает, показывать ли
 * книгу на столе (см. Book.tsx), — и книга осталась бы невидимой до следующего
 * полёта. Одной подпиской, а не строчкой в каждом вызывающем: мест, где полка
 * меняется целиком, будет больше, чем два.
 */
useLibrary.subscribe((state, previous) => {
  if (previous.flight && !state.flight) {
    clearWatchdog();
    stopFlight();
  }
});

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
