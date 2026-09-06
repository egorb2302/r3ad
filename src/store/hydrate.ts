'use client';

/**
 * Бандл ↔ сторы.
 *
 * Единственное место, где формат из `core/share` встречается с состоянием
 * приложения, и оба направления живут здесь рядом намеренно: снять полку и
 * поставить полку — операции, которые обязаны сходиться, а сходятся они только
 * если их видно вместе.
 *
 * Через эту пару проходит всё: сохранение в локальную базу и подъём из неё,
 * экспорт и импорт `.r3ad`, публикация снимка и форк чужого. Одна дорога на
 * пять сценариев — и, значит, разойтись она может только сразу во всех, а такое
 * замечают в тот же день.
 *
 * Направление зависимостей прежнее (M2–M4): ядро про сторы не знает, сторы про
 * сцену не знают. Этот файл — их переводчик, и он единственный, кому положено
 * знать про все три стора сразу.
 */
import { adoptAsset, assetBlob, decodeAsset } from '@/core/assets';
import type { Clipping } from '@/core/clipping/types';
import {
  buildBundle,
  type Bundle,
  type BundleSource,
  type BundleVolume,
  type ShareScope,
} from '@/core/share/bundle';
import type { JournalDoc } from '@/core/journal/types';
import type { VolumeRecord, VolumeSource } from '@/core/library/volume';
import { useBook } from './useBook';
import { useClips } from './useClips';
import { useJournal } from './useJournal';
import { useLibrary } from './useLibrary';
import { useTheme } from './useTheme';

/* ─── Полка → бандл ─────────────────────────────────────────────────────── */

export async function currentBundle(title: string, scope: ShareScope): Promise<Bundle> {
  const library = useLibrary.getState();
  const book = useBook.getState();

  return buildBundle(
    {
      title,
      volumes: library.volumes,
      desk: library.desk,
      journals: useJournal.getState().docs,
      clippings: useClips.getState().clips,
      // Плоский режим — это всё ещё стол: снимок делается с книги, а не с
      // ракурса, в котором её редактировали.
      view: library.view === 'case' ? 'case' : 'desk',
      typography: book.typography,
      scene: useTheme.getState().scene,
    },
    scope,
  );
}

/* ─── Бандл → полка ─────────────────────────────────────────────────────── */

export interface ApplyOptions {
  /** Байты ассетов, если они приехали вместе с бандлом. */
  assets?: Map<string, Blob>;
  /**
   * `replace` — полка становится этой (подъём из базы, открытие снимка).
   * `merge` — приезжее встаёт рядом со своим (форк, импорт файла).
   */
  mode: 'replace' | 'merge';
}

export interface ApplyResult {
  volumes: number;
  journals: number;
  clippings: number;
  assets: number;
}

