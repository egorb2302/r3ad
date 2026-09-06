/**
 * Локальное блоб-хранилище: приём и отдача байтов.
 *
 * Этого маршрута нет в списке из пяти эндпоинтов (§14), и он его не нарушает —
 * это не часть API, а часть реализации `BlobStore`. На Vercel его роль играет
 * blob-хранилище: клиент кладёт байты по подписанному адресу туда, читает с
 * CDN, и маршрут отвечает 404, потому что его никто не спрашивает. Проверка
 * `localUploads` держит это правило исполняемым, а не записанным в комментарии.
 *
 * Клиентский код при этом один и тот же в обоих случаях: он PUT'ит по адресу из
 * билета и не знает, кто на том конце. В этом и был смысл §11.3, шага 4.
 */
import { assetKey, blobs, hashOf, localUploads } from '@/server/blob';
import { SHARE_LIMITS } from '@/server/share';
import { readTicket } from '@/server/tokens';

type Context = { params: Promise<{ key: string[] }> };

export const maxDuration = 30;

export async function GET(request: Request, { params }: Context) {
  if (!localUploads) return new Response('not here', { status: 404 });

  const key = (await params).key.join('/');
  const body = await blobs.read(key);
  if (!body) return new Response('no such blob', { status: 404 });

  return new Response(body as BodyInit, {
    headers: {
      'content-type': key.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'content-length': String(body.byteLength),
      /*
       * Ассет адресуется своим хэшом: содержимое по этому адресу не меняется
       * никогда, и год в кэше — не оптимизм, а свойство адресации.
       */
      'cache-control': key.endsWith('.json') ? 'public, max-age=60' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Принять байты по билету.
 *
 * Проверяется всё, что билет обещал: подпись, срок, размер и — главное — хэш.
 * Без последней проверки «адресация по содержимому» держалась бы на честности
 * заливающего, и по чужому хэшу можно было бы подложить что угодно.
 */
export async function PUT(request: Request, { params }: Context) {
  if (!localUploads) return new Response('not here', { status: 404 });

  const key = (await params).key.join('/');
  const token = new URL(request.url).searchParams.get('t') ?? '';
  const claims = readTicket(token);
  if (!claims) return new Response('bad or expired ticket', { status: 403 });
  if (key !== assetKey(claims.hash)) return new Response('ticket is for another asset', { status: 403 });

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > SHARE_LIMITS.assetBytes) {
    return new Response('an asset is capped at 10 MB', { status: 413 });
  }
  if (body.byteLength !== claims.bytes) {
    return new Response('that is not the size the ticket was issued for', { status: 400 });
  }
  if (hashOf(body) !== claims.hash) {
    return new Response('those bytes do not hash to that name', { status: 400 });
  }

  await blobs.put(key, body, 'application/octet-stream');
  return new Response(null, { status: 204 });
}
