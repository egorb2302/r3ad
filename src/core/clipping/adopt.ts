/**
 * Приём вырезки в браузере: с провода и с рук.
 *
 * Ассеты раскладываются здесь, а не на сервере, потому что хранилище — местное
 * (SPEC §9.4, адресация по sha256). Отсюда приятное следствие: одна и та же
 * картинка, приехавшая в трёх вырезках, ляжет в память один раз, и ровно так
 * же — если её же перед этим вставили скриншотом из буфера. Хранилище одно на
 * всё, и знать, откуда байты, ему незачем.
 */
import { putImage } from '../journal/assets';
import { id as makeId } from '../journal/ids';
import { blocksFromText } from './blocks';
import { sourceNameOf } from './meta';
import { parsePastedPost, xStatus } from './xpost';
import {
  LIMITS,
  type Clipping,
  type ClippingMedia,
  type ContentBlock,
  type WireClipping,
  type WireMedia,
} from './types';

/** Байты data-URI в хранилище: единственный способ узнать размеры — декодировать. */
async function store(media: WireMedia): Promise<ClippingMedia | null> {
  try {
    const blob = await fetch(media.dataUri).then((r) => r.blob());
    const asset = await putImage(blob);
    return { assetHash: asset.hash, alt: media.alt, width: asset.width, height: asset.height };
  } catch {
    return null;
  }
}

export async function adopt(wire: WireClipping): Promise<Clipping> {
  const stored = await Promise.all(wire.media.slice(0, LIMITS.media).map(store));
  const avatar = wire.author?.avatar ? await store(wire.author.avatar) : null;

  // Номера картинок в теле держатся на позициях в media — не доехавшую надо и
  // из тела убрать, а не оставить ссылкой в пустоту.
  const index = new Map<number, number>();
  const media: ClippingMedia[] = [];
  stored.forEach((item, i) => {
    if (!item) return;
    index.set(i, media.length);
    media.push(item);
  });

  const body: ContentBlock[] = [];
  for (const block of wire.body) {
    if (block.type !== 'media') {
      body.push(block);
      continue;
    }
    const moved = index.get(block.index);
    if (moved !== undefined) body.push({ type: 'media', index: moved });
  }

  return {
    id: makeId(),
    url: wire.url,
    adapter: wire.adapter,
    fetchedAt: wire.fetchedAt,
    title: wire.title,
    author: wire.author
      ? { name: wire.author.name, handle: wire.author.handle, avatarHash: avatar?.assetHash }
      : undefined,
    publishedAt: wire.publishedAt,
    body,
    media,
    attribution: wire.attribution,
  };
}

/**
 * Вырезка из текста, вставленного руками.
 *
 * Путь равноправный, а не аварийный (§10), поэтому и разбор здесь не
 * формальный: из вставленного поста вынимаются имя, @handle и дата — ровно то,
 * что человек скопировал вместе с текстом и вычищать не должен. Ссылка
 * необязательна, но если она есть и ведёт в X, атрибуция становится такой же,
 * как у автоматической вырезки.
 */
export function clippingFromPaste(text: string, url?: string): Clipping | null {
  const source = url?.trim() ? url.trim() : undefined;
  const post = source ? xStatus(source) : null;
  const parsed = post || /@[A-Za-z0-9_]{1,15}/.test(text.slice(0, 200)) ? parsePastedPost(text) : null;

  const body = parsed && parsed.body.length > 0 ? parsed.body : blocksFromText(text);
  if (body.length === 0) return null;

  const name = parsed?.name || undefined;
  const handle = parsed?.handle ?? post?.handle;

  return {
    id: makeId(),
    url: source ?? '',
    adapter: 'paste',
    fetchedAt: Date.now(),
    author: name || handle ? { name: name || `@${handle}`, handle } : undefined,
    publishedAt: parsed?.publishedAt,
    body,
    media: [],
    attribution: {
      sourceName: source ? sourceNameOf(source) : 'Pasted by hand',
      sourceUrl: source ?? '',
    },
  };
}

export interface UnfurlFailure {
  code: string;
  message: string;
}

/**
 * Запрос к эндпоинту.
 *
 * Ошибка возвращается значением, а не исключением: неудача здесь — обычный
 * исход, а не поломка. Код `paste` интерфейс читает как «открой поле вставки»,
 * и это не ветка обработки ошибок, а вторая половина сценария.
 */
export async function requestUnfurl(url: string): Promise<Clipping | UnfurlFailure> {
  let response: Response;
  try {
    response = await fetch('/api/unfurl', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    return { code: 'offline', message: 'The unfurl endpoint did not answer.' };
  }

  const payload = (await response.json().catch(() => null)) as
    | WireClipping
    | { error: UnfurlFailure }
    | null;

  if (!payload) return { code: 'failed', message: 'The endpoint answered with nothing.' };
  if ('error' in payload) return payload.error;
  return adopt(payload);
}

export function isFailure(value: Clipping | UnfurlFailure): value is UnfurlFailure {
  return 'code' in value;
}
