/**
 * Разворот ссылки: выбор адаптера и всё, что требует сети.
 *
 * Здесь, а не в `core/clipping`, потому что здесь единственное место, где есть
 * DOM linkedom, Readability и сокет наружу. Ядро остаётся тем, чем должно:
 * нормализацией уже добытого. Граница проходит ровно по этому — из ядра сюда
 * приходят чистые функции, отсюда в ядро не уходит ничего.
 *
 * Порядок адаптеров из §10 — от самого знающего к самому неприхотливому:
 * пост X → статья → карточка OG → картинка. Ни один не «падает»: не сработал —
 * пробуем следующий, и в худшем случае вырезка состоит из заголовка и адреса.
 * Полностью не срабатывает только сеть, и тогда наверх уходит приглашение
 * вставить текст руками — равноправный путь, а не аварийный (§15.1).
 */
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { clamp, collectBlocks, tidy } from '@/core/clipping/blocks';
import { absolute, readMeta, sourceNameOf } from '@/core/clipping/meta';
import { LIMITS, type ContentBlock, type WireClipping, type WireMedia } from '@/core/clipping/types';
import { parseOEmbed, xStatus } from '@/core/clipping/xpost';
import { NET_LIMITS, NetError, parseTarget, safeFetch } from './net';

/** Столько текста должно найтись, чтобы считать страницу статьёй, а не карточкой. */
const ARTICLE_CHARS = 600;

export async function unfurl(input: string): Promise<WireClipping> {
  const target = parseTarget(input);
  const post = xStatus(target.toString());
  if (post) return unfurlPost(target.toString(), post.handle);

  const page = await safeFetch(target.toString(), {
    accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
  });

  if (page.contentType.startsWith('image/')) return unfurlImage(page.url, page.body, page.contentType);
  return unfurlPage(page.url, page.body.toString('utf8'));
}

/**
 * Пост X через oEmbed.
 *
 * Единственный публичный вход, не требующий ключа. Отдаёт готовую цитату для
 * вставки — то есть текст, имя и дату; медиа в ней нет по устройству формата.
 * Не ответил — значит, наш адрес не пустили, и это ожидаемый исход (§15.1), а
 * не поломка: ошибка с кодом `paste` говорит интерфейсу открыть поле вставки.
 */
async function unfurlPost(url: string, handle: string): Promise<WireClipping> {
  const endpoint = `https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(url)}`;

  let payload: { html?: string; author_name?: string; author_url?: string };
  try {
    const response = await safeFetch(endpoint, { accept: 'application/json' });
    payload = JSON.parse(response.body.toString('utf8'));
  } catch {
    throw new NetError(
      'paste',
      'X did not answer this server. Paste the post text instead — the clipping keeps its author and date.',
    );
  }

  const { document } = parseHTML(fragment(payload.html ?? ''));
  const parsed = parseOEmbed(payload, document.body);
  if (!parsed) {
    throw new NetError('paste', 'Nothing came back from X. Paste the post text instead.');
  }

  return {
    url,
    adapter: 'x-post',
    fetchedAt: Date.now(),
    author: { name: parsed.name, handle: parsed.handle ?? handle },
    publishedAt: parsed.publishedAt,
    body: parsed.body,
    media: [],
    attribution: { sourceName: 'X', sourceUrl: url },
  };
}

function unfurlImage(url: string, body: Buffer, contentType: string): WireClipping {
  if (body.length > NET_LIMITS.maxImageBytes) {
    throw new NetError('too-large', 'That image is larger than 1.5 MB.');
  }

  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'image');
  return {
    url,
    adapter: 'image',
    fetchedAt: Date.now(),
    title: clamp(name, LIMITS.title),
    body: [{ type: 'media', index: 0 }],
    media: [{ dataUri: dataUri(body, contentType), alt: name }],
    attribution: { sourceName: sourceNameOf(url), sourceUrl: url },
  };
}

