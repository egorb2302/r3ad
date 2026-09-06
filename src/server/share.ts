/**
 * Снапшот: создать, обновить, отдать, снести, прибрать.
 *
 * Вся логика шеринга здесь; маршруты (§14) остаются переводчиками из HTTP и
 * обратно. Так же было устроено `unfurl.ts` на M4, и по той же причине: то, что
 * решает, живёт отдельно от того, что разбирает запрос.
 *
 * Три вещи, которые тут важнее остальных.
 *
 * **Снапшот иммутабелен, «обновить» — это новая версия под тем же `id`**
 * (§11.3). Ссылка, которую человек уже отправил, не должна менять содержимое у
 * него за спиной, но и плодить адреса на каждую правку незачем — поэтому
 * версия растёт, а адрес остаётся.
 *
 * **Манифест не принимается на слово.** Он называет ассеты, но ассеты кладёт
 * клиент, напрямую в блоб (§15.1) — и между «выдали билет» и «прислали
 * манифест» заливка могла не состояться. Снапшот, ссылающийся на байты,
 * которых нет, — это страница, у которой на месте картинки дыра, и узнаётся
 * это в момент открытия чужим человеком. Поэтому наличие проверяется здесь, а
 * не там.
 *
 * **Тело снапшота сервер не читает.** Оно может быть зашифровано клиентом
 * (§11.3), и код ниже с одинаковым безразличием кладёт в блоб и открытый
 * бандл, и конверт AES-GCM. Заголовок `encrypted` нужен публичной странице,
 * чтобы знать, спрашивать ли пароль, — а не нам.
 */
import { ASSET_PREFIX, blobs, snapshotKey } from './blob';
import { meta, SNAPSHOT_TTL_MS, type SnapshotRecord, type SnapshotScope } from './meta';
import { fingerprint, newManageToken, newSnapshotId, tokenMatches } from './tokens';

/** Потолки из §14. */
export const SHARE_LIMITS = {
  manifestBytes: 2 * 1024 * 1024,
  assetBytes: 10 * 1024 * 1024,
  totalBytes: 50 * 1024 * 1024,
  assets: 400,
  title: 120,
} as const;

export class ShareError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ShareError';
  }
}

export interface AssetClaim {
  hash: string;
  bytes: number;
}

export interface CreateInput {
  /** Тело снапшота как есть — открытый бандл или конверт. */
  manifest: unknown;
  scope: SnapshotScope;
  encrypted: boolean;
  title: string;
  assets: AssetClaim[];
  /** Для обновления: чей это снапшот. */
  id?: string;
  manageToken?: string;
}

