/**
 * Мета-теги страницы: OG, Twitter Card и то, что лежит рядом.
 *
 * Это самый нижний адаптер из §10 — тот, что срабатывает, когда не сработало
 * ничего другое. Ценность у него не в полноте, а в том, что он есть почти
 * всегда: страница без единого абзаца, доступного Readability, всё равно
 * объявляет заголовок и картинку — ради превью в мессенджерах.
 *
 * Порядок предпочтений везде один: OG → Twitter → собственные теги документа.
 * OG первым, потому что его ставят осознанно; `<title>` последним, потому что в
 * нём обычно ещё и имя сайта хвостом.
 */

interface MetaNode {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

interface MetaDoc {
  querySelector(selector: string): MetaNode | null;
  querySelectorAll(selector: string): ArrayLike<MetaNode>;
}

/** Значение первого попавшегося мета-тега из списка имён. */
export function meta(doc: MetaDoc, ...names: string[]): string | undefined {
  for (const name of names) {
    for (const node of Array.from(doc.querySelectorAll('meta'))) {
      const key = node.getAttribute('property') ?? node.getAttribute('name');
      if (key?.toLowerCase() !== name) continue;
      const value = node.getAttribute('content')?.trim();
      if (value) return value;
    }
  }
  return undefined;
}

export interface PageMeta {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  author?: string;
  publishedAt?: number;
  canonical?: string;
}

export function readMeta(doc: MetaDoc, url: string): PageMeta {
  const title =
    meta(doc, 'og:title', 'twitter:title') ??
    (doc.querySelector('title')?.textContent?.trim() || undefined);

  const published =
    meta(doc, 'article:published_time', 'og:article:published_time', 'date') ?? undefined;
  const stamp = published ? Date.parse(published) : NaN;

  return {
    title,
    description: meta(doc, 'og:description', 'twitter:description', 'description'),
    image: absolute(meta(doc, 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'), url),
    siteName: meta(doc, 'og:site_name', 'application-name'),
    author: meta(doc, 'article:author', 'author', 'twitter:creator'),
    publishedAt: Number.isNaN(stamp) ? undefined : stamp,
    canonical: absolute(
      doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? undefined,
      url,
    ),
  };
}

/** Адрес картинки часто относительный — без базы он никуда не ведёт. */
export function absolute(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

/**
 * Имя источника для атрибуции.
 *
 * Хост без `www.` — то, что человек и так прочтёт в адресной строке. Придумывать
 * красивое название нельзя: атрибуция обязана вести к оригиналу, а не к нашему
 * представлению о нём.
 */
export function sourceNameOf(url: string, declared?: string): string {
  if (declared) return declared;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