async function unfurlPage(url: string, html: string): Promise<WireClipping> {
  const { document } = parseHTML(html);

  /*
   * Мета-теги читаются до Readability: тот перестраивает документ на месте,
   * выбрасывая всё, что счёл обвязкой, — вместе с <head>.
   */
  const info = readMeta(document as unknown as Parameters<typeof readMeta>[0], url);
  const canonical = info.canonical ?? url;

  const sources: string[] = [];
  const image = (src: string, alt: string) => {
    const resolved = absolute(src, url);
    if (!resolved || sources.length >= LIMITS.media) return null;
    // Иконки, спейсеры и трекинговые пиксели: по адресу видно, что это не
    // иллюстрация, и качать их незачем.
    if (/sprite|icon|avatar|logo|pixel|1x1|blank/i.test(resolved)) return null;
    sources.push(resolved);
    void alt;
    return sources.length - 1;
  };

  let body: ContentBlock[] = [];
  let title = info.title;
  let author = info.author;
  let adapter: WireClipping['adapter'] = 'og-card';

  try {
    const article = new Readability(document as never, { charThreshold: ARTICLE_CHARS }).parse();
    if (article && (article.textContent ?? '').trim().length >= ARTICLE_CHARS) {
      const { document: content } = parseHTML(fragment(article.content ?? ''));
      body = collectBlocks(content.body as never, { image });
      title = article.title?.trim() || title;
      author = article.byline?.trim() || author;
      adapter = 'article';
    }
  } catch {
    // Readability спотыкается о свою же эвристику на страницах без единого
    // абзаца. Это не ошибка запроса — просто эта страница не статья.
  }

  if (body.length === 0) {
    const card = info.description ? tidy(info.description) : '';
    body = card ? [{ type: 'para', text: clamp(card, LIMITS.blockChars) }] : [];
    if (info.image) {
      const index = image(info.image, title ?? '');
      if (index !== null) body.push({ type: 'media', index });
    }
  }

  if (body.length === 0) {
    /*
     * Ни статьи, ни описания — страница, которую не готовили к пересказу.
     * Берём первые абзацы как есть: пустая карточка с одним заголовком не
     * стоит того, чтобы её класть в конспект. Разметку разбираем заново,
     * потому что Readability перестроил документ на месте; путь редкий, и
     * платить за второй разбор всегда незачем.
     */
    const { document: raw } = parseHTML(html);
    body = collectBlocks(raw.body as never, { image }).slice(0, 12);
  }

  const media = await downloadMedia(sources);
  const clipping: WireClipping = {
    url: canonical,
    adapter,
    fetchedAt: Date.now(),
    title: title ? clamp(title, LIMITS.title) : undefined,
    author: author ? { name: clamp(author.replace(/^by\s+/i, ''), 80) } : undefined,
    publishedAt: info.publishedAt,
    body: remap(body, media),
    media: media.filter((m): m is WireMedia => m !== null),
    attribution: { sourceName: sourceNameOf(canonical, info.siteName), sourceUrl: canonical },
  };

  if (clipping.body.length === 0 && !clipping.title) {
    throw new NetError('empty', 'Nothing readable came back from that link.');
  }
  return clipping;
}

/**
 * Картинки качаются после разбора, скопом и параллельно.
 *
 * Не сработавшая картинка не отменяет вырезку: текст ценнее иллюстрации, а
 * половина адресов в чужой вёрстке ведёт в CDN, который нас не ждёт.
 */
async function downloadMedia(sources: string[]): Promise<(WireMedia | null)[]> {
  return Promise.all(
    sources.slice(0, LIMITS.media).map(async (src) => {
      try {
        const response = await safeFetch(src, {
          accept: 'image/*',
          maxBytes: NET_LIMITS.maxImageBytes,
          timeoutMs: 5_000,
        });
        if (!response.contentType.startsWith('image/')) return null;
        return { dataUri: dataUri(response.body, response.contentType) };
      } catch {
        return null;
      }
    }),
  );
}

/** Убрать ссылки на не доехавшие картинки и сдвинуть номера уцелевших. */
function remap(body: ContentBlock[], media: (WireMedia | null)[]): ContentBlock[] {
  const index = new Map<number, number>();
  let next = 0;
  media.forEach((item, i) => {
    if (item) index.set(i, next++);
  });

  const out: ContentBlock[] = [];
  for (const block of body) {
    if (block.type !== 'media') {
      out.push(block);
      continue;
    }
    const moved = index.get(block.index);
    if (moved !== undefined) out.push({ type: 'media', index: moved });
  }
  return out;
}

/**
 * Обёртка для куска разметки.
 *
 * linkedom разбирает только целый документ: фрагмент без `<html>` и `<body>`
 * он принимает молча и отдаёт пустое тело. Проверено на статье, где
 * Readability вернула двадцать килобайт содержимого, а обход не нашёл в нём ни
 * одного узла.
 */
function fragment(html: string): string {
  return `<!doctype html><html><body>${html}</body></html>`;
}

function dataUri(body: Buffer, contentType: string): string {
  const mime = contentType.split(';')[0].trim() || 'image/jpeg';
  return `data:${mime};base64,${body.toString('base64')}`;
}
