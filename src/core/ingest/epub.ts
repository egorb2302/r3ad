/**
 * Чтение EPUB 2 и 3.
 *
 * Формат по сути прост: zip, внутри него OPF со списком файлов и порядком
 * чтения, дальше XHTML-главы. Сложность вся в том, что спецификацию соблюдают
 * приблизительно, а книги при этом читаемые. Поэтому здесь везде выбран путь
 * «разобрать сколько получится и сказать, что не получилось»: пропало
 * оглавление — соберём из заголовков глав, не нашлась картинка — выкинем её и
 * прочитаем текст (SPEC §19, риск «зоопарк EPUB»).
 *
 * Ничего из этого не уходит на сервер: архив распаковывается в браузере, и на
 * Vercel нет ни функции, ни временного файла, через которые книга могла бы
 * пройти (SPEC §15.1).
 */
import { docStats, type Chapter, type ContentDoc, type DocWarning, type TocEntry } from '../content';
import { encodeImage } from '../normalize/images';
import {
  collectImageSrcs,
  extractTitle,
  parseHtml,
  sanitize,
  type ImageAsset,
} from '../normalize/sanitize';
import { Archive } from './archive';
import { basename, dirname, fragment, isExternal, joinPath, safeDecode, stripFragment } from './paths';

export type IngestProgress = (done: number, total: number) => void;

/** Сколько картинок готовы вшить в книгу целиком. Дальше читаем текстом. */
const IMAGE_BUDGET_BYTES = 24 * 1024 * 1024;

interface ManifestItem {
  id: string;
  path: string;
  mime: string;
  properties: string;
}

const XHTML = /xhtml|html/;

/** Расширения картинок — на случай, если media-type в манифесте не проставлен. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

function parseXml(source: string, what: string): Document {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${what} is not valid XML`);
  return doc;
}

/** Поиск по локальному имени: префиксы пространств имён в EPUB какие угодно. */
function tags(root: Element | Document, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', name));
}

const text = (el: Element | undefined | null) => el?.textContent?.trim() ?? '';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

