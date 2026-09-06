/**
 * Ссылка без сервера: вся полка внутри адреса.
 *
 * Первый из двух уровней шеринга (SPEC §11.1). Идея не в экономии, а в том,
 * что у неё нет инфраструктуры вовсе: `?s=…` открывается со статики, из
 * локального файла, из скриншота адресной строки, набранного руками, — и будет
 * открываться, когда у проекта кончится бесплатный тир, истечёт TTL снапшота
 * или его снесут по жалобе. Демо-момент вехи — «ссылка на полку, открытая с
 * телефона» — работает именно на этом уровне.
 *
 * Отсюда потолок в полтора килобайта. Он не выдуман: адресную строку
 * ограничивают все по-разному, но 2 КБ переживает всё, включая старые прокси,
 * а IE с его 2083 байтами давно можно не считать. Не влезло — значит, снимку
 * нужен `/s/:id`, и вызывающий код это и делает.
 *
 * Формат намеренно не JSON. Полка — это таблица из четырёх колонок, и JSON
 * тратит на её кавычки и имена полей ровно тот бюджет, ради которого всё
 * затевается: те же сорок томов в JSON занимают втрое больше ещё до сжатия.
 */
import {
  hashString,
  hexToHsl,
  paletteFor,
  paletteFromColor,
  type SpinePalette,
} from '../library/palette';
import { optionsForExtent } from '../text/synthetic';
import type { VolumeRecord } from '../library/volume';
import { fromBase64Url, toBase64Url } from './lock';

/** Потолок полезной части адреса, в знаках. */
export const COMPACT_MAX = 1500;

const FIELD = '\x1f';
const ROW = '\x1e';

/**
 * Что помещается в адрес.
 *
 * Только внешний вид, и даже он — не весь. Обложка, из доминанты которой взят
 * цвет корешка, в полтора килобайта не влезает никак, поэтому цвет едет
 * готовым — но лишь у тех томов, где он отличается от выводимого из названия.
 * У полки, набранной синтетикой и демо-каталогом, это ноль лишних байт.
 */
interface CompactVolume {
  kind: 'volume' | 'journal';
  title: string;
  author: string;
  chars: number;
  cloth: string;
}

export interface CompactShelf {
  title: string;
  volumes: CompactVolume[];
}

/** Убираем разделители из данных: они наши, а не пользовательские. */
const clean = (text: string) => text.replace(/[\x1e\x1f]/g, ' ');

export function encodeShelf(shelf: CompactShelf): string {
  const rows = [clean(shelf.title)];

  for (const volume of shelf.volumes) {
    rows.push(
      [
        volume.kind === 'journal' ? 'j' : 'v',
        clean(volume.title),
        clean(volume.author),
        String(Math.round(volume.chars)),
        volume.cloth,
      ].join(FIELD),
    );
  }

  return rows.join(ROW);
}

export function decodeShelf(text: string): CompactShelf {
  const rows = text.split(ROW);
  const volumes: CompactVolume[] = [];

  for (const row of rows.slice(1)) {
    const [kind, title, author, chars, cloth] = row.split(FIELD);
    if (!title) continue;
    volumes.push({
      kind: kind === 'j' ? 'journal' : 'volume',
      title,
      author: author ?? '',
      chars: Number(chars) || 0,
      cloth: cloth ?? '',
    });
  }

  return { title: rows[0] ?? 'A shelf', volumes };
}

/* ─── Сжатие ────────────────────────────────────────────────────────────── */

async function through(bytes: Uint8Array, stream: TransformStream): Promise<Uint8Array> {
  const blob = new Blob([bytes as BlobPart]);
  const piped = blob.stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/**
 * Первый знак полезной части — метка способа упаковки.
 *
 * `z` — deflate, `p` — как есть. Метка нужна не ради будущих алгоритмов, а
 * ради `CompressionStream`, которого в старом браузере может не быть: ссылка
 * тогда получается длиннее, но получается.
 */
export async function packShelf(shelf: CompactShelf): Promise<string> {
  const bytes = new TextEncoder().encode(encodeShelf(shelf));

  if (typeof CompressionStream === 'undefined') return 'p' + toBase64Url(bytes);
  return 'z' + toBase64Url(await through(bytes, new CompressionStream('deflate-raw')));
}

export async function unpackShelf(payload: string): Promise<CompactShelf> {
  const body = fromBase64Url(payload.slice(1));

  if (payload[0] === 'z') {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('this browser cannot read a compressed shelf link');
    }
    const plain = await through(body, new DecompressionStream('deflate-raw'));
    return decodeShelf(new TextDecoder().decode(plain));
  }

  return decodeShelf(new TextDecoder().decode(body));
}

/* ─── Мост к записям библиотеки ─────────────────────────────────────────── */

export function shelfFromVolumes(title: string, volumes: VolumeRecord[]): CompactShelf {
  return {
    title,
    volumes: volumes.map((volume) => ({
      kind: volume.kind,
      title: volume.title,
      author: volume.author,
      chars: volume.charCount || estimatedChars(volume),
      // Цвет пишем, только если он не выводится из названия: у книги с обложкой
      // он взят из её доминанты, у остальных — из хэша, и повторять его в
      // адресе значит платить за то, что и так посчитается.
      cloth: sameAsDerived(volume) ? '' : volume.palette.cloth.replace('#', ''),
    })),
  };
}

function sameAsDerived(volume: VolumeRecord): boolean {
  return paletteFor(`${volume.title}|${volume.author}`).cloth === volume.palette.cloth;
}

/** У тетради знаков нет — объём ей задают страницы. Для корешка их надо перевести. */
function estimatedChars(volume: VolumeRecord): number {
  return (volume.pages ?? 0) * 1800;
}

/**
 * Полка из адреса — обратно в записи библиотеки.
 *
 * Том становится синтетическим, а не «отсутствующим»: параметры генератора
 * выводятся из числа знаков и названия, то есть книга открывается и читается.
 * Текста автора в ней нет и не было — в полтора килобайта уехали название,
 * фамилия и толщина, а знаки под ними генератор насыпал свои. Это честнее
 * пустого тома: ссылка обещала внешний вид полки, и внешний вид полки —
 * включая то, что книгу можно снять и полистать, — она отдаёт целиком.
 */
export function volumesFromShelf(shelf: CompactShelf): VolumeRecord[] {
  return shelf.volumes.map((row, index) => {
    const id = `shared-${String(index + 1).padStart(2, '0')}`;
    const palette: SpinePalette = row.cloth
      ? paletteFromColor(hexToHsl(`#${row.cloth}`))
      : paletteFor(`${row.title}|${row.author}`);

    return {
      id,
      kind: 'volume' as const,
      title: row.title,
      author: row.author,
      format: 'synthetic' as const,
      language: 'en',
      charCount: row.chars,
      pages: null,
      pagesKey: null,
      palette,
      source: {
        kind: 'synthetic' as const,
        options: optionsForExtent(row.chars, {
          seed: hashString(`${row.title}|${row.author}`),
          title: row.title,
          author: row.author,
        }),
      },
      addedAt: index,
    };
  });
}
