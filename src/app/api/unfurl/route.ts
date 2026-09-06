/**
 * `POST /api/unfurl` — единственный эндпоинт, который есть у r3ad на M4.
 *
 * Существует он ровно по одной причине: браузер не может забрать чужую
 * страницу — CORS не пустит, и не пустит правильно. Всё остальное, что делает
 * сайт, по-прежнему происходит в браузере (§15.1), и этот обработчик не
 * исключение из local-first, а его цена.
 *
 * Runtime не объявляем: node здесь и так по умолчанию, а edge в Next 16
 * помечен устаревшим (`node_modules/next/dist/docs/.../route-segment-config/runtime.md`).
 * Нам нужен именно node — SSRF-фильтр держится на `dns` и на подмене резолвера
 * соединения, чего в edge нет.
 */
import { clientKey, memoryCache, rateLimiter, UNFURL_QUOTA } from '@/server/limit';
import { NET_LIMITS, NetError } from '@/server/net';
import { unfurl } from '@/server/unfurl';
import type { WireClipping } from '@/core/clipping/types';

/** Восемь секунд на источник плюс запас на разбор — и всё ещё внутри Hobby. */
export const maxDuration = 15;

const cache = memoryCache<WireClipping>();

export async function POST(request: Request) {
  const quota = await rateLimiter.take(clientKey(request.headers));
  if (!quota.ok) {
    return fail('rate-limit', `More than ${UNFURL_QUOTA.limit} links an hour. Try later.`, 429, quota.resetAt);
  }

  let url: unknown;
  try {
    ({ url } = (await request.json()) as { url?: unknown });
  } catch {
    return fail('bad-body', 'Expected a JSON body with a url.', 400);
  }

  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) {
    return fail('bad-url', 'Expected a single link, at most 2048 characters.', 400);
  }

  const hit = cache.get(url);
  if (hit) return Response.json(hit, { headers: headers(quota.remaining, true) });

  try {
    const clipping = await unfurl(url);
    cache.set(url, clipping);
    return Response.json(clipping, { headers: headers(quota.remaining, false) });
  } catch (err) {
    if (err instanceof NetError) {
      /*
       * `paste` — не отказ, а развилка: интерфейс по этому коду открывает поле
       * ручной вставки. Поэтому и статус 422, а не 502: запрос был правильный,
       * просто этот источник нас не пустил.
       */
      return fail(err.code, err.message, err.code === 'paste' ? 422 : 502);
    }
    return fail('failed', err instanceof Error ? err.message : 'Could not unfurl that link.', 502);
  }
}

function headers(remaining: number, cached: boolean): HeadersInit {
  return {
    'x-ratelimit-remaining': String(remaining),
    // Кэш суточный (§10), но он наш, а не браузерный: вырезка приезжает по
    // POST, и повторный запрос браузер всё равно отправит.
    'cache-control': 'no-store',
    'x-r3ad-cache': cached ? 'hit' : 'miss',
    'x-r3ad-limit-bytes': String(NET_LIMITS.maxBytes),
  };
}

function fail(code: string, message: string, status: number, resetAt?: number) {
  return Response.json(
    { error: { code, message, resetAt } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}