export interface CreateResult {
  id: string;
  version: number;
  /** Отдаётся один раз — при создании. При обновлении токен уже у клиента. */
  manageToken?: string;
  url: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

export async function createSnapshot(input: CreateInput): Promise<CreateResult> {
  const body = new TextEncoder().encode(JSON.stringify(input.manifest));
  if (body.length > SHARE_LIMITS.manifestBytes) {
    throw new ShareError('manifest-too-large', 413, 'the manifest is over 2 MB');
  }

  const assets = normaliseAssets(input.assets);
  const total = assets.reduce((n, a) => n + a.bytes, 0);
  if (total > SHARE_LIMITS.totalBytes) {
    throw new ShareError('snapshot-too-large', 413, 'a snapshot is capped at 50 MB');
  }

  /*
   * Ассеты обязаны уже лежать. Проверка стоит один запрос к хранилищу и
   * закрывает единственный способ получить битый снапшот: заливка сорвалась, а
   * манифест доехал.
   */
  const present = await blobs.present(assets.map((a) => a.hash));
  const missing = assets.filter((a) => !present.has(a.hash)).map((a) => a.hash);
  if (missing.length > 0) {
    throw new ShareError('assets-missing', 409, 'some assets were never uploaded', { missing });
  }

  const now = Date.now();
  const existing = input.id ? await claim(input.id, input.manageToken) : null;

  const record: SnapshotRecord = {
    id: existing?.id ?? newSnapshotId(),
    version: existing ? existing.version + 1 : 1,
    scope: input.scope,
    encrypted: input.encrypted,
    key: '',
    title: (input.title || 'A shelf').slice(0, SHARE_LIMITS.title),
    assets: assets.map((a) => a.hash),
    bytes: total + body.length,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    expiresAt: now + SNAPSHOT_TTL_MS,
    owner: existing?.owner ?? '',
  };

  record.key = snapshotKey(record.id, record.version);
  await blobs.put(record.key, body, 'application/json');

  const manageToken = existing ? undefined : newManageToken();
  if (manageToken) record.owner = fingerprint(manageToken);

  await meta.put(record);

  return { id: record.id, version: record.version, manageToken, url: `/s/${record.id}` };
}

function normaliseAssets(claims: AssetClaim[]): AssetClaim[] {
  if (claims.length > SHARE_LIMITS.assets) {
    throw new ShareError('too-many-assets', 413, 'a snapshot carries at most 400 assets');
  }

  const seen = new Map<string, AssetClaim>();
  for (const claim of claims) {
    if (!HEX64.test(claim.hash)) {
      throw new ShareError('bad-asset', 400, 'an asset hash is not a sha256');
    }
    if (!Number.isFinite(claim.bytes) || claim.bytes < 0 || claim.bytes > SHARE_LIMITS.assetBytes) {
      throw new ShareError('asset-too-large', 413, 'an asset is capped at 10 MB');
    }
    // Один и тот же хэш дважды — это один ассет: дедупликация начинается здесь,
    // а не в хранилище (§11.3).
    seen.set(claim.hash, claim);
  }
  return [...seen.values()];
}

/** Снапшот, которым владеет предъявитель токена. */
async function claim(id: string, token?: string): Promise<SnapshotRecord> {
  const record = await meta.get(id);
  if (!record) throw new ShareError('not-found', 404, 'no such snapshot');
  if (!token || !tokenMatches(token, record.owner)) {
    throw new ShareError('not-yours', 403, 'that snapshot belongs to someone else');
  }
  return record;
}

export interface ReadResult {
  record: SnapshotRecord;
  /** Куда уводить: публичный адрес манифеста в блобе. */
  location: string;
}

/**
 * Открыть снапшот.
 *
 * Срок продлевается прямо здесь (§14): снимок, который смотрят, не должен
 * истекать. Запись при этом обновляется на каждое открытие, и для файловой
 * реализации это дороговато — но именно так работает продление в Turso одним
 * `UPDATE`, и разводить их поведение значило бы отлаживать не то, что поедет.
 */
export async function readSnapshot(id: string): Promise<ReadResult> {
  const record = await meta.get(id);
  if (!record) throw new ShareError('not-found', 404, 'no such snapshot');
  if (record.takenDown) {
    throw new ShareError('taken-down', 410, 'this snapshot was removed after a report');
  }

  const fresh = Date.now() + SNAPSHOT_TTL_MS;
  if (fresh - record.expiresAt > 24 * 60 * 60 * 1000) {
    await meta.put({ ...record, expiresAt: fresh });
  }

  return { record, location: blobs.url(record.key) };
}

export async function deleteSnapshot(id: string, token?: string): Promise<void> {
  const record = await claim(id, token);
  await meta.remove(id);
  await collect(record.assets, [snapshotKey(record.id, record.version)]);
}

/**
 * Уборка по расписанию (§14).
 *
 * Помечает протухшие, сносит их манифесты и удаляет байты, на которые больше
 * никто не ссылается. Осиротевшие считаются реестром, а не блобом: хранилище
 * байтов про снапшоты не знает.
 */
export async function purgeExpired(now = Date.now()): Promise<{ snapshots: number; assets: number }> {
  const stale = await meta.expired(now);

  const keys: string[] = [];
  const touched: string[] = [];

  for (const record of stale) {
    await meta.remove(record.id);
    keys.push(snapshotKey(record.id, record.version));
    touched.push(...record.assets);
  }

  /*
   * Заодно подметаем залитое впустую. Билет выдаётся до манифеста, и между
   * ними всё может кончиться: вкладку закрыли, снапшот не прошёл проверку,
   * человек передумал. Такой ассет не значится ни в одном снапшоте и потому
   * не всплывёт при удалении ни одного из них — а место занимает. Час отсрочки
   * — это заведомо больше, чем живёт билет (десять минут): недописанную прямо
   * сейчас заливку уборка не тронет.
   */
  const lingering = await blobs.list(ASSET_PREFIX);
  for (const entry of lingering) {
    if (now - entry.updatedAt < 60 * 60 * 1000) continue;
    touched.push(entry.key.slice(ASSET_PREFIX.length));
  }

  const assets = await collect(touched, keys);
  return { snapshots: stale.length, assets };
}

/** Снести названные ключи и те ассеты из списка, на которые больше нет ссылок. */
async function collect(candidates: string[], keys: string[]): Promise<number> {
  const orphans = await meta.orphans([...new Set(candidates)]);
  if (keys.length === 0 && orphans.length === 0) return 0;

  await blobs.remove([...keys, ...orphans.map((hash) => ASSET_PREFIX + hash)]);
  return orphans.length;
}

/**
 * Снять по жалобе (§18).
 *
 * Запись остаётся и помечается — она и есть тот самый лог удалений, которого
 * требует §18; удалить её значило бы потерять и причину, и дату. Байты уходят:
 * манифест сразу, ассеты — когда их перестанет держать кто-либо ещё.
 */
export async function takeDown(id: string, reason: string): Promise<void> {
  const record = await meta.get(id);
  if (!record) throw new ShareError('not-found', 404, 'no such snapshot');

  await meta.put({
    ...record,
    assets: [],
    takenDown: { at: Date.now(), reason: reason.slice(0, 400) },
  });
  await collect(record.assets, [record.key]);
}

export type { SnapshotRecord, SnapshotScope };
