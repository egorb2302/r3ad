/**
 * Синтетическая книга для M0.
 *
 * Пока нет парсера EPUB, разбивке на страницы нужен подопытный текст — но
 * такой, который честно нагружает конвейер: курсив, заголовки двух уровней,
 * эпиграфы, длинные слова под переносы. Генератор детерминированный:
 * одинаковый seed даёт одинаковое число страниц, иначе нечем мерить регрессии
 * вёрстки.
 */
import type { Chapter } from '../paginate/paginate';

/** mulberry32 — короткий и достаточный для текста. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOUNS = [
  'page', 'spine', 'binding', 'typeface', 'text block', 'running head', 'spread',
  'compositor', 'typesetter', 'impression', 'sort', 'point size', 'paragraph',
  'justification', 'library', 'shelf', 'catalogue', 'manuscript', 'bookmark',
  'endpaper', 'paper', 'ink', 'print run', 'typographer', 'family', 'leading',
  'trim', 'foil', 'signature', 'folio', 'colophon', 'gutter',
];
const ADJECTIVES = [
  'dense', 'faded', 'narrow', 'warm', 'cream', 'elongated', 'unhurried',
  'coarse', 'even', 'stamped', 'trimmed', 'worn', 'muted', 'printed',
  'composed', 'dry', 'thin', 'wide', 'matte', 'bound',
];
const VERBS = [
  'settles', 'holds', 'fades', 'breaks', 'meets', 'stretches', 'drifts',
  'remains', 'breathes', 'surfaces', 'shifts', 'aligns', 'folds', 'opens',
  'crumbles', 'glows', 'lingers', 'waits',
];
const ADVERBS = [
  'slowly', 'evenly', 'barely', 'at last', 'still', 'suddenly', 'habitually',
  'carefully', 'dryly', 'dully', 'perceptibly', 'noticeably', 'unhurriedly',
];
const CONNECTORS = ['and', 'but', 'because', 'although', 'while', 'yet', 'so', 'when'];

/** Термины ремесла — идут курсивом, чтобы растеризатор получал курсивный прогон. */
const TERMS = [
  'kerning', 'leading', 'em dash', 'widow', 'orphan', 'baseline', 'x-height',
  'ligature', 'hinting', 'subpixel', 'ascender', 'descender',
];

const CHAPTER_TITLES = [
  'On the Nature of the Text Block', 'Point Size and Its Consequences',
  'What the Spine Remembers', 'Hyphenation', 'Widows and Orphans',
  'Thickness as an Argument', 'Paper Against Glass', "The Compositor's Craft",
  'Margins and Air', 'Italic, Used Well', 'The Folio', 'The Spread',
  'Typeface and Character', 'The Impression', 'Between the Lines', 'The Trim',
  'The Endpaper', 'Signatures', 'Foil on Leather', 'The Catalogue',
  'The Shelf', 'The Reader', 'The Bookmark', 'The Colophon',
  'The Head Margin', 'The Foot Margin', 'The Inner Margin', 'The Outer Margin',
];

export interface SyntheticOptions {
  seed?: number;
  chapters?: number;
  paragraphsPerChapter?: number;
  title?: string;
  author?: string;
}

function sentence(r: () => number): string {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];

  const clauses = [`the ${pick(ADJECTIVES)} ${pick(NOUNS)} ${pick(ADVERBS)} ${pick(VERBS)}`];

  if (r() < 0.55) {
    clauses.push(`${pick(CONNECTORS)} the ${pick(ADJECTIVES)} ${pick(NOUNS)} ${pick(VERBS)}`);
  }
  if (r() < 0.3) {
    clauses.push(`and the ${pick(NOUNS)} ${pick(VERBS)} with it`);
  }

  let text = clauses.join(', ');
  if (r() < 0.22) {
    // Термин ремесла курсивом — типичный случай в книге о наборе.
    text += ` — what the trade calls <em>${pick(TERMS)}</em>`;
  }

  return text.charAt(0).toUpperCase() + text.slice(1) + (r() < 0.08 ? '?' : '.');
}

function paragraph(r: () => number): string {
  const n = 4 + Math.floor(r() * 6);
  const body = Array.from({ length: n }, () => sentence(r)).join(' ');
  return `<p>${body}</p>`;
}

/**
 * Знаков текста в среднем абзаце этого генератора.
 *
 * Замерено на выдаче, а не выведено из констант: длина предложения складывается
 * из четырёх вероятностных ветвей, и аналитическая оценка разошлась бы ровно
 * там, где это дороже всего, — на объёме тома.
 */
export const CHARS_PER_PARAGRAPH = 447;

/** Что глава добавляет сверх абзацев: заголовок, иногда эпиграф и подзаголовки. */
const CHARS_PER_CHAPTER = 120;

/**
 * Знаков в главе. Пятнадцать-двадцать страниц — обычная для романа величина;
 * по ней из объёма книги выводится число глав, а не наоборот.
 */
const CHAPTER_TARGET = 30_000;

/**
 * Настройки генератора под заданный объём.
 *
 * Библиотеке нужен обратный ход: не «сколько знаков даст эта книга», а «какую
 * книгу написать, чтобы вышло столько знаков». Полка задаёт тома в страницах,
 * и без этой функции их объём приходилось бы подбирать вручную.
 */
export function optionsForExtent(
  charCount: number,
  meta: { seed: number; title: string; author: string },
): SyntheticOptions {
  const chapters = Math.min(48, Math.max(3, Math.round(charCount / CHAPTER_TARGET)));
  const paragraphsPerChapter = Math.max(
    1,
    Math.round((charCount / chapters - CHARS_PER_CHAPTER) / CHARS_PER_PARAGRAPH),
  );

  return {
    seed: meta.seed,
    chapters,
    paragraphsPerChapter,
    title: meta.title,
    author: meta.author,
  };
}

export interface SyntheticBook {
  title: string;
  author: string;
  chapters: Chapter[];
  charCount: number;
}

/**
 * Значения по умолчанию подобраны так, чтобы при кегле 10.5 pt получалось
 * около трёхсот страниц — размер обычного романа, на котором видно и толщину
 * тома, и стоимость вёрстки.
 */
export function generateBook(options: SyntheticOptions = {}): SyntheticBook {
  const {
    seed = 20260906,
    chapters: chapterCount = 24,
    paragraphsPerChapter = 46,
    title = 'Thickness',
    author = 'r3',
  } = options;

  const r = rng(seed);
  const chapters: Chapter[] = [];
  let charCount = 0;

  for (let i = 0; i < chapterCount; i++) {
    const heading = CHAPTER_TITLES[i % CHAPTER_TITLES.length];
    const blocks: string[] = [`<h1>${i + 1}. ${heading}</h1>`];

    // Эпиграф в трети глав — даёт растеризатору курсивный блок.
    if (r() < 0.34) {
      blocks.push(`<blockquote><p>${sentence(r)} ${sentence(r)}</p></blockquote>`);
    }

    for (let p = 0; p < paragraphsPerChapter; p++) {
      // Изредка подзаголовок — проверяет break-after:avoid на границе колонки.
      if (p > 0 && r() < 0.06) {
        blocks.push(`<h2>${CHAPTER_TITLES[Math.floor(r() * CHAPTER_TITLES.length)]}</h2>`);
      }
      blocks.push(paragraph(r));
    }

    const html = blocks.join('\n');
    charCount += html.length;
    chapters.push({ id: `ch${i + 1}`, title: `${i + 1}. ${heading}`, html });
  }

  return { title, author, chapters, charCount };
}
