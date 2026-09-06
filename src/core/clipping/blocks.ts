/**
 * Разметка источника → блоки вырезки.
 *
 * Работает с любым DOM: в браузере это документ из `DOMParser`, на сервере —
 * из linkedom. Поэтому здесь нет ни одного обращения к глобальному `document`,
 * а всё, что нужно, приходит корнем дерева. Обратная сторона — типы: linkedom
 * повторяет интерфейс, но не наследует классы lib.dom, поэтому дерево ходим по
 * `nodeType`, `localName` и `children`, без `instanceof`.
 *
 * Из всего разнообразия чужой вёрстки оставляем шесть видов блоков (types.ts).
 * Это не бедность, а граница: вырезка не воспроизводит страницу, она приводит
 * её к тому, что умеет напечатать бумага — абзац, заголовок, цитата, список,
 * код, картинка.
 */
import { LIMITS, type ContentBlock } from './types';

/** Теги, которые вырезаются вместе с содержимым: там служебное, а не текст. */
const SKIP = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'form',
  'nav', 'aside', 'footer', 'header', 'button', 'select', 'video', 'audio',
]);

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Схлопывание пробелов: чужая вёрстка полна переносов внутри предложения. */
export function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function clamp(text: string, max: number): string {
  const t = tidy(text);
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

interface Node {
  nodeType: number;
  nodeValue: string | null;
  localName?: string;
  textContent: string | null;
  childNodes: ArrayLike<Node>;
  getAttribute?(name: string): string | null;
}

const ELEMENT = 1;
const TEXT = 3;

const attr = (node: Node, name: string) => node.getAttribute?.(name) ?? null;

export interface CollectOptions {
  /**
   * Что сделать с найденной картинкой. Вернуть номер в `media` или null, если
   * картинку не берём: решение о загрузке байтов принимает вызывающий, у ядра
   * нет ни сети, ни права её трогать.
   */
  image?: (src: string, alt: string) => number | null;
}

/**
 * Собрать блоки из поддерева.
 *
 * Обход не рекурсивно-склеивающий: встретив абзац, берём его текст целиком и
 * внутрь не идём. Иначе вложенные `<span>` дали бы по блоку на каждый, а текст
 * абзаца развалился бы на куски посреди предложения.
 */
export function collectBlocks(root: Node, options: CollectOptions = {}): ContentBlock[] {
  const out: ContentBlock[] = [];
  walk(root, out, options, 0);
  return out.slice(0, LIMITS.blocks);
}

function walk(node: Node, out: ContentBlock[], options: CollectOptions, depth: number) {
  if (out.length >= LIMITS.blocks || depth > 32) return;

  for (const child of Array.from(node.childNodes)) {
    if (out.length >= LIMITS.blocks) return;

    if (child.nodeType === TEXT) {
      /*
       * Голый текст между блоками. Обычно это пробелы вёрстки, но у сайтов,
       * где абзацы разделены `<br>`, — единственное место, где текст лежит.
       */
      const text = tidy(child.nodeValue ?? '');
      if (text.length > 1) push(out, { type: 'para', text });
      continue;
    }
    if (child.nodeType !== ELEMENT) continue;

    const tag = (child.localName ?? '').toLowerCase();
    if (SKIP.has(tag)) continue;

    if (tag === 'img') {
      const src = attr(child, 'src') ?? attr(child, 'data-src');
      const index = src ? options.image?.(src, attr(child, 'alt') ?? '') ?? null : null;
      if (index !== null) push(out, { type: 'media', index });
      continue;
    }

    if (HEADINGS.has(tag)) {
      const text = tidy(child.textContent ?? '');
      if (text) push(out, { type: 'heading', text: clamp(text, LIMITS.title) });
      continue;
    }

    if (tag === 'blockquote') {
      const text = tidy(child.textContent ?? '');
      if (text) push(out, { type: 'quote', text: clamp(text, LIMITS.blockChars) });
      continue;
    }

    if (tag === 'pre' || tag === 'code') {
      // В коде пробелы значимы — здесь единственное место, где их не схлопываем.
      const text = (child.textContent ?? '').replace(/\s+$/, '');
      if (text.trim()) push(out, { type: 'code', text: text.slice(0, LIMITS.blockChars) });
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      const items: string[] = [];
      for (const li of Array.from(child.childNodes)) {
        if ((li.localName ?? '').toLowerCase() !== 'li') continue;
        const text = tidy(li.textContent ?? '');
        if (text) items.push(clamp(text, LIMITS.blockChars));
        if (items.length >= LIMITS.items) break;
      }
      if (items.length > 0) push(out, { type: 'list', ordered: tag === 'ol', items });
      continue;
    }

    if (tag === 'p' || tag === 'figcaption' || tag === 'dd') {
      const text = tidy(child.textContent ?? '');
      // Абзац с картинкой внутри и без текста — это картинка, а не абзац.
      if (!text) {
        walk(child, out, options, depth + 1);
        continue;
      }
      push(out, { type: 'para', text: clamp(text, LIMITS.blockChars) });
      continue;
    }

    walk(child, out, options, depth + 1);
  }
}

/**
 * Служебные надписи, которые остаются в тексте после чистки.
 *
 * «[edit]» у каждого заголовка в Википедии, «Advertisement» посреди статьи,
 * одинокая стрелка вместо кнопки. В исходной странице это элементы управления,
 * в вырезке — мусор посреди абзацев.
 */
const NOISE = /^(\[?\s*(edit|source|citation needed)\s*\]?|advertisement|share|↑|→|·)$/i;

/** Два одинаковых блока подряд — почти всегда след чужой вёрстки, а не повтор. */
function push(out: ContentBlock[], block: ContentBlock) {
  if ('text' in block && NOISE.test(block.text.trim())) return;

  const last = out[out.length - 1];
  if (last && last.type === block.type && 'text' in last && 'text' in block && last.text === block.text) {
    return;
  }
  out.push(block);
}

/** Текст, разбитый на абзацы по пустым строкам, — для вставки руками. */
export function blocksFromText(text: string): ContentBlock[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((part) => tidy(part))
    .filter(Boolean)
    .slice(0, LIMITS.blocks)
    .map((part) => ({ type: 'para', text: clamp(part, LIMITS.blockChars) }) as ContentBlock);
}
