/**
 * Файл `.r3ad` — zip с манифестом и ассетами.
 *
 * «Тот же формат, что и снапшот» (SPEC §11.3) значит буквально это: внутри
 * лежит тот же `Bundle`, что уезжает в блоб, и те же байты под теми же именами.
 * Поэтому экспорт и шеринг не расходятся: файл на диске — это снапшот, который
 * никуда не поехал, а импорт чужого файла — тот же код, что и форк чужой
 * ссылки.
 *
 *     manifest.json      Bundle
 *     assets/<sha256>    байты, имя файла и есть его хэш
 *
 * Имя ассета — его хэш без расширения. Расширение соблазняет открыть файл по
 * имени, а не по манифесту, и первый же скриншот, сохранённый как `.jpg`, но
 * являющийся png, ломает эту привычку. Тип лежит в манифесте, и там ему место.
 *
 * Сжатие выключено. Внутри zip лежат png, jpeg и epub — уже сжатые контейнеры,
 * — и deflate поверх них тратит время на то, чтобы прибавить полпроцента.
 * Единственное, что действительно жмётся, — манифест, и он жмётся отдельно.
 *
 * `jszip` подгружается внутри функций, а не импортом сверху. Разница — семьдесят
 * килобайт первой загрузки: сюда попадают через кнопку «export» и через
 * перетаскивание файла, то есть в первую секунду работы сайта — никогда. То же
 * правило действует для разбора EPUB с M1, и нарушить его легко ровно потому,
 * что видно это только замером.
 */
import { assetBlob } from '../assets';
import { parseBundle, type Bundle } from './bundle';

export const R3AD_EXTENSION = '.r3ad';
const MANIFEST = 'manifest.json';
const ASSETS = 'assets/';

/** Собрать файл. Ассеты, которых нет в хранилище, тихо выпадают вместе со ссылками. */
export async function packBundle(bundle: Bundle): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file(MANIFEST, JSON.stringify(bundle, null, 2));

  for (const asset of bundle.assets) {
    const blob = assetBlob(asset.hash);
    if (blob) zip.file(ASSETS + asset.hash, blob);
  }

  return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' });
}

export interface UnpackedBundle {
  bundle: Bundle;
  /** Байты по хэшу. Класть их в хранилище — дело импортёра, он же проверит хэши. */
  assets: Map<string, Blob>;
}

export async function unpackBundle(file: Blob): Promise<UnpackedBundle> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);

  const manifest = zip.file(MANIFEST);
  if (!manifest) throw new Error('there is no manifest.json in that file');

  const bundle = parseBundle(JSON.parse(await manifest.async('string')));

  const assets = new Map<string, Blob>();
  for (const asset of bundle.assets) {
    const entry = zip.file(ASSETS + asset.hash);
    if (!entry) continue;
    // Тип берём из манифеста: в zip его нет вовсе, а браузеру он нужен, чтобы
    // декодировать картинку и чтобы `File` из книги открылся тем же путём.
    assets.set(asset.hash, new Blob([await entry.async('blob')], { type: asset.mime }));
  }

  return { bundle, assets };
}

/** Имя файла для скачивания: название снимка, а не идентификатор. */
export function packFileName(bundle: Bundle): string {
  const stem =
    bundle.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'shelf';
  return stem + R3AD_EXTENSION;
}
