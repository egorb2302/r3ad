/**
 * Пост в X: автоматический разбор и разбор вставленного руками.
 *
 * Про порядок здесь спорить не о чем, он записан в §21.4: сперва пробуем
 * oEmbed, а не сработало — молча уходим в ручную вставку. Функции ходят с
 * датацентрового IP, и X такие блокирует агрессивнее домашних (§15.1), так что
 * ручной путь — не запасной выход, а основной: он обязан давать вырезку не
 * хуже автоматической.
 *
 * oEmbed отдаёт готовый `<blockquote>` для вставки на сайт — из него достаются
 * имя автора, его @handle, текст и дата. Медиа там нет вовсе, и это честнее,
 * чем вытаскивать картинки из приватного JSON синдикации, который завтра
 * закроют: скриншот поста человек кладёт рядом сам (§10).
 */
import { blocksFromText, tidy } from './blocks';
import { LIMITS, type ContentBlock } from './types';

const HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com', 'www.x.com', 'www.twitter.com']);

/** Ссылка на конкретный пост: /:handle/status/:id. Профиль постом не является. */
export function xStatus(url: string): { handle: string; id: string } | null {
  try {
    const parsed = new URL(url);
    if (!HOSTS.has(parsed.hostname.toLowerCase())) return null;

    const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/);
    return match ? { handle: match[1], id: match[2] } : null;
  } catch {
    return null;
  }
}

export interface OEmbed {
  html?: string;
  author_name?: string;
  author_url?: string;
}

interface EmbedNode {
  textContent: string | null;
  querySelectorAll(selector: string): ArrayLike<EmbedNode>;
}

export interface XPost {
  name: string;
  handle?: string;
  body: ContentBlock[];
  publishedAt?: number;
}

/**
 * Разбор ответа oEmbed.
 *
 * Разметку разбираем деревом, а не регулярками: внутри цитаты живут ссылки,
 * переносы `<br>` и хвост «— Имя (@handle) дата», и вырезать это выражением
 * означало бы ломаться на каждом посте со ссылкой в тексте.
 */
export function parseOEmbed(payload: OEmbed, root: EmbedNode): XPost | null {
  const quote = Array.from(root.querySelectorAll('blockquote'))[0];
  if (!quote) return null;

  const paragraphs = Array.from(quote.querySelectorAll('p'));
  const text = paragraphs.map((p) => tidy(p.textContent ?? '')).filter(Boolean).join('\n\n');

  /*
   * Хвост цитаты — та самая подпись, которую X дописывает к вставке. Дата в ней
   * единственная, поэтому берём её оттуда, а не из отдельного поля: в oEmbed
   * его нет.
   */
  const tail = tidy(quote.textContent ?? '').slice(-140);
  const dated = tail.match(/\)\s*([A-Z][a-z]+ \d{1,2}, \d{4})/);
  const stamp = dated ? Date.parse(dated[1]) : NaN;

  const handle =
    payload.author_url?.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/)?.[1] ??
    tail.match(/@([A-Za-z0-9_]{1,15})/)?.[1];

  if (!text && !payload.author_name) return null;

  return {
    name: payload.author_name?.trim() || (handle ? `@${handle}` : 'X'),
    handle,
    body: blocksFromText(text),
    publishedAt: Number.isNaN(stamp) ? undefined : stamp,
  };
}

/**
 * Разбор поста, скопированного со страницы X руками.
 *
 * Выделяя пост мышью, человек забирает вместе с текстом и шапку — имя, @handle,
 * «· 12h», — и хвост со счётчиками ответов и репостов. Всё это узнаваемо, и
 * узнать его здесь дешевле, чем просить человека вычистить текст самому:
 * ручная вставка обязана быть удобной сама по себе (§15.1).
 */
export function parsePastedPost(source: string): XPost & { rest: string } {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  /*
   * Ищем @handle среди первых непустых строк, а не разбираем шапку сверху вниз.
   * Порядок разбора снизу вверх важен: имя стоит перед хэндлом, и пока хэндл не
   * найден, отличить имя автора от первой строки текста нечем — обе просто
   * строки. Найденный хэндл делает шапку шапкой задним числом.
   */
  const head: number[] = [];
  for (let i = 0; i < lines.length && head.length < 5; i++) {
    if (lines[i].trim()) head.push(i);
  }

  let name = '';
  let handle: string | undefined;
  let publishedAt: number | undefined;
  let start = 0;

  for (const i of head) {
    const line = lines[i].trim();

    const inline = line.match(/^(.+?)\s*\(@([A-Za-z0-9_]{1,15})\)/);
    if (inline) {
      name = tidy(inline[1]);
      handle = inline[2];
      start = i + 1;
      break;
    }

    const alone = line.match(/^@([A-Za-z0-9_]{1,15})$/);
    if (alone) {
      handle = alone[1];
      // Имя — предыдущая непустая строка, если она похожа на имя, а не на абзац.
      const above = head[head.indexOf(i) - 1];
      const candidate = above !== undefined ? tidy(lines[above]) : '';
      if (candidate && candidate.length <= 60) name = candidate;
      start = i + 1;
      break;
    }
  }

  /* Отметка времени сразу под шапкой: «· 12h», «· Dec 3, 2024». */
  if (handle) {
    while (start < lines.length && !lines[start].trim()) start++;
    const stamp = lines[start]?.trim().match(/^·?\s*([A-Z][a-z]{2}\s+\d{1,2},?\s*\d{0,4}|\d{1,2}[hmd])$/);
    if (stamp) {
      const parsed = Date.parse(stamp[1]);
      if (!Number.isNaN(parsed)) publishedAt = parsed;
      start += 1;
    }
  }

  const rest = lines.slice(start).join('\n').replace(/\n{3,}/g, '\n\n');
  const body = blocksFromText(stripFooter(rest)).slice(0, LIMITS.blocks);

  return { name: name || (handle ? `@${handle}` : ''), handle, body, publishedAt, rest };
}

/** Счётчики под постом — «12 Reply Copy link», «1.2K 340 Likes». Это не текст. */
function stripFooter(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (
      !last ||
      /^[\d.,KM\s]+$/.test(last) ||
      /^(reply|repost|like|likes|views|share|copy link|read \d+)/i.test(last)
    ) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join('\n');
}
