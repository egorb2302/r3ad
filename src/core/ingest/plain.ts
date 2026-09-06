/**
 * Простой текст и markdown.
 *
 * Формат без структуры, а книге структура нужна: главы — это не только
 * оглавление, но и единица работы конвейера. Разбивка идёт по главам, между
 * ними управление возвращается браузеру, и по ним же считается прогресс
 * (см. paginate). Один кусок на весь роман означал бы секундный фриз без
 * единого признака жизни на экране.
 *
 * Поэтому там, где заголовков нет, текст всё равно режется — по абзацам,
 * молча и ровно настолько, чтобы конвейер дышал.
 */
import { docStats, type Chapter, type ContentDoc, type DocWarning, type TocEntry } from '../content';
import { extractTitle, parseHtml, sanitize } from '../normalize/sanitize';

/** Строка вида «Chapter VII», «Часть вторая» — почти наверняка заголовок. */
const HEADING_WORD =
  /^\s*(chapter|part|book|section|prologue|epilogue|interlude|appendix|глава|часть|книга|пролог|эпилог)\b/i;

/** Абзацев в куске, когда заголовков нет вовсе. Компромисс: конвейеру нужны швы. */
const CHUNK_PARAGRAPHS = 90;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (HEADING_WORD.test(t)) return true;
  // Одинокая строка капсом: типичный заголовок в текстах с Гутенберга.
  return /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t) && t.length > 2;
}

export async function readPlain(
  file: File,
  format: 'txt' | 'md',
): Promise<ContentDoc> {
  const started = performance.now();
  const warnings: DocWarning[] = [];
  const source = await file.text();

  const chapters =
    format === 'md' ? await fromMarkdown(source, warnings) : fromPlainText(source);

  if (chapters.length === 0) throw new Error('The file has no readable text.');

  const stats = docStats(chapters);
  const toc: TocEntry[] = chapters.map((c, index) => ({
    id: `toc-${index}`,
    title: c.title,
    chapterId: c.id,
    depth: 0,
  }));

  return {
    id: `${format}-${Date.now().toString(36)}`,
    format,
    title: file.name.replace(/\.(txt|md|markdown)$/i, ''),
    author: 'Unknown',
    // Язык из голого текста не определить, а угадывать значит наврать с
    // переносами. Пользователь меняет его в инспекторе.
    language: 'en',
    chapters,
    toc,
    charCount: stats.charCount,
    imageCount: stats.imageCount,
    imageBytes: 0,
    sourceBytes: file.size,
    warnings,
    tookMs: performance.now() - started,
  };
}

function fromPlainText(source: string): Chapter[] {
  const blocks = source
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chapters: Chapter[] = [];
  let current: string[] = [];
  let title = '';
  let sawHeading = false;

  const flush = () => {
    if (current.length === 0) return;
    chapters.push({
      id: `chunk-${chapters.length}`,
      title: title || `Part ${chapters.length + 1}`,
      html: current.join(''),
    });
    current = [];
    title = '';
  };

  for (const block of blocks) {
    const singleLine = !block.includes('\n');

    if (singleLine && looksLikeHeading(block)) {
      sawHeading = true;
      flush();
      title = block.replace(/\s+/g, ' ');
      current.push(`<h1>${esc(title)}</h1>`);
      continue;
    }

    // Переносы внутри абзаца — артефакт исходной вёрстки, не смысл.
    current.push(`<p>${esc(block.replace(/\n/g, ' '))}</p>`);

    if (!sawHeading && current.length >= CHUNK_PARAGRAPHS) flush();
  }

  flush();
  return chapters;
}

async function fromMarkdown(source: string, warnings: DocWarning[]): Promise<Chapter[]> {
  const { marked } = await import('marked');
  const html = await marked.parse(source, { async: true, gfm: true });
  const body = parseHtml(html);

  /*
   * Картинки markdown ведут наружу — на сайт, где лежит файл. Внутрь страницы
   * их не затащить: SVG-картинка, в которую превращается страница, внешних
   * ресурсов не грузит (SPEC §6.4). Честнее выбросить и сказать, чем оставить
   * дыру в вёрстке.
   */
  const images = body.querySelectorAll('img').length;
  if (images > 0) {
    warnings.push({
      code: 'image-external',
      message: `${images} image${images === 1 ? '' : 's'} link outside the file and were dropped.`,
    });
  }

  const groups = splitByHeading(body);
  return groups.map((group, index) => ({
    id: `md-${index}`,
    title: extractTitle(group) ?? `Part ${index + 1}`,
    html: sanitize(group),
  }));
}

/**
 * Разрезать документ по заголовкам верхнего уровня.
 * Если h1 в тексте один или нет вовсе, пробуем h2 — иначе получится одна глава
 * на весь файл и конвейер лишится швов.
 */
function splitByHeading(body: HTMLElement): HTMLElement[] {
  const level = body.querySelectorAll('h1').length > 1 ? 'h1' : 'h2';
  const groups: HTMLElement[] = [];
  let current = document.createElement('div');

  for (const node of Array.from(body.children)) {
    if (node.localName === level && current.childNodes.length > 0) {
      groups.push(current);
      current = document.createElement('div');
    }
    current.appendChild(node.cloneNode(true));
  }
  if (current.childNodes.length > 0) groups.push(current);

  return groups;
}
