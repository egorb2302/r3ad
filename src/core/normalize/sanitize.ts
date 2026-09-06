/**
 * Санитайзер входящего HTML.
 *
 * Через это горлышко проходит всё, что пришло извне: главы EPUB, разобранный
 * markdown, вырезки по ссылке. Работаем по белому списку — не «вырезаем плохое»,
 * а собираем новое дерево из разрешённого. Чёрный список рано или поздно
 * обходят; белый обходить нечем.
 *
 * Два соображения, специфичных именно для нашего конвейера:
 *
 * 1. Стили книги мы выбрасываем целиком — и class, и style. Дело не только в
 *    безопасности: страница верстается в колонку фиксированной ширины, и любое
 *    position/float/height из чужого CSS ломает подсчёт страниц. Оформление
 *    задаёт pageCss, один на всю книгу (SPEC §6.2, «не распарсили стили —
 *    показываем текст»).
 *
 * 2. Ссылок наружу не остаётся вообще. Картинка, у которой src не удалось
 *    разрешить в ресурс архива, выбрасывается: внутри SVG-картинки внешние
 *    адреса всё равно не грузятся (SPEC §6.4), так что уцелевший <img>
 *    обернулся бы дырой в вёрстке.
 */

/** Разрешённые теги. Значение — во что переписываем; null — оставляем как есть. */
const ALLOWED: Record<string, string | null> = {
  p: null, div: null, span: null, br: null, hr: null,
  h1: null, h2: null, h3: null, h4: null, h5: null, h6: null,
  em: null, i: null, strong: null, b: null, u: null, s: null,
  sub: null, sup: null, small: null, mark: null, del: null, ins: null,
  abbr: null, dfn: null, cite: null, q: null, blockquote: null,
  code: null, pre: null, kbd: null, samp: null, var: null, time: null,
  ul: null, ol: null, li: null, dl: null, dt: null, dd: null,
  table: null, thead: null, tbody: null, tfoot: null, tr: null,
  td: null, th: null, caption: null, colgroup: null, col: null,
  figure: null, figcaption: null, img: null,
  ruby: null, rt: null, rp: null, rb: null,
  address: null,
  // Секционные обёртки книге не нужны, но их id держат якоря оглавления.
  section: 'div', article: 'div', aside: 'div', header: 'div', footer: 'div', main: 'div',
  // Ссылка теряет переход, но остаётся текстом и якорем.
  a: 'span',
};

/** Теги, которые выбрасываются вместе с содержимым. */
const DROP = new Set([
  'script', 'style', 'link', 'meta', 'base', 'title', 'head', 'noscript', 'template',
  'iframe', 'object', 'embed', 'video', 'audio', 'canvas', 'map', 'area',
  'form', 'input', 'select', 'option', 'textarea', 'button', 'label', 'fieldset',
]);

const ATTRS: Record<string, string[]> = {
  img: ['src', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  ol: ['start'],
  li: ['value'],
};

export interface ImageAsset {
  /** data-URI. Другого формата растеризатор не примет. */
  url: string;
  width: number;
  height: number;
}

export interface SanitizeOptions {
  /**
   * Как превратить src из разметки в ресурс. Вернуть undefined — картинку
   * выкинуть. Синхронная: ресурсы декодируются заранее, одним проходом.
   */
  resolveImage?: (src: string) => ImageAsset | undefined;
  onWarning?: (code: string, message: string) => void;
}

/** Разобрать разметку в отдельный документ. Ничего не исполняется: DOMParser инертен. */
export function parseHtml(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body;
}

/**
 * Все адреса картинок в дереве — до санитайзинга, чтобы успеть их декодировать.
 * Включая svg > image: обложки EPUB часто приходят именно так.
 */
export function collectImageSrcs(root: Element): string[] {
  const out: string[] = [];
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (src) out.push(src);
  }
  for (const image of root.querySelectorAll('image')) {
    const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
    if (href) out.push(href);
  }
  return out;
}

export function sanitize(root: Element, options: SanitizeOptions = {}): string {
  const out = document.implementation.createHTMLDocument('');
  const target = out.createElement('div');
  walk(root, target, out, options, 0);
  return target.innerHTML;
}

/** Глубже этого разумная книга не вложена, а битая — вполне. Дальше просто разворачиваем. */
const MAX_DEPTH = 48;

function walk(
  source: Node,
  target: Element,
  out: Document,
  options: SanitizeOptions,
  depth: number,
) {
  for (const node of Array.from(source.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.appendChild(out.createTextNode(node.nodeValue ?? ''));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as Element;
    const tag = el.localName.toLowerCase();

    if (DROP.has(tag)) continue;

    // <svg><image href="cover.jpg"/></svg> — обложка, притворившаяся вектором.
    if (tag === 'svg') {
      const inner = el.querySelector('image');
      const href = inner?.getAttribute('href') ?? inner?.getAttribute('xlink:href');
      if (href) appendImage(target, out, href, el.getAttribute('alt') ?? '', options);
      continue;
    }

    if (tag === 'img') {
      const src = el.getAttribute('src');
      if (src) appendImage(target, out, src, el.getAttribute('alt') ?? '', options);
      continue;
    }

    const mapped = tag in ALLOWED ? (ALLOWED[tag] ?? tag) : null;

    // Неизвестный тег разворачиваем: содержимое ценнее обёртки.
    if (mapped === null || depth >= MAX_DEPTH) {
      walk(el, target, out, options, depth + 1);
      continue;
    }

    const clone = out.createElement(mapped);
    copyAttributes(el, clone, tag);
    target.appendChild(clone);
    walk(el, clone, out, options, depth + 1);
  }
}

function copyAttributes(source: Element, target: Element, tag: string) {
  // id переживает санитайзинг всегда: на него ссылается оглавление.
  const id = source.getAttribute('id');
  if (id) target.setAttribute('id', id);

  for (const name of ATTRS[tag] ?? []) {
    const value = source.getAttribute(name);
    if (value !== null) target.setAttribute(name, value);
  }
}

/**
 * Картинка попадает на страницу только вместе с собственными размерами.
 *
 * Внутри SVG вёрстка считается заново, и <img> без width/height занимает
 * столько, сколько сочтёт нужным: не успела декодироваться — ноль, и вся
 * колонка съезжает вверх относительно того, по чему посчитаны страницы.
 * Явные размеры делают бокс независимым от того, как прошло декодирование.
 */
function appendImage(
  target: Element,
  out: Document,
  src: string,
  alt: string,
  options: SanitizeOptions,
) {
  const asset = options.resolveImage?.(src);
  if (!asset) {
    options.onWarning?.('image-missing', `Image not found in the archive: ${src}`);
    return;
  }

  const img = out.createElement('img');
  img.setAttribute('src', asset.url);
  if (alt) img.setAttribute('alt', alt);
  if (asset.width > 0 && asset.height > 0) {
    img.setAttribute('width', String(asset.width));
    img.setAttribute('height', String(asset.height));
  }
  target.appendChild(img);
}

/** Первый заголовок в дереве — им подписываем главу, если оглавление молчит. */
export function extractTitle(root: Element): string | null {
  const heading = root.querySelector('h1, h2, h3, h4, h5, h6');
  const text = heading?.textContent?.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, 120) : null;
}
