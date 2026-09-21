/**
 * Книги, приехавшие вместе с сайтом.
 *
 * SPEC §21.2: пустой стеллаж — плохая первая страница, а полка из одной
 * синтетики — полка, на которой нечего читать. Шесть настоящих книг из
 * общественного достояния лежат в `public/demo/` и отдаются с того же адреса,
 * что и шрифты. Local-first этим не нарушен: это часть сайта, а не сторонний
 * ресурс, и первое же открытие книги оседает в кэше браузера.
 *
 * Издания — Standard Ebooks (standardebooks.org): вычитанный текст с
 * Гутенберга в чистой семантической разметке EPUB 3, их собственная работа
 * отдана в CC0. Файлы взяты как есть, за одним исключением: обложка ужата до
 * 600 px по ширине. Она нигде не показывается — из неё берётся один цвет для
 * корешка, — а весила вдвое больше самого текста.
 *
 * Том с таким источником не хранит текста ни в записи, ни в базе, ни в
 * снимке — только имя файла. Открывается он так же, как файл с диска: байты
 * приезжают по сети, дальше тот же `openFile`, что и у книги, брошенной в окно.
 * Поэтому и в снимок он едет при любом объёме шеринга: текст у получателя
 * есть — на том же сайте.
 *
 * Число знаков и доминанта обложки посчитаны заранее и записаны здесь:
 * корешок нужной толщины и цвета должен стоять на полке до того, как книгу
 * впервые снимут. Знаки сверяет тест (`tests/core/shipped.test.ts`):
 * разойдутся с файлом — он об этом скажет.
 */
import { clothFromColor, type Hsl } from './palette';
import { themeWithCover, type BookTheme } from '../theme';
import type { VolumeRecord } from './volume';

/** Откуда отдаются файлы. Тот же источник, что и `/fonts/`. */
export const SHIPPED_BASE = '/demo/';

export interface ShippedBook {
  /** Имя файла в `public/demo/`. */
  file: string;
  title: string;
  author: string;
  language: string;
  /** Знаков в тексте — столько, сколько насчитал `openFile`. */
  chars: number;
  /** Доминанта обложки (см. `dominantColor`), по ней красится корешок. */
  cover: Hsl;
  /** Откуда взят текст: страница на Гутенберге или другой первоисточник. */
  origin: string;
}

/** Порядок — порядок на полке: слева направо. */
export const SHIPPED: readonly ShippedBook[] = [
  {
    file: 'h-g-wells_the-time-machine.epub',
    title: 'The Time Machine',
    author: 'H. G. Wells',
    language: 'en-GB',
    chars: 184_150,
    cover: { h: 37.5, s: 0.506, l: 0.329 },
    origin: 'https://www.gutenberg.org/ebooks/35',
  },
  {
    file: 'mary-shelley_frankenstein.epub',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    language: 'en-GB',
    chars: 444_771,
    cover: { h: 7.5, s: 0.487, l: 0.315 },
    origin: 'https://www.gutenberg.org/ebooks/42324',
  },
  {
    file: 'jane-austen_pride-and-prejudice.epub',
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    language: 'en-GB',
    chars: 699_628,
    cover: { h: 37.5, s: 0.468, l: 0.308 },
    origin: 'https://www.gutenberg.org/ebooks/42671',
  },
  {
    file: 'arthur-conan-doyle_the-adventures-of-sherlock-holmes.epub',
    title: 'The Adventures of Sherlock Holmes',
    author: 'Arthur Conan Doyle',
    language: 'en-GB',
    chars: 573_981,
    cover: { h: 7.5, s: 0.618, l: 0.082 },
    origin: 'https://www.gutenberg.org/ebooks/1661',
  },
  {
    file: 'joseph-conrad_heart-of-darkness.epub',
    title: 'Heart of Darkness',
    author: 'Joseph Conrad',
    language: 'en-US',
    chars: 215_662,
    cover: { h: 30, s: 0.05, l: 0.173 },
    origin: 'https://www.gutenberg.org/ebooks/219',
  },
  {
    file: 'marcus-aurelius_meditations_george-long.epub',
    title: 'Meditations',
    author: 'Marcus Aurelius',
    language: 'en-GB',
    chars: 279_499,
    cover: { h: 22.5, s: 0.422, l: 0.38 },
    origin: 'http://classics.mit.edu/Antoninus/meditations.html',
  },
];

export function shippedByFile(file: string): ShippedBook | undefined {
  return SHIPPED.find((book) => book.file === file);
}

/**
 * Идентификатор — из имени файла, а не из порядкового номера: книга на полке
 * у двух людей обязана быть одной и той же книгой (§21.16), а порядок в
 * каталоге может и поменяться.
 */
export function shippedId(book: ShippedBook): string {
  return `book-${book.file.replace(/\.epub$/, '')}`;
}

/** Тема по обложке издания — та, что и у брошенного в окно EPUB с обложкой. */
export function shippedTheme(book: ShippedBook): BookTheme {
  return themeWithCover(`${book.title}|${book.author}`, clothFromColor(book.cover));
}

export function shippedRecord(book: ShippedBook, addedAt: number): VolumeRecord {
  return {
    id: shippedId(book),
    kind: 'volume',
    title: book.title,
    author: book.author,
    format: 'epub',
    language: book.language,
    charCount: book.chars,
    pages: null,
    pagesKey: null,
    theme: shippedTheme(book),
    source: { kind: 'shipped', file: book.file },
    addedAt,
  };
}

/** Все вшитые книги записями библиотеки, в порядке каталога. */
export function shippedLibrary(): VolumeRecord[] {
  return SHIPPED.map((book, index) => shippedRecord(book, index));
}
