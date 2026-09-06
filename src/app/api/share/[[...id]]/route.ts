/**
 * `/api/share` — создать снапшот, отдать его и снести.
 *
 * Третий, четвёртый и пятый эндпоинты из §14 живут в одном файле, потому что
 * это один ресурс с тремя глаголами; разносить их по каталогам значило бы
 * растащить `id` и `manageToken` по трём местам.
 *
 * `GET` отвечает **302 на адрес манифеста**, а не самим манифестом. Это не
 * стиль, а обязательное условие: ответ функции ограничен 4.5 МБ (§15.1), а
 * снапшот бывает до пятидесяти. Заодно тело едет с CDN, а не через вычисления.
 *
 * Ни один глагол не читает содержимое снапшота. Оно может быть зашифровано
 * клиентом, и сервер обязан уметь хранить то, чего не понимает.
 */
import { clientKey, publicLimiter, shareLimiter, SHARE_QUOTA } from '@/server/limit';
import {
  createSnapshot,
  deleteSnapshot,
  readSnapshot,
  ShareError,
  takeDown,
  type AssetClaim,
} from '@/server/share';
import type { SnapshotScope } from '@/server/meta';

type Context = { params: Promise<{ id?: string[] }> };

/** Манифест до двух мегабайт плюс проверка ассетов — с запасом внутри Hobby. */
export const maxDuration = 20;

const SCOPES: SnapshotScope[] = ['appearance', 'journal', 'volume'];

async function idOf(context: Context): Promise<string | null> {
  const segments = (await context.params).id;
  return segments && segments.length > 0 ? segments[0] : null;
}

/* ─── Создать или обновить ──────────────────────────────────────────────── */

export async function POST(request: Request, context: Context) {
  const quota = await shareLimiter.take(clientKey(request.headers));
  if (!quota.ok) {
    return fail('rate-limit', `More than ${SHARE_QUOTA.limit} snapshots a day. Try tomorrow.`, 429);
  }

  let body: {
    manifest?: unknown;
    scope?: unknown;
    encrypted?: unknown;
    title?: unknown;
    assets?: unknown;
    manageToken?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail('bad-body', 'Expected a JSON body.', 400);
  }

  if (body.manifest === undefined) return fail('no-manifest', 'There is no manifest in that.', 400);
  if (!SCOPES.includes(body.scope as SnapshotScope)) {
    return fail('bad-scope', 'Scope is one of appearance, journal, volume.', 400);
  }

  // `?id=` из §14 и `/api/share/:id` — одно и то же; принимаем оба, потому что
  // спецификация называет первый, а второй читается лучше.
  const fromPath = await idOf(context);
  const fromQuery = new URL(request.url).searchParams.get('id');

  try {
    const result = await createSnapshot({
      manifest: body.manifest,
      scope: body.scope as SnapshotScope,
      encrypted: body.encrypted === true,
      title: typeof body.title === 'string' ? body.title : '',
      assets: Array.isArray(body.assets) ? (body.assets as AssetClaim[]) : [],
      id: fromPath ?? fromQuery ?? undefined,
      manageToken: typeof body.manageToken === 'string' ? body.manageToken : undefined,
    });

    return Response.json(result, {
      status: result.version === 1 ? 201 : 200,
      headers: { 'cache-control': 'no-store', 'x-ratelimit-remaining': String(quota.remaining) },
    });
  } catch (err) {
    return reject(err);
  }
}

/* ─── Отдать ────────────────────────────────────────────────────────────── */

export async function GET(request: Request, context: Context) {
  const id = await idOf(context);
  if (!id) return fail('no-id', 'Which snapshot?', 400);

  /*
   * Предохранитель из §21.7. Ключ у лимитера один на весь сайт — это дневной
   * потолок отдачи, а не персональный лимит: расшаренная полка, залетевшая в
   * X, кончается счётом за трафик, а не чьим-то отдельным злоупотреблением.
   */
  const budget = await publicLimiter.take('public');
  if (!budget.ok) {
    return fail('over-budget', 'Snapshots are over their daily budget. Try tomorrow.', 429);
  }

  try {
    const { record, location } = await readSnapshot(id);

    return new Response(null, {
      status: 302,
      headers: {
        location,
        // Короткие метаданные заголовками (§14): их видно и без загрузки тела —
        // например, когда его не отдадут, потому что оно зашифровано.
        'x-r3ad-title': encodeURIComponent(record.title),
        'x-r3ad-scope': record.scope,
        'x-r3ad-version': String(record.version),
        'x-r3ad-encrypted': record.encrypted ? '1' : '0',
        'x-robots-tag': 'noindex, nofollow',
        'cache-control': 'private, max-age=30',
      },
    });
  } catch (err) {
    return reject(err);
  }
}

/* ─── Снести ────────────────────────────────────────────────────────────── */

export async function DELETE(request: Request, context: Context) {
  const id = await idOf(context);
  if (!id) return fail('no-id', 'Which snapshot?', 400);

  /*
   * Токен идёт заголовком, а не в адресе: адреса оседают в логах, в истории
   * браузера и в чужих реферерах, и право сносить снапшот там оставлять нечего.
   */
  const token =
    request.headers.get('x-r3ad-manage') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  /*
   * Снятие по жалобе (§18) — тот же глагол, другое право. Отдельного эндпоинта
   * ему не нужно: удаляется тот же ресурс, разница лишь в том, кто это делает и
   * что остаётся в реестре. Без объявленного секрета ветка не существует —
   * ровно как у уборки по расписанию.
   */
  const admin = process.env.R3AD_ADMIN_SECRET;
  if (admin && request.headers.get('x-r3ad-admin') === admin) {
    try {
      await takeDown(id, new URL(request.url).searchParams.get('reason') ?? 'reported');
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    } catch (err) {
      return reject(err);
    }
  }

  try {
    await deleteSnapshot(id, token ?? undefined);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return reject(err);
  }
}

/* ─── Ответы ────────────────────────────────────────────────────────────── */

function fail(code: string, message: string, status: number, detail?: unknown) {
  return Response.json(
    { error: code, message, detail },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function reject(err: unknown) {
  if (err instanceof ShareError) return fail(err.code, err.message, err.status, err.detail);
  return fail('failed', err instanceof Error ? err.message : 'Could not do that.', 500);
}
