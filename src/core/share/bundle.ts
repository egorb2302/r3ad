/**
 * Бандл — то, во что упаковывается библиотека.
 *
 * Один формат на три назначения, и это главное решение M5. Бандл — это
 * одновременно:
 *
 *   — тело снапшота, которое лежит в блобе и отдаётся по `/s/:id` (§11.3);
 *   — содержимое файла `.r3ad`, который экспортируют себе на диск;
 *   — запись локальной базы, из которой полка поднимается после перезагрузки.
 *
 * Спецификация обещает первые два одинаковыми («тот же формат, что и снапшот»,
 * §11.3); третье добавилось само собой и оказалось лучшим из трёх аргументов.
 * Пока сохранение было отдельным кодом, оно было отдельным кодом, который никто
 * не открывает чужими глазами: расходится с импортом — узнаешь через месяц.
 * Когда «сохранить» и «поделиться» — одна дорога, форк чужой полки к себе
 * проверяет сохранение при каждой перезагрузке.
 *
 * Байтов здесь нет. Бандл называет ассеты хэшами, а сами байты едут рядом:
 * в zip — файлами в `assets/`, в снапшоте — блобами, залитыми напрямую мимо
 * функций (§15.1), в локальной базе — блобами в отдельном хранилище. Иначе
 * манифест на два мегабайта (§14) держал бы в себе десятимегабайтный EPUB в
 * base64.
 */
import { assetInfo, putAsset, type StoredAsset } from '../assets';
import type { Clipping } from '../clipping/types';
import type { JournalDoc } from '../journal/types';
import type { VolumeRecord, VolumeSource } from '../library/volume';
import type { SpinePalette } from '../library/palette';
import {
  DEFAULT_SCENE,
  themeWithCover,
  type BookTheme,
  type SceneTheme,
} from '../theme';
import type { DocFormat } from '../content';
import type { SyntheticOptions } from '../text/synthetic';
import type { Typography } from '../typography';

export const BUNDLE_FORMAT = 'r3ad';
/**
 * Версия формата.
 *
 * Вторая: на M6 у тома вместо палитры корешка появилась тема целиком (§8), а у
 * бандла — сцена. Первую версию читаем и переводим (`parseBundle`), и это не
 * вежливость к чужим файлам, а необходимость: тем же форматом записана
 * локальная база, то есть полка всех, кто открывал сайт до этой недели.
 */
export const BUNDLE_VERSION = 2;

/**
 * Что кладём (SPEC §11.2). Порядок — по возрастанию: каждый следующий объём
 * включает предыдущий.
 */
export type ShareScope = 'appearance' | 'journal' | 'volume';

export const SCOPES: ShareScope[] = ['appearance', 'journal', 'volume'];

export function includes(scope: ShareScope, needed: ShareScope): boolean {
  return SCOPES.indexOf(scope) >= SCOPES.indexOf(needed);
}

export interface BundleAsset {
  hash: string;
  mime: string;
  bytes: number;
}

/**
 * Источник тома по проводу.
 *
 * `File` сюда не поедет — это дескриптор открытого файла, он не сериализуется и
 * на чужой машине не значит ничего. Вместо него хэш ассета: байты книги лежат
 * там же, где скриншоты, и выгружаются один раз, даже если один и тот же EPUB
 * стоит на полке дважды.
 *
 * `absent` — том, у которого корешок поехал, а текст остался дома. Это не
 * поломка, а дефолтный объём шеринга (§11.2): «только внешний вид» — ровно
 * такая полка, где книги видно и не открыть.
 */
export type BundleSource =
  | { kind: 'synthetic'; options: SyntheticOptions }
  | { kind: 'journal'; journalId: string }
  /**
   * Досье ссылается на вырезки идентификаторами — так, как и обещала §13.
   *
   * В памяти том держит их копии (см. `VolumeSource`), и это не разнобой:
   * внутри бандла реестр вырезок действительно есть, он лежит рядом, поэтому
   * ссылаться безопасно и один и тот же тред не уезжает дважды.
   */
  | { kind: 'compiled'; clippingIds: string[] }
  | { kind: 'file'; name: string; format: DocFormat; assetHash: string }
  | { kind: 'absent'; was: 'file' | 'journal' | 'compiled' };

