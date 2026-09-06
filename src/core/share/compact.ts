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
import { hashString } from '../library/palette';
import {
  decodeScene,
  decodeTheme,
  encodeScene,
  encodeTheme,
  isDerived,
  themeFor,
  type SceneTheme,
} from '../theme';
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
 * цвет переплёта, в полтора килобайта не влезает никак, поэтому едет уже
 * готовая тема — но лишь у тех томов, где она отличается от выводимой из
 * названия. У полки, набранной синтетикой и демо-каталогом, это ноль лишних
 * байт; у полки, которую перекрасили руками, — тринадцать знаков на том, и
 * ссылка честно от этого длиннеет.
 *
 * **Уточнено на M6.** Раньше здесь ехал один цвет, теперь тема целиком:
 * материал, тиснение, бумага, обрез. Обошлось это в семь знаков на
 * перекрашенный том, и другого выхода не было — полка, у которой на чужом
 * экране пропала кожа и золочёный обрез, обещания «выглядит так же» не
 * выполняет.
 */
interface CompactVolume {
  kind: 'volume' | 'journal';
  title: string;
  author: string;
  chars: number;
  /** Упакованная тема или пустая строка, если она выводится из названия. */
  theme: string;
}

export interface CompactShelf {
  title: string;
  /** Свет и порода дерева: четыре знака на всю полку. */
  scene: SceneTheme;
  volumes: CompactVolume[];
}

/** Убираем разделители из данных: они наши, а не пользовательские. */
const clean = (text: string) => text.replace(/[\x1e\x1f]/g, ' ');

export function encodeShelf(shelf: CompactShelf): string {
  // Первая строка — заголовок полки и её сцена: они одни на всю ссылку.
  const rows = [[clean(shelf.title), encodeScene(shelf.scene)].join(FIELD)];

  for (const volume of shelf.volumes) {
    rows.push(
      [
        volume.kind === 'journal' ? 'j' : 'v',
        clean(volume.title),
        clean(volume.author),
        String(Math.round(volume.chars)),
        volume.theme,
      ].join(FIELD),
    );
  }

  return rows.join(ROW);
}

export function decodeShelf(text: string): CompactShelf {
  const rows = text.split(ROW);
  const volumes: CompactVolume[] = [];

  for (const row of rows.slice(1)) {
    const [kind, title, author, chars, theme] = row.split(FIELD);
    if (!title) continue;
    volumes.push({
      kind: kind === 'j' ? 'journal' : 'volume',
      title,
      author: author ?? '',
      chars: Number(chars) || 0,
      theme: theme ?? '',
    });
  }

  const [title, scene] = (rows[0] ?? '').split(FIELD);
  return { title: title || 'A shelf', scene: decodeScene(scene ?? ''), volumes };
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

export function shelfFromVolumes(
  title: string,
  volumes: VolumeRecord[],
  scene: SceneTheme,
): CompactShelf {
  return {
    title,
    scene,
    volumes: volumes.map((volume) => ({
      kind: volume.kind,
      title: volume.title,
      author: volume.author,
      chars: volume.charCount || estimatedChars(volume),
      // Тему пишем, только если она не выводится из названия: у книги с
      // обложкой цвет взят из её доминанты, у остальных — из хэша, и повторять
      // в адресе то, что и так посчитается, значит платить за воздух.
      theme: isDerived(volume.theme, seedOf(volume)) ? '' : encodeTheme(volume.theme),
    })),
  };
}

const seedOf = (volume: { title: string; author: string }) => `${volume.title}|${volume.author}`;

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
    const derived = themeFor(seedOf(row));

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
      theme: row.theme ? decodeTheme(row.theme, derived) : derived,
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