export async function applyBundle(bundle: Bundle, options: ApplyOptions): Promise<ApplyResult> {
  /*
   * Байты кладём первыми и с проверкой хэша (`adoptAsset`). Пока их нет,
   * страница с картинкой напечаталась бы серым прямоугольником — и напечаталась
   * бы один раз, потому что перерисовывать её после доезда ассета некому.
   */
  let assets = 0;
  for (const [hash, blob] of options.assets ?? []) {
    try {
      await adoptAsset(hash, blob);
      await decodeAsset(hash);
      assets += 1;
    } catch {
      /* Байты не сошлись с именем — ссылка на них останется пустым местом. */
    }
  }

  const journals = useJournal.getState().docs;
  const clips = useClips.getState().clips;

  const nextJournals: Record<string, JournalDoc> =
    options.mode === 'replace' ? {} : { ...journals };
  for (const journal of bundle.journals) {
    if (options.mode === 'merge' && nextJournals[journal.id]) continue;
    nextJournals[journal.id] = journal;
  }

  const nextClips: Record<string, Clipping> = options.mode === 'replace' ? {} : { ...clips };
  const order = options.mode === 'replace' ? [] : [...useClips.getState().order];
  for (const clipping of bundle.clippings) {
    if (nextClips[clipping.id]) continue;
    nextClips[clipping.id] = clipping;
    order.push(clipping.id);
  }

  const records = bundle.volumes.map((volume) => unpackVolume(volume, nextClips));
  const known = options.mode === 'replace' ? [] : useLibrary.getState().volumes;
  const seen = new Set(known.map((v) => v.id));

  const shelf = [...known];
  let desk: VolumeRecord | null = null;

  for (const record of records) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    if (record.id === bundle.desk && options.mode === 'replace') desk = record;
    else shelf.push(record);
  }

  useJournal.setState({ docs: nextJournals });
  useClips.setState({ clips: nextClips, order });

  if (options.mode === 'replace') {
    useLibrary.setState({
      volumes: shelf,
      desk,
      view: bundle.view,
      flight: null,
      pending: null,
      armed: null,
      hovered: null,
    });
    useBook.setState({ typography: bundle.typography });
    // Свет приезжает вместе с полкой: снимок — это и комната тоже.
    useTheme.setState({ scene: bundle.scene });

    /*
     * Книгу со стола открываем сами. Обычно это делает `take`, но он начинает с
     * полёта с полки, а поднятая из базы книга ниоткуда не летит: она просто
     * лежит там, где её оставили.
     */
    if (desk) await reopen(desk);
    else useBook.getState().setExtent(0, 1);
  } else {
    useLibrary.setState({ volumes: shelf });
  }

  return {
    volumes: records.length,
    journals: bundle.journals.length,
    clippings: bundle.clippings.length,
    assets,
  };
}

async function reopen(desk: VolumeRecord): Promise<void> {
  if (desk.source.kind === 'journal') {
    const journal = useJournal.getState().docs[desk.source.journalId];
    if (!journal) return;
    useJournal.setState({ openId: journal.id, flatPage: null });
    useBook.getState().setExtent(journal.pages.length, Math.ceil(journal.pages.length / 2));
    return;
  }
  await useBook.getState().openVolume(desk);
}

/**
 * Источник из бандла — обратно в источник библиотеки.
 *
 * Досье восстанавливает свои вырезки по идентификаторам: внутри бандла реестр
 * есть, и §13 в этой точке оказывается прав. Не нашлась вырезка — том всё равно
 * встаёт на полку, но объявляет себя отсутствующим: досье из половины
 * источников выглядело бы книгой, а книгой бы не было.
 */
function unpackSource(source: BundleSource, clips: Record<string, Clipping>): VolumeSource {
  switch (source.kind) {
    case 'synthetic':
      return { kind: 'synthetic', options: source.options };

    case 'journal':
      return { kind: 'journal', journalId: source.journalId };

    case 'compiled': {
      const clippings = source.clippingIds.map((id) => clips[id]).filter(Boolean);
      return clippings.length === source.clippingIds.length
        ? { kind: 'compiled', clippings }
        : { kind: 'absent', was: 'compiled' };
    }

    case 'file': {
      /*
       * Файл книги собирается обратно из байтов в хранилище. `File`, а не
       * `Blob`: разбор EPUB читает имя, а по расширению выбирается путь
       * разбора. Байтов нет — том остаётся корешком без текста, и это тот же
       * случай, что и «поделились только внешним видом».
       */
      const bytes = assetBlob(source.assetHash);
      return bytes
        ? { kind: 'file', file: new File([bytes], source.name, { type: bytes.type }) }
        : { kind: 'absent', was: 'file' };
    }

    case 'absent':
      return { kind: 'absent', was: source.was };
  }
}

function unpackVolume(volume: BundleVolume, clips: Record<string, Clipping>): VolumeRecord {
  return {
    id: volume.id,
    kind: volume.kind,
    title: volume.title,
    author: volume.author,
    format: volume.format,
    language: volume.language,
    charCount: volume.charCount,
    pages: volume.pages,
    pagesKey: volume.pagesKey,
    theme: volume.theme,
    source: unpackSource(volume.source, clips),
    addedAt: volume.addedAt,
  };
}