export interface BundleVolume {
  id: string;
  kind: 'volume' | 'journal';
  title: string;
  author: string;
  format: DocFormat;
  language: string;
  charCount: number;
  pages: number | null;
  pagesKey: string | null;
  theme: BookTheme;
  addedAt: number;
  source: BundleSource;
}

/**
 * Том из бандла любой версии.
 *
 * В первой у него была палитра корешка и не было темы, во второй наоборот;
 * разбору приезжает то одно, то другое, и различать их приходится по факту, а
 * не по номеру версии: локальная база хранит одну запись, и переписана она
 * может быть в любой момент.
 */
type StoredVolume = Omit<BundleVolume, 'theme'> & {
  theme?: BookTheme;
  palette?: SpinePalette;
};

/** Ракурс, на котором снят снимок. Не тип сцены: ядро про сцену не знает. */
export type BundleView = 'desk' | 'case';

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  /** Имя снимка. По нему он подписан на публичной странице и в списке экспортов. */
  title: string;
  scope: ShareScope;
  createdAt: number;

  volumes: BundleVolume[];
  journals: JournalDoc[];
  clippings: Clipping[];
  assets: BundleAsset[];

  /** Что лежало на столе и куда смотрели. Снимок — это ещё и поза. */
  desk: string | null;
  view: BundleView;
  typography: Typography;
  /** Свет, экспозиция, тени и порода дерева — комната, в которой снята полка. */
  scene: SceneTheme;
}

export interface BundleInput {
  title: string;
  volumes: VolumeRecord[];
  desk: VolumeRecord | null;
  journals: Record<string, JournalDoc>;
  clippings: Record<string, Clipping>;
  view: BundleView;
  typography: Typography;
  scene: SceneTheme;
}

/**
 * Собрать бандл.
 *
 * Асинхронно ровно из-за одного: файлы книг при объёме «том целиком» надо
 * сперва положить в хранилище ассетов, а хэш считается по байтам. Всё
 * остальное здесь — чистая перекладка полей.
 */
export async function buildBundle(input: BundleInput, scope: ShareScope): Promise<Bundle> {
  /*
   * Стол приписываем к ряду, но по идентификатору: книга успевает побывать
   * одновременно и на полке, и на столе — ровно на время полёта, когда слот в
   * ряду уже занят, а со стола ещё не убрали (см. useLibrary.shelve). Без карты
   * она уезжала бы в снимок дважды и возвращалась одна, потому что второй
   * экземпляр молча вытеснял первый.
   */
  const byId = new Map<string, VolumeRecord>();
  for (const record of [...input.volumes, ...(input.desk ? [input.desk] : [])]) {
    byId.set(record.id, record);
  }

  const volumes: BundleVolume[] = [];
  for (const record of byId.values()) {
    volumes.push({
      id: record.id,
      kind: record.kind,
      title: record.title,
      author: record.author,
      format: record.format,
      language: record.language,
      charCount: record.charCount,
      pages: record.pages,
      pagesKey: record.pagesKey,
      theme: record.theme,
      addedAt: record.addedAt,
      source: await packSource(record.source, scope),
    });
  }

  /*
   * Тетради и вырезки едут целиком или не едут вовсе. Половина конспекта — это
   * не «меньше данных», а страница с дырой на месте вырезки, и объяснять
   * получателю, почему у карточки пропал текст, было бы нечем.
   */
  const journals = includes(scope, 'journal') ? Object.values(input.journals) : [];
  const clippings = includes(scope, 'journal') ? Object.values(input.clippings) : [];

  const bundle: Bundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    title: input.title,
    scope,
    createdAt: Date.now(),
    volumes,
    journals,
    clippings,
    assets: [],
    desk: input.desk?.id ?? null,
    view: input.view,
    typography: input.typography,
    scene: input.scene,
  };

  bundle.assets = collectAssets(bundle);
  return bundle;
}

