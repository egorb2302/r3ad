/**
 * Хранилище картинок, вставленных в тетрадь.
 *
 * Ключ — sha256 самого блоба (SPEC §9.4). Один скриншот, вставленный на десять
 * страниц, лежит один раз, и при шеринге (M6) выгружается один раз: адресация
 * по содержимому даёт дедупликацию бесплатно и делает ассет неизменяемым — по
 * хэшу нельзя получить не то, что клали.
 *
 * Пока хранилище живёт в памяти вкладки. OPFS, как в спецификации, появится
 * вместе с локальной базой на M5: без неё блобы всё равно некуда переживать
 * перезагрузку, а интерфейс хранилища от этого не изменится — те же `put` и
 * `get` по хэшу, только асинхронные внутри.
 */
export interface StoredImage {
  hash: string;
  width: number;
  height: number;
  bytes: number;
}

interface Entry extends StoredImage {
  blob: Blob;
  bitmap: ImageBitmap;
}

const store = new Map<string, Entry>();

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
  const hash = await sha256(blob);

  const known = store.get(hash);
  if (known) return known;

  const bitmap = await createImageBitmap(blob);
  const entry: Entry = {
    hash,
    width: bitmap.width,
    height: bitmap.height,
    bytes: blob.size,
    blob,
    bitmap,
  };
  store.set(hash, entry);
  return entry;
}

export function imageFor(hash: string): ImageBitmap | null {
  return store.get(hash)?.bitmap ?? null;
}

/** Размеры ассета. По ним карточка вырезки считает высоту иллюстрации. */
export function imageSize(hash: string): { width: number; height: number } | null {
  const entry = store.get(hash);
  return entry ? { width: entry.width, height: entry.height } : null;
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