function mimeFor(path: string, declared: string): string {
  if (declared && declared.startsWith('image/')) return declared;
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export async function readEpub(
  file: File,
  onProgress?: IngestProgress,
): Promise<ContentDoc> {
  const started = performance.now();
  const warnings: DocWarning[] = [];
  const warn = (code: string, message: string) => {
    // Битая книга умеет генерировать предупреждение на каждую страницу.
    if (warnings.length < 40) warnings.push({ code, message });
  };

  const { default: JSZip } = await import('jszip');

  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    // Сообщение jszip про «конец центральной директории» верное, но читателю
    // книги оно не говорит ничего.
    throw new Error('This file is not a readable EPUB — the archive could not be opened.');
  }
  const archive = new Archive(zip);

  if (archive.has('META-INF/encryption.xml')) {
    throw new Error('This EPUB is encrypted (DRM). r3ad cannot open protected files.');
  }

  const container = parseXml(await archive.text('META-INF/container.xml'), 'container.xml');
  const opfPath = tags(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('container.xml names no OPF — this is not a readable EPUB.');

  const opf = parseXml(await archive.text(opfPath), basename(opfPath));
  const opfDir = dirname(opfPath);

  // ─── Метаданные ────────────────────────────────────────────────────────
  const metadataEl = tags(opf, 'metadata')[0];
  const title = (metadataEl && text(tags(metadataEl, 'title')[0])) || file.name.replace(/\.epub$/i, '');
  const author = (metadataEl && text(tags(metadataEl, 'creator')[0])) || 'Unknown';
  const language = (metadataEl && text(tags(metadataEl, 'language')[0])) || 'en';

  // ─── Манифест и порядок чтения ─────────────────────────────────────────
  const manifestEl = tags(opf, 'manifest')[0];
  const spineEl = tags(opf, 'spine')[0];
  if (!manifestEl || !spineEl) throw new Error('The OPF has no manifest or spine.');

  const manifest = new Map<string, ManifestItem>();
  for (const item of tags(manifestEl, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href || isExternal(href)) continue;
    manifest.set(id, {
      id,
      path: joinPath(opfDir, href),
      mime: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    });
  }

  const spine: ManifestItem[] = [];
  for (const ref of tags(spineEl, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    // Пустой media-type встречается; считаем такой элемент документом.
    if (item && XHTML.test(item.mime || 'xhtml')) spine.push(item);
  }

  if (spine.length === 0) throw new Error('The spine lists no readable documents.');

  // ─── Оглавление ────────────────────────────────────────────────────────
  const tocRaw = await readToc(archive, manifest, spineEl, warn);

  /**
   * Первая метка оглавления, указывающая в этот файл, — заголовок его главы.
   *
   * Сопоставляем по приведённому пути, а не по буквальному. Оглавление и
   * манифест пишутся разными инструментами и расходятся ровно двумя способами:
   * регистром (архив собран на Windows) и процентами в ссылке. Обе книги при
   * этом читаются везде, кроме читалки, которая сравнивает строки как есть.
   */
  const labelByPath = new Map<string, string>();
  for (const entry of tocRaw) {
    const key = canonical(entry.href);
    if (!labelByPath.has(key)) labelByPath.set(key, entry.label);
  }

  // ─── Главы ─────────────────────────────────────────────────────────────
  const imageCache = new Map<string, LoadedImage | null>();
  let imageBytes = 0;
  let budgetSpent = false;

  const chapters: Chapter[] = [];

  for (let i = 0; i < spine.length; i++) {
    const item = spine[i];
    onProgress?.(i, spine.length);

    let raw: string;
    try {
      raw = await archive.text(item.path);
    } catch {
      warn('chapter-missing', `Spine item is not in the archive: ${item.path}`);
      continue;
    }

    const body = parseHtml(raw);
    const baseDir = dirname(item.path);

    // Картинки декодируются заранее: санитайзер синхронный, и ждать внутри
    // обхода дерева ему нечем.
    const resolved = new Map<string, ImageAsset>();
    for (const src of collectImageSrcs(body)) {
      if (resolved.has(src) || isExternal(src)) continue;
      const path = joinPath(baseDir, src);

      if (!imageCache.has(path)) {
        imageCache.set(path, await loadImage(archive, path, manifest, warn, () => budgetSpent));
        const loaded = imageCache.get(path);
        if (loaded) {
          imageBytes += loaded.bytesOnPage;
          if (imageBytes > IMAGE_BUDGET_BYTES && !budgetSpent) {
            budgetSpent = true;
            warn(
              'image-budget',
              `Images past ${(IMAGE_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB were dropped — the rest of the book is text only.`,
            );
          }
        }
      }

      const asset = imageCache.get(path);
      if (asset) resolved.set(src, asset);
    }

    const html = sanitize(body, {
      resolveImage: (src) => resolved.get(src),
      onWarning: warn,
    });

    // Пустая страница-разделитель в оглавлении не нужна и лист под неё тратить незачем.
    if (!html.replace(/<[^>]*>/g, '').trim() && !html.includes('<img')) continue;

    chapters.push({
      id: item.path,
      title:
        labelByPath.get(canonical(item.path)) ??
        extractTitle(body) ??
        `Section ${chapters.length + 1}`,
      html,
    });
  }

  onProgress?.(spine.length, spine.length);

  if (chapters.length === 0) throw new Error('Every chapter came out empty after sanitizing.');

  // ─── Оглавление под получившиеся главы ─────────────────────────────────
  const chapterByPath = new Map(chapters.map((c) => [canonical(c.id), c.id]));
  const toc: TocEntry[] = [];
  for (const entry of tocRaw) {
    const chapterId = chapterByPath.get(canonical(entry.href));
    if (!chapterId) continue;
    toc.push({ id: `toc-${toc.length}`, title: entry.label, chapterId, depth: entry.depth });
  }

  if (toc.length === 0) {
    warn('toc-missing', 'No usable table of contents — built one from chapter headings.');
    toc.push(
      ...chapters.map((c, index) => ({
        id: `toc-${index}`,
        title: c.title,
        chapterId: c.id,
        depth: 0,
      })),
    );
  }

  const stats = docStats(chapters);
  const cover = await readCover(archive, manifest, opf);

  return {
    id: `epub-${Date.now().toString(36)}`,
    format: 'epub',
    title,
    author,
    language,
    chapters,
    toc,
    cover,
    charCount: stats.charCount,
    imageCount: stats.imageCount,
    imageBytes,
    sourceBytes: file.size,
    warnings,
    tookMs: performance.now() - started,
  };
}

/** Сторона уменьшенной обложки. Она нужна только под цвет корешка, не под показ. */
const COVER_PX = 320;

/**
 * Обложка издания.
 *
 * Ищется тремя способами подряд, потому что за две версии формата их накопилось
 * ровно три: свойство `cover-image` в манифесте (EPUB 3), `<meta name="cover">`
 * со ссылкой на элемент манифеста (EPUB 2) и — если издатель не сделал ни того,
 * ни другого — первая картинка, у которой в имени есть слово cover. Последний
 * путь угадывает, поэтому идёт последним.
 *
 * Неудача здесь ничего не ломает: корешок тогда получит цвет по названию.
 */
async function readCover(
  archive: Archive,
  manifest: Map<string, ManifestItem>,
  opf: Document,
): Promise<string | undefined> {
  const items = [...manifest.values()];
  const isImage = (item: ManifestItem) => /^image\//.test(item.mime) || IMAGE_EXT.test(item.path);

  let item = items.find((i) => i.properties.split(/\s+/).includes('cover-image'));

  if (!item) {
    const meta = tags(opf, 'meta').find((m) => m.getAttribute('name') === 'cover');
    const id = meta?.getAttribute('content');
    const named = id ? manifest.get(id) : undefined;
    if (named && isImage(named)) item = named;
  }

  if (!item) item = items.find((i) => isImage(i) && /cover/i.test(i.path));
  if (!item) return undefined;

  const found = archive.find(item.path);
  if (!found) return undefined;

  try {
    const bytes = await found.entry.async('uint8array');
    const encoded = await encodeImage(bytes, mimeFor(item.path, item.mime), {
      maxPx: COVER_PX,
      // Пережимаем всегда: у обложки в архиве бывает и три мегабайта, а нужен
      // из неё один цвет.
      keepBytes: 0,
    });
    return encoded?.url;
  } catch {
    return undefined;
  }
}

interface LoadedImage extends ImageAsset {
  bytesOnPage: number;
}

async function loadImage(
  archive: Archive,
  path: string,
  manifest: Map<string, ManifestItem>,
  warn: (code: string, message: string) => void,
  spent: () => boolean,
): Promise<LoadedImage | null> {
  if (spent()) return null;

  const found = archive.find(path);
  if (!found) {
    warn('image-missing', `Image not in the archive: ${path}`);
    return null;
  }
  if (found.fuzzy) {
    warn('path-fuzzy', `Resolved ${path} by file name — the archive path did not match.`);
  }

  const declared = [...manifest.values()].find((item) => item.path === path)?.mime ?? '';
  const bytes = await found.entry.async('uint8array');
  const encoded = await encodeImage(bytes, mimeFor(path, declared));

  if (!encoded) {
    warn('image-unreadable', `Could not decode ${basename(path)} — dropped.`);
    return null;
  }

  return { ...encoded, bytesOnPage: encoded.bytes };
}

interface RawTocEntry {
  href: string;
  label: string;
  depth: number;
}

/**
 * Оглавление берём откуда получится: EPUB 3 держит его в XHTML-документе `nav`,
 * EPUB 2 — в отдельном NCX. Второй формат объявлен устаревшим, но именно он
 * лежит в большинстве книг, скачанных за последние пятнадцать лет.
 */
async function readToc(
  archive: Archive,
  manifest: Map<string, ManifestItem>,
  spineEl: Element,
  warn: (code: string, message: string) => void,
): Promise<RawTocEntry[]> {
  const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('nav'));
  if (nav) {
    try {
      return parseNavDoc(await archive.text(nav.path), dirname(nav.path));
    } catch (err) {
      warn('toc-nav', `EPUB 3 navigation document unreadable: ${String(err)}`);
    }
  }

  const ncxId = spineEl.getAttribute('toc');
  const ncx = ncxId ? manifest.get(ncxId) : [...manifest.values()].find((i) => i.mime.includes('ncx'));
  if (ncx) {
    try {
      return parseNcx(await archive.text(ncx.path), dirname(ncx.path));
    } catch (err) {
      warn('toc-ncx', `NCX unreadable: ${String(err)}`);
    }
  }

  return [];
}

function parseNavDoc(source: string, baseDir: string): RawTocEntry[] {
  const body = parseHtml(source);
  const nav =
    body.querySelector('nav[epub\\:type~="toc"]') ??
    body.querySelector('nav[role="doc-toc"]') ??
    body.querySelector('nav');
  if (!nav) throw new Error('no <nav> element');

  const out: RawTocEntry[] = [];

  const walk = (list: Element, depth: number) => {
    for (const li of Array.from(list.children)) {
      if (li.localName !== 'li') continue;
      const link = li.querySelector(':scope > a, :scope > span > a');
      const href = link?.getAttribute('href');
      const label = text(link);
      if (href && label && !isExternal(href)) {
        out.push({ href: joinPath(baseDir, href) + hashOf(href), label, depth });
      }
      const nested = li.querySelector(':scope > ol, :scope > ul');
      if (nested) walk(nested, depth + 1);
    }
  };

  const root = nav.querySelector('ol, ul');
  if (root) walk(root, 0);
  return out;
}

function parseNcx(source: string, baseDir: string): RawTocEntry[] {
  const doc = parseXml(source, 'toc.ncx');
  const map = tags(doc, 'navMap')[0];
  if (!map) throw new Error('no navMap');

  const out: RawTocEntry[] = [];

  const walk = (parent: Element, depth: number) => {
    for (const point of Array.from(parent.children)) {
      if (point.localName !== 'navPoint') continue;
      // Только прямые потомки: вложенные navPoint несут свои navLabel и content,
      // и поиск вглубь подставил бы в родителя заголовок первого ребёнка.
      const label = text(child(child(point, 'navLabel'), 'text'));
      const src = child(point, 'content')?.getAttribute('src');
      if (src && label && !isExternal(src)) {
        out.push({ href: joinPath(baseDir, src) + hashOf(src), label, depth });
      }
      walk(point, depth + 1);
    }
  };

  walk(map, 0);
  return out;
}

/** Путь в форме, пригодной для сравнения: без якоря, без процентов, без регистра. */
const canonical = (path: string) => safeDecode(stripFragment(path)).toLowerCase();

function child(parent: Element | null | undefined, name: string): Element | null {
  if (!parent) return null;
  for (const el of Array.from(parent.children)) {
    if (el.localName === name) return el;
  }
  return null;
}

/** Якорь сохраняем: по нему потом восстанавливается позиция внутри главы. */
const hashOf = (href: string) => (fragment(href) ? `#${fragment(href)}` : '');
