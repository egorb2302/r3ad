/**
 * Подготовка иллюстраций к жизни внутри страницы-текстуры.
 *
 * Ограничение здесь жёстче, чем в вебе: картинка обязана быть data-URI, потому
 * что растеризация идёт через SVG, загруженный как изображение, а такому
 * документу внешние ресурсы недоступны — ни blob:, ни путь на сервере (SPEC
 * §6.4). Значит, каждая иллюстрация книги едет в разметке страницы своим
 * base64, и её вес мы платим при каждой растеризации.
 *
 * Отсюда пережатие. Скан на 3000 px в книге, у которой страница 1024 px шириной,
 * не даёт ничего, кроме лишних 900 КБ в каждом кадре: base64 ещё и на треть
 * толще двоичного оригинала.
 */

export interface EncodedImage {
  url: string;
  width: number;
  height: number;
  /** Вес data-URI в байтах — то, что реально попадёт в SVG. */
  bytes: number;
}

export interface EncodeOptions {
  /** Больше этого по любой стороне — уменьшаем. Страница текстуры всё равно уже. */
  maxPx?: number;
  /** Оригинал легче этого оставляем как есть: пережатие только испортит. */
  keepBytes?: number;
  quality?: number;
  /** Фон под пережатую картинку: альфа в JPEG не переживает, а бумага не белая. */
  paper?: string;
}

const DEFAULTS = {
  maxPx: 1400,
  keepBytes: 64 * 1024,
  quality: 0.82,
  paper: '#f6f1e6',
};

/** Байты → data-URI без пережатия. */
function rawDataUrl(data: Uint8Array, mime: string): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Вес data-URI: base64 несёт 3 байта на каждые 4 символа. */
const urlBytes = (url: string) => {
  const comma = url.indexOf(',');
  return comma < 0 ? url.length : Math.round(((url.length - comma - 1) * 3) / 4);
};

export async function encodeImage(
  data: Uint8Array,
  mime: string,
  options: EncodeOptions = {},
): Promise<EncodedImage | null> {
  const { maxPx, keepBytes, quality, paper } = { ...DEFAULTS, ...options };

  /*
   * SVG проходит насквозь. Вектор не пережимается, весит обычно единицы
   * килобайт, а растеризовать его в canvas ради размеров — значит потерять
   * ровно то, ради чего он вектор.
   */
  if (mime === 'image/svg+xml') {
    const url = rawDataUrl(data, mime);
    return { url, width: 0, height: 0, bytes: urlBytes(url) };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([data as BlobPart], { type: mime }));
  } catch {
    return null;
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, maxPx / Math.max(width, height));

  // Мелкий оригинал в формате с альфой оставляем нетронутым: прозрачность
  // логотипа или схемы важнее сэкономленных килобайт.
  if (scale === 1 && data.length <= keepBytes && mime !== 'image/jpeg') {
    bitmap.close();
    const url = rawDataUrl(data, mime);
    return { url, width, height, bytes: urlBytes(url) };
  }

  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return null;
  }

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const url = canvas.toDataURL('image/jpeg', quality);
  canvas.width = 0;
  canvas.height = 0;

  return { url, width: w, height: h, bytes: urlBytes(url) };
}