/**
 * Источник тома → источник в бандле.
 *
 * Синтетика едет при любом объёме, и это не дыра в «контент не выгружается».
 * Синтетический том — не текст человека, а зерно генератора на полсотни байт:
 * он воспроизводится на чужой машине посимвольно, и без него дефолтный снимок
 * полки был бы рядом заведомо неоткрываемых книг.
 */
async function packSource(source: VolumeSource, scope: ShareScope): Promise<BundleSource> {
  switch (source.kind) {
    case 'synthetic':
      return { kind: 'synthetic', options: source.options };

    case 'journal':
      return includes(scope, 'journal')
        ? { kind: 'journal', journalId: source.journalId }
        : { kind: 'absent', was: 'journal' };

    case 'compiled':
      return includes(scope, 'journal')
        ? { kind: 'compiled', clippingIds: source.clippings.map((c) => c.id) }
        : { kind: 'absent', was: 'compiled' };

    case 'file': {
      if (!includes(scope, 'volume')) return { kind: 'absent', was: 'file' };
      const stored = await hashFile(source.file);
      return {
        kind: 'file',
        name: source.file.name,
        format: formatOf(source.file.name),
        assetHash: stored.hash,
      };
    }

    case 'absent':
      return { kind: 'absent', was: source.was };
  }
}

/**
 * Хэш файла — один раз на файл.
 *
 * Локальная база пересобирает бандл на каждое изменение полки, и без этой карты
 * каждое сохранение означало бы sha256 по всем открытым книгам: десять мегабайт
 * EPUB — это десятки миллисекунд, отданные за ответ, который не менялся.
 * `WeakMap` потому, что ключ — сам файл: закрыли книгу, запись ушла сама.
 */
const hashedFiles = new WeakMap<File, StoredAsset>();

async function hashFile(file: File): Promise<StoredAsset> {
  const known = hashedFiles.get(file);
  if (known) return known;

  const stored = await putAsset(file);
  hashedFiles.set(file, stored);
  return stored;
}

function formatOf(name: string): DocFormat {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'epub') return 'epub';
  if (ext === 'md' || ext === 'markdown') return 'md';
  return 'txt';
}

/**
 * На что этот бандл ссылается.
 *
 * Считается по самому бандлу, а не по хранилищу: в хранилище лежит всё, что
 * человек когда-либо вставлял, включая картинки тетради, которую он делить не
 * стал.
 *
 * Отделено от `collectAssets` намеренно, и это не педантизм — это ошибка,
 * которая уже случилась. Пока список был один и в него попадали только те
 * ассеты, чьи байты нашлись в памяти, всякая временная их пропажа означала
 * манифест без ссылки. А по манифесту работает сборка мусора локальной базы —
 * и «сейчас байтов нет» превращалось в «удалить навсегда», хотя страница
 * тетради по-прежнему на них показывала. Ссылка обязана защищать байты, даже
 * когда самих байтов под рукой нет.
 */
export function referencedAssets(bundle: Bundle): string[] {
  const hashes = new Set<string>();

  for (const volume of bundle.volumes) {
    if (volume.source.kind === 'file') hashes.add(volume.source.assetHash);
  }

  for (const journal of bundle.journals) {
    for (const page of journal.pages) {
      for (const layer of page.layers) {
        if (layer.type !== 'blocks') continue;
        for (const block of layer.blocks) {
          if (block.type === 'image') hashes.add(block.assetHash);
        }
      }
    }
  }

  for (const clipping of bundle.clippings) {
    for (const media of clipping.media) hashes.add(media.assetHash);
    if (clipping.author?.avatarHash) hashes.add(clipping.author.avatarHash);
  }

  return [...hashes];
}

/**
 * Какие из них мы действительно можем отдать.
 *
 * Байты, которых нет в хранилище, потеряны раньше — чужим бандлом без ассетов,
 * очищенной базой, приватным окном. В манифест они не попадают: обещать
 * получателю картинку, которой у нас нет, хуже, чем её не обещать.
 */
