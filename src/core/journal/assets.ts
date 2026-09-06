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

/** Вес одного ассета. По нему инспектор считает, сколько весит тетрадь. */
export function assetSize(hash: string): number {
  return store.get(hash)?.bytes ?? 0;
}
