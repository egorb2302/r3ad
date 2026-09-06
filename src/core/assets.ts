/**
 * Хранилище байтов, адресуемое содержимым.
 *
 * Ключ — sha256 самого блоба (SPEC §9.4). Один скриншот, вставленный на десять
 * страниц, лежит один раз; при шеринге он выгружается один раз (§11.3), и по
 * хэшу нельзя получить не то, что клали, — адресация по содержимому даёт и
 * дедупликацию, и неизменяемость бесплатно.
 *
 * До M5 здесь лежали только картинки тетради, и хранилище жило в её папке. Оно
 * переехало в корень ядра, когда выяснилось, что тем же ключом адресуется
 * файл книги: снапшот «том целиком» (§11.2) выгружает EPUB ровно так же, как
 * скриншот, — по хэшу, один раз, мимо функций. Отсюда разделение на `putAsset`
 * (положить байты) и `putImage` (положить и декодировать): декодировать EPUB
 * нечем, а хранить его надо тем же способом.
 *
 * Хэш проверяется при импорте, а не принимается на слово (см. `adoptAsset`).
 * Чужой бандл называет хэши сам, и если бы мы им верили, «адресация по
 * содержимому» держалась бы на честности того, кто прислал файл.
 */
export interface StoredAsset {
  hash: string;
  mime: string;
  bytes: number;
}

export interface StoredImage extends StoredAsset {
  width: number;
  height: number;
}

interface Entry extends StoredAsset {
  blob: Blob;
  /** Есть только у декодированных. Печать страницы синхронна и берёт готовое. */
  bitmap: ImageBitmap | null;
  width: number;
  height: number;
}

const store = new Map<string, Entry>();

export async function sha256(blob: Blob | ArrayBuffer): Promise<string> {
  const buffer = blob instanceof Blob ? await blob.arrayBuffer() : blob;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Положить байты. Возвращает уже лежащую запись, если такие байты знакомы. */
export async function putAsset(blob: Blob): Promise<StoredAsset> {
  const hash = await sha256(blob);
  return adoptAsset(hash, blob);
}

/**
 * Положить байты с уже известным хэшом — из бандла или из локальной базы.
 *
 * Хэш здесь пересчитывается, а не принимается: он приехал снаружи, и
 * единственное, что делает хранилище content-addressed, — это отказ класть
 * байты не под тем именем.
 */
export async function adoptAsset(hash: string, blob: Blob): Promise<StoredAsset> {
  const known = store.get(hash);
  if (known) return known;

  const actual = await sha256(blob);
  if (actual !== hash) throw new Error(`asset ${hash.slice(0, 8)} does not hash to its name`);

  const entry: Entry = {
    hash,
    mime: blob.type || 'application/octet-stream',
    bytes: blob.size,
    blob,
    bitmap: null,
    width: 0,
    height: 0,
  };
  store.set(hash, entry);
  return entry;
}

/**
 * Положить картинку и сразу её декодировать.
 *
 * Декодирование здесь, а не в момент отрисовки, намеренно: страница печатается
 * синхронно — и в текстуру, и в плоском режиме на каждый штрих, — а `drawImage`
 * умеет рисовать только уже готовый источник. Асинхронность в печати означала
 * бы мигающую картинку на каждой перерисовке.
 */
export async function putImage(blob: Blob): Promise<StoredImage> {
  const stored = await putAsset(blob);
  const decoded = await decodeAsset(stored.hash);
  if (!decoded) throw new Error('that file is not an image the browser can decode');
  return decoded;
}

/**
 * Поднять bitmap для уже лежащих байтов.
 *
 * Зовётся после импорта бандла: картинки приезжают блобами, а страница рисует
 * bitmap'ами. Неудача здесь не ошибка — в хранилище лежат и файлы книг, и
 * декодировать их нечем.
 */
export async function decodeAsset(hash: string): Promise<StoredImage | null> {
  const entry = store.get(hash);
  if (!entry) return null;
  if (entry.bitmap) return entry as StoredImage;

  try {
    const bitmap = await createImageBitmap(entry.blob);
    entry.bitmap = bitmap;
    entry.width = bitmap.width;
    entry.height = bitmap.height;
    return entry as StoredImage;
  } catch {
    return null;
  }
}

export function imageFor(hash: string): ImageBitmap | null {
  return store.get(hash)?.bitmap ?? null;
}

/** Размеры ассета. По ним карточка вырезки считает высоту иллюстрации. */
export function imageSize(hash: string): { width: number; height: number } | null {
  const entry = store.get(hash);
  return entry?.bitmap ? { width: entry.width, height: entry.height } : null;
}

/** Байты ассета — для выгрузки в снапшот и для записи в локальную базу. */
export function assetBlob(hash: string): Blob | null {
  return store.get(hash)?.blob ?? null;
}

export function assetInfo(hash: string): StoredAsset | null {
  const entry = store.get(hash);
  return entry ? { hash: entry.hash, mime: entry.mime, bytes: entry.bytes } : null;
}

/**
 * Ассет как data-URI — для страницы тома.
 *
 * Растеризатор превращает страницу в SVG-картинку, а та не грузит ничего
 * внешнего (SPEC §6.4): даже blob:-ссылка на собственный ассет останется
 * пустым местом. Поэтому картинка в скомпилированном томе едет байтами внутри
 * разметки, и строка кэшируется — одна и та же вырезка попадает и в главу, и в
 * оглавление, а base64 стоит заметно дороже, чем поиск по карте.
 */
const encoded = new Map<string, string>();

export async function assetDataUrl(hash: string): Promise<string | null> {
  const known = encoded.get(hash);
  if (known) return known;

  const entry = store.get(hash);
  if (!entry) return null;

  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(entry.blob);
  });

  encoded.set(hash, url);
  return url;
}

/** Вес одного ассета. По нему инспектор считает, сколько весит тетрадь. */
export function assetSize(hash: string): number {
  return store.get(hash)?.bytes ?? 0;
}

/**
 * Хранилище под рукой в дев-сборке.
 *
 * Ассеты — единственная часть системы, которую нельзя осмотреть ни через сторы,
 * ни через DOM: это байты и `ImageBitmap`, и после форка чужого снимка вопрос
 * «а картинка-то доехала» больше задать нечем.
 */
if (process.env.NODE_ENV !== 'production') {
  (globalThis as { __r3adAssets?: () => (StoredAsset & { decoded: boolean })[] }).__r3adAssets = () =>
    [...store.values()].map((e) => ({
      hash: e.hash,
      mime: e.mime,
      bytes: e.bytes,
      decoded: e.bitmap !== null,
    }));
}