export function collectAssets(bundle: Bundle): BundleAsset[] {
  const assets: BundleAsset[] = [];
  for (const hash of referencedAssets(bundle)) {
    const info = assetInfo(hash);
    if (info) assets.push(info);
  }
  return assets;
}

export interface BundleStats {
  volumes: number;
  journals: number;
  pages: number;
  clippings: number;
  assets: number;
  assetBytes: number;
  manifestBytes: number;
}

/** Что именно уедет — цифры для диалога шеринга (§11.2). */
export function bundleStats(bundle: Bundle): BundleStats {
  const pages = bundle.journals.reduce((n, j) => n + j.pages.length, 0);
  const assetBytes = bundle.assets.reduce((n, a) => n + a.bytes, 0);

  return {
    volumes: bundle.volumes.length,
    journals: bundle.journals.length,
    pages,
    clippings: bundle.clippings.length,
    assets: bundle.assets.length,
    assetBytes,
    manifestBytes: new TextEncoder().encode(JSON.stringify(bundle)).length,
  };
}

/**
 * Проверка бандла на входе.
 *
 * Бандл приезжает из чужих рук — из файла, из снапшота, из локальной базы,
 * записанной прошлой версией сайта. Разбирать его как объект известной формы,
 * не убедившись в форме, значит однажды получить `undefined.pages.length`
 * посреди отрисовки полки. Проверяем поверхностно и по существу: остальное
 * ловится тем, что ассеты пересчитываются по хэшу, а вырезки и штрихи всего
 * лишь рисуются.
 */
export function parseBundle(input: unknown): Bundle {
  const bundle = input as Partial<Bundle> | null;
  if (!bundle || typeof bundle !== 'object') throw new Error('that is not an r3ad bundle');
  if (bundle.format !== BUNDLE_FORMAT) throw new Error('that is not an r3ad bundle');
  if (typeof bundle.version !== 'number' || bundle.version > BUNDLE_VERSION) {
    throw new Error(`this bundle was written by a newer r3ad (v${String(bundle.version)})`);
  }
  if (!Array.isArray(bundle.volumes)) throw new Error('the bundle has no shelf in it');

  return {
    ...bundle,
    version: BUNDLE_VERSION,
    volumes: bundle.volumes.map(dressVolume),
    journals: Array.isArray(bundle.journals) ? bundle.journals : [],
    clippings: Array.isArray(bundle.clippings) ? bundle.clippings : [],
    assets: Array.isArray(bundle.assets) ? bundle.assets : [],
    scope: SCOPES.includes(bundle.scope as ShareScope) ? (bundle.scope as ShareScope) : 'appearance',
    view: bundle.view === 'case' ? 'case' : 'desk',
    title: typeof bundle.title === 'string' ? bundle.title : 'A shelf',
    desk: typeof bundle.desk === 'string' ? bundle.desk : null,
    scene: bundle.scene ?? DEFAULT_SCENE,
  } as Bundle;
}

/**
 * Том из бандла любой версии — в том виде, в каком его ждёт полка.
 *
 * Из первой версии приезжает палитра корешка и больше ничего, поэтому тема
 * собирается из её цвета: материал, тиснение и потёртость выводятся из
 * названия — ровно так же, как у книги, которую сегодня открыли впервые. Полка,
 * поднятая из старой базы, выглядит не «как раньше», а как выглядела бы,
 * появись M6 сразу, — и это лучший ответ из возможных: цвета в записи было
 * ровно столько, сколько было.
 */
function dressVolume(volume: StoredVolume): BundleVolume {
  if (volume.theme) return volume as BundleVolume;

  const { palette, ...rest } = volume;
  return {
    ...rest,
    theme: themeWithCover(
      `${volume.title}|${volume.author}`,
      palette?.cloth ?? '#3c4d63',
    ),
  };
}

export type { StoredAsset };
