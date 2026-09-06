/**
 * `POST /api/assets/negotiate` — что из этого у вас уже есть, и куда класть остальное.
 *
 * Второй эндпоинт из пяти (§14) и единственный шаг шеринга, который вообще
 * можно назвать переговорами. Клиент присылает хэши всех ассетов снимка;
 * в ответ — какие из них незнакомы и билет на каждый незнакомый.
 *
 * Отсюда дедупликация: тот же скриншот во втором снапшоте не заливается второй
 * раз, потому что он уже лежит под тем же именем. И отсюда же — правило, из-за
 * которого эндпоинт устроен именно так: **сам файл сюда не идёт**. Тело функции
 * ограничено 4.5 МБ, ассет бывает до 10 (§15.1), поэтому наружу отдаются права,
 * а байты клиент кладёт сам и напрямую.
 */
import { assetKey, blobs } from '@/server/blob';
import { clientKey, uploadLimiter, UPLOAD_QUOTA } from '@/server/limit';
import { SHARE_LIMITS } from '@/server/share';

const HEX64 = /^[0-9a-f]{64}$/;

interface Claim {
  hash: string;
  bytes: number;
}

export async function POST(request: Request) {
  let assets: unknown;
  try {
    ({ assets } = (await request.json()) as { assets?: unknown });
  } catch {
    return fail('bad-body', 'Expected a JSON body with an assets array.', 400);
  }

  if (!Array.isArray(assets) || assets.length > SHARE_LIMITS.assets) {
    return fail('bad-assets', `Expected at most ${SHARE_LIMITS.assets} assets.`, 400);
  }

  const claims: Claim[] = [];
  for (const item of assets as Claim[]) {
    if (!item || !HEX64.test(String(item.hash))) {
      return fail('bad-asset', 'Every asset is named by its sha256.', 400);
    }
    if (!Number.isFinite(item.bytes) || item.bytes > SHARE_LIMITS.assetBytes) {
      return fail('asset-too-large', 'An asset is capped at 10 MB.', 413);
    }
    claims.push({ hash: item.hash, bytes: item.bytes });
  }

  const present = await blobs.present(claims.map((c) => c.hash));
  const missing = claims.filter((c) => !present.has(c.hash));

  /*
   * Лимит берётся ровно за то, что заливается. Спрашивать «а что у вас есть»
   * можно сколько угодно: этот вопрос ничего не стоит и ничего не занимает, а
   * счётчик за него превратил бы повторный шеринг той же полки в отказ.
   */
  const quota = await uploadLimiter.take(clientKey(request.headers));
  if (missing.length > 0 && !quota.ok) {
    return fail(
      'rate-limit',
      `More than ${UPLOAD_QUOTA.limit} uploads an hour. Try later.`,
      429,
      quota.resetAt,
    );
  }

  const uploads = await Promise.all(missing.map((c) => blobs.ticket(c.hash, c.bytes)));

  /*
   * Адреса отдаём на все ассеты, а не только на залитые сейчас. Публикующий
   * складывает их в конверт снимка (см. core/share/publish.ts): 302 из
   * `GET /api/share/:id` заголовков браузеру не покажет, и узнать, где лежит
   * картинка, читающему больше неоткуда.
   */
  const urls: Record<string, string> = {};
  for (const claim of claims) urls[claim.hash] = blobs.url(assetKey(claim.hash));

  return Response.json(
    { missing: missing.map((c) => c.hash), uploads, urls, store: blobs.name },
    { headers: { 'cache-control': 'no-store' } },
  );
}

function fail(code: string, message: string, status: number, resetAt?: number) {
  return Response.json(
    { error: code, message, resetAt },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}
