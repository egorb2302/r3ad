/**
 * Скомпилированный том: досье из вырезок.
 *
 * Второй выход вырезки (§10). Первый — карточка на странице тетради, где её
 * обводят и комментируют; этот — книга, которую листают. Ради него всё и
 * затевалось: неделя собранных тредов и статей превращается не в папку
 * закладок, а в том, у которого есть корешок, толщина и оглавление.
 *
 * Ничего нового по дороге не изобретается: вырезки собираются в `ContentDoc` —
 * тот же промежуточный вид, в который приходит EPUB, — и дальше идут по тому же
 * конвейеру, что и книга с диска. Разбивка, растеризация и сцена про вырезки не
 * знают вовсе.
 *
 * Разметка собирается здесь, а не приезжает с сервера. Тело вырезки —
 * структурный список (types.ts), и обратно в HTML его превращаем мы, экранируя
 * каждую строку. Санитайзер на этом пути не нужен, потому что нечего
 * санитизировать: чужих тегов в вырезке не бывает.
 */
import { assetDataUrl, assetSize, imageSize } from '../journal/assets';
import { docStats, type Chapter, type ContentDoc, type TocEntry } from '../content';
import { dateOf } from './card';
import { bylineOf, type Clipping, type ContentBlock } from './types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Ширина иллюстрации в полосе. Больше — и картинка вытесняет текст со страницы. */
const IMAGE_MAX = 520;

export interface CompileOptions {
  id: string;
  title: string;
}

export async function compileClippings(
  clippings: Clipping[],
  options: CompileOptions,
): Promise<ContentDoc> {
  const started = performance.now();

  const chapters: Chapter[] = [contents(clippings)];
  for (const clipping of clippings) {
    chapters.push({
      id: `clip-${clipping.id}`,
      title: chapterTitle(clipping),
      html: await chapterHtml(clipping),
    });
  }

  const toc: TocEntry[] = chapters.map((chapter, index) => ({
    id: `toc-${index}`,
    title: chapter.title,
    chapterId: chapter.id,
    depth: 0,
  }));

  const stats = docStats(chapters);

  // Вес картинок считаем по хэшам: одна и та же иллюстрация в двух вырезках
  // лежит в хранилище один раз и весит один раз.
  const hashes = new Set<string>();
  for (const clipping of clippings) {
    for (const media of clipping.media) hashes.add(media.assetHash);
  }
  const imageBytes = [...hashes].reduce((sum, hash) => sum + assetSize(hash), 0);

  return {
    id: options.id,
    // Формат синтетический не в насмешку: у этого тома нет исходного файла,
    // он собран здесь же, как и демонстрационная книга.
    format: 'synthetic',
    title: options.title,
    author: authorLine(clippings),
    language: 'en',
    chapters,
    toc,
    charCount: stats.charCount,
    imageCount: stats.imageCount,
    imageBytes,
    sourceBytes: 0,
    warnings: [],
    tookMs: performance.now() - started,
  };
}

/**
 * Первая глава — список источников.
 *
 * Досье отличается от подшивки тем, что видно, из чего оно собрано. Тот же
 * список есть и в оглавлении, но там он без дат и адресов, а здесь — с ними,
 * и остаётся в томе, даже когда том уедет к другому человеку (M5).
 */
function contents(clippings: Clipping[]): Chapter {
  const items = clippings
    .map((clipping) => {
      const when = clipping.publishedAt ?? clipping.fetchedAt;
      return `<li>${esc(chapterTitle(clipping))} — ${esc(bylineOf(clipping))}, ${esc(dateOf(when))}<br>${esc(
        clipping.attribution.sourceUrl || clipping.attribution.sourceName,
      )}</li>`;
    })
    .join('');

  return {
    id: 'clip-sources',
    title: 'Sources',
    html: `<h1>Sources</h1><p>${clippings.length} clipping${
      clippings.length === 1 ? '' : 's'
    }, collected ${esc(dateOf(Date.now()))}.</p><ol>${items}</ol>`,
  };
}

function chapterTitle(clipping: Clipping): string {
  if (clipping.title) return clipping.title;

  const first = clipping.body.find((b) => b.type === 'para' || b.type === 'heading');
  const text = first && 'text' in first ? first.text : '';
  const short = text.length > 64 ? `${text.slice(0, 63).trimEnd()}…` : text;
  return short || bylineOf(clipping);
}

async function chapterHtml(clipping: Clipping): Promise<string> {
  const parts: string[] = [`<h1>${esc(chapterTitle(clipping))}</h1>`];

  /*
   * Подзаголовок с автором и датой — это и есть атрибуция в томе (§10). Она
   * здесь первой строкой, а не сноской в конце, потому что вырезка читается
   * как чужой текст, и знать чей — надо до чтения, а не после.
   */
  const when = clipping.publishedAt ?? clipping.fetchedAt;
  parts.push(`<p><em>${esc(bylineOf(clipping))} · ${esc(dateOf(when))}</em></p>`);

  for (const block of clipping.body) parts.push(await blockHtml(block, clipping));

  const url = clipping.attribution.sourceUrl;
  parts.push(
    `<p><em>${esc(clipping.attribution.sourceName)}${url ? ` · ${esc(url)}` : ''}</em></p>`,
  );
  return parts.join('');
}

async function blockHtml(block: ContentBlock, clipping: Clipping): Promise<string> {
  switch (block.type) {
    case 'para':
      return `<p>${esc(block.text)}</p>`;
    case 'heading':
      return `<h2>${esc(block.text)}</h2>`;
    case 'quote':
      return `<blockquote><p>${esc(block.text)}</p></blockquote>`;
    case 'code':
      return `<pre>${esc(block.text)}</pre>`;
    case 'list': {
      const items = block.items.map((item) => `<li>${esc(item)}</li>`).join('');
      return block.ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
    }
    case 'media': {
      const asset = clipping.media[block.index];
      if (!asset) return '';

      const url = await assetDataUrl(asset.assetHash);
      if (!url) return '';

      /*
       * Размеры проставляются явно: внутри SVG вёрстка считается заново, и
       * картинка без width/height занимает столько, сколько сочтёт нужным, —
       * то есть страница разъезжается относительно того, по чему её посчитали
       * (та же причина, что в normalize/sanitize).
       */
      const size = imageSize(asset.assetHash) ?? asset;
      const scale = Math.min(1, IMAGE_MAX / Math.max(1, size.width));
      const w = Math.round(size.width * scale);
      const h = Math.round(size.height * scale);
      return `<img src="${url}" width="${w}" height="${h}" alt="${esc(asset.alt ?? '')}">`;
    }
  }
}

/**
 * Автор досье — имена источников, а не человека.
 *
 * На корешке у такого тома стоит то, из чего он собран: «x.com · vitalik.eth»
 * говорит о содержимом больше, чем имя собравшего, — оно на полке и так одно.
 */
function authorLine(clippings: Clipping[]): string {
  const names = [...new Set(clippings.map((c) => c.attribution.sourceName))];
  if (names.length === 0) return 'Clippings';
  if (names.length <= 2) return names.join(' · ');
  return `${names[0]} · ${names[1]} +${names.length - 2}`;
}
