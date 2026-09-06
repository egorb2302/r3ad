/**
 * Промежуточное представление контента — то, во что сходятся все источники.
 *
 * Всё, что умеет читать сайт (EPUB, txt, markdown, вырезка из ссылки,
 * синтетика), нормализуется сюда, и дальше по конвейеру идёт только `ContentDoc`.
 * Разбивка на страницы, растеризация и сцена про исходный формат ничего не
 * знают — иначе каждый новый формат пришлось бы протаскивать через весь стек
 * (SPEC §6.2).
 */

export type DocFormat = 'epub' | 'txt' | 'md' | 'synthetic';

/** Единица разбивки. Глава верстается целиком и всегда начинается с новой страницы. */
export interface Chapter {
  id: string;
  title: string;
  /** Санитизированный HTML. Внешних ссылок нет: картинки уже data-URI. */
  html: string;
}

export interface TocEntry {
  id: string;
  title: string;
  chapterId: string;
  /** Вложенность в оглавлении, с нуля. */
  depth: number;
}

/**
 * Претензия к исходнику, из-за которой что-то не поехало.
 *
 * Зоопарк EPUB — риск №1 из SPEC §19, и стратегия там мягкая деградация:
 * не разобрали оглавление — собираем из spine, не нашли картинку — выкидываем
 * её и читаем текст дальше. Молча этого делать нельзя, поэтому каждый такой
 * случай оседает здесь и показывается в инспекторе.
 */
export interface DocWarning {
  code: string;
  message: string;
}

export interface ContentDoc {
  id: string;
  format: DocFormat;
  title: string;
  author: string;
  /** BCP-47 из метаданных книги. Управляет переносами, а значит и числом страниц. */
  language: string;
  chapters: Chapter[];
  toc: TocEntry[];
  charCount: number;
  imageCount: number;
  /** Вес встроенных картинок в байтах — по нему видно, во что обойдётся растр. */
  imageBytes: number;
  /** Размер исходного файла. 0 для синтетики. */
  sourceBytes: number;
  warnings: DocWarning[];
  tookMs: number;
}

/**
 * Знаки и картинки по главам.
 *
 * Считаем по тексту, а не по длине разметки: картинки лежат в HTML как base64,
 * и «книга на 40 миллионов знаков» была бы враньём в интерфейсе — там на самом
 * деле три иллюстрации.
 */
export function docStats(chapters: Chapter[]) {
  let charCount = 0;
  let imageCount = 0;
  for (const c of chapters) {
    charCount += c.html.replace(/<[^>]*>/g, '').length;
    imageCount += (c.html.match(/<img\b/g) ?? []).length;
  }
  return { charCount, imageCount };
}
