/**
 * Выложить снимок и забрать чужой.
 *
 * Три шага §11.3 со стороны браузера: спросить, чего у сервера нет, залить
 * недостающее **напрямую в блоб**, отправить манифест. Байты пользовательских
 * файлов через функции не идут ни при каком объёме — это не оптимизация, а
 * условие, при котором десятимегабайтный ассет вообще доезжает (§15.1).
 *
 * То, что уезжает, — не голый бандл, а вот такой конверт:
 *
 *     { title, scope, blobs: [...адреса ассетов], body: Bundle | Sealed }
 *
 * Заголовок снаружи, потому что 302 из `GET /api/share/:id` браузеру заголовков
 * не отдаёт: `fetch` пройдёт по редиректу и покажет заголовки конечного ответа,
 * а не промежуточного. Значит, всё, что нужно знать до расшифровки — как
 * называется снимок и запертый ли он, — обязано лежать открытым.
 *
 * `blobs` идут списком, параллельным `bundle.assets`. Порядок и есть
 * соответствие: у запертого снимка ассеты лежат шифротекстом и под именем
 * шифротекста, и связать их с настоящими хэшами внутри запертого бандла больше
 * ничем нельзя — не выкладывая наружу того, что мы как раз и прячем.
 *
 * **Цена замка — дедупликация.** Хранилище дедуплицирует потому, что одинаковое
 * содержимое имеет одинаковое имя; шифрование существует ровно затем, чтобы
 * одинаковое содержимое давало разные байты. Это не наша недоработка и не
 * чинится: у запертого снимка каждая заливка уникальна, и обновление версии
 * заливает ассеты заново.
 */
import { assetBlob, sha256 } from '../assets';
import type { Bundle, ShareScope } from './bundle';
import {
  isSealed,
  newLock,
  openLock,
  sealBytes,
  sealJson,
  unsealBytes,
  unsealJson,
  type Lock,
  type LockKind,
  type Sealed,
} from './lock';

export interface SnapshotPayload {
  format: 'r3ad';
  kind: 'snapshot';
  title: string;
  scope: ShareScope;
  /** Адреса ассетов в том же порядке, что и `bundle.assets`. */
  blobs: string[];
  body: Bundle | Sealed;
}

export interface PublishOptions {
  lock: LockKind;
  passphrase?: string;
  /** Обновление существующего снимка: тот же адрес, следующая версия. */
  id?: string;
  manageToken?: string;
  onStage?: (stage: string, done: number, total: number) => void;
}

export interface Published {
  id: string;
  version: number;
  /** Путь без домена. Домен подставляет тот, кто показывает ссылку. */
  path: string;
  manageToken?: string;
  /** Ключ для фрагмента, если снимок заперт ссылкой, а не фразой. */
  fragmentKey: string | null;
}

interface Ticket {
  hash: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

interface Negotiated {
  missing: string[];
  uploads: Ticket[];
  urls: Record<string, string>;
}

export async function publish(bundle: Bundle, options: PublishOptions): Promise<Published> {
  const stage = options.onStage ?? (() => undefined);
  const lock = options.lock === 'none' ? null : await newLock(options.passphrase);

  /*
   * Байты собираем до переговоров: у запертого снимка имя ассета — это хэш
   * шифротекста, и спрашивать про настоящие хэши было бы и бесполезно, и
   * болтливо.
   */
  stage('reading the assets', 0, bundle.assets.length);
  const payloads: { name: string; bytes: Uint8Array; mime: string }[] = [];

  for (const [index, asset] of bundle.assets.entries()) {
    const blob = assetBlob(asset.hash);
    if (!blob) throw new Error(`the bytes of ${asset.hash.slice(0, 8)} are no longer here`);

    const plain = new Uint8Array(await blob.arrayBuffer());
    const bytes = lock ? await sealBytes(lock, plain) : plain;
    payloads.push({
      name: lock ? await sha256(new Blob([bytes as BlobPart])) : asset.hash,
      bytes,
      mime: lock ? 'application/octet-stream' : asset.mime,
    });
    stage('reading the assets', index + 1, bundle.assets.length);
  }

  const negotiated = await negotiate(payloads.map((p) => ({ hash: p.name, bytes: p.bytes.length })));

  /*
   * Заливаем последовательно, а не пачкой. Ассетов немного, а параллельные
   * putы на десять мегабайт с домашнего аплинка соревнуются друг с другом и
   * делают прогресс нечитаемым — здесь он единственное, что видит человек.
   */
  const tickets = new Map(negotiated.uploads.map((t) => [t.hash, t]));
  let done = 0;
  for (const item of payloads) {
    const ticket = tickets.get(item.name);
    if (!ticket) continue;

    const response = await fetch(ticket.url, {
      method: ticket.method,
      headers: { 'content-type': item.mime, ...ticket.headers },
      body: item.bytes as BodyInit,
    });
    if (!response.ok) throw new Error(`an asset would not upload (${response.status})`);

    stage('uploading', ++done, tickets.size);
  }

  stage('publishing', 0, 1);
  const payload: SnapshotPayload = {
    format: 'r3ad',
    kind: 'snapshot',
    title: bundle.title,
    scope: bundle.scope,
    blobs: payloads.map((p) => negotiated.urls[p.name] ?? p.name),
    body: lock ? await sealJson(lock, bundle) : bundle,
  };

  const response = await fetch(options.id ? `/api/share/${options.id}` : '/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      manifest: payload,
      scope: bundle.scope,
      encrypted: lock !== null,
      title: bundle.title,
      assets: payloads.map((p) => ({ hash: p.name, bytes: p.bytes.length })),
      manageToken: options.manageToken,
    }),
  });

  const result = (await response.json()) as {
    id?: string;
    version?: number;
    url?: string;
    manageToken?: string;
    message?: string;
  };
  if (!response.ok || !result.id) throw new Error(result.message ?? 'the snapshot would not publish');

  stage('publishing', 1, 1);
  return {
    id: result.id,
    version: result.version ?? 1,
    path: result.url ?? `/s/${result.id}`,
    manageToken: result.manageToken,
    fragmentKey: lock?.fragmentKey ?? null,
  };
}

async function negotiate(assets: { hash: string; bytes: number }[]): Promise<Negotiated> {
  const response = await fetch('/api/assets/negotiate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assets }),
  });

  const result = (await response.json()) as Partial<Negotiated> & { message?: string };
  if (!response.ok) throw new Error(result.message ?? 'the assets would not negotiate');

  return {
    missing: result.missing ?? [],
    uploads: result.uploads ?? [],
    urls: result.urls ?? {},
  };
}

/* ─── Чтение чужого снимка ──────────────────────────────────────────────── */

export interface FetchedSnapshot {
  payload: SnapshotPayload;
  /** Заперт ли он и чем именно: ключом из ссылки или фразой. */
  locked: false | 'link' | 'passphrase';
}

export async function fetchSnapshot(id: string): Promise<FetchedSnapshot> {
  const response = await fetch(`/api/share/${encodeURIComponent(id)}`);
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(detail.message ?? `that snapshot is not here (${response.status})`);
  }

  const payload = (await response.json()) as SnapshotPayload;
  if (payload?.format !== 'r3ad' || payload.kind !== 'snapshot') {
    throw new Error('that is not a snapshot');
  }

  const locked = isSealed(payload.body)
    ? payload.body.salt
      ? ('passphrase' as const)
      : ('link' as const)
    : (false as const);

  return { payload, locked };
}

export interface OpenedSnapshot {
  bundle: Bundle;
  /** Байты по настоящему хэшу — их кладёт в хранилище тот, кто импортирует. */
  assets: Map<string, Blob>;
}

/**
 * Разобрать снимок: расшифровать, если заперт, и забрать байты.
 *
 * Ассеты качаются после манифеста, а не вместе с ним: пока их нет, полка уже
 * стоит и её видно. Не докачавшийся ассет роняет одну картинку, а не снимок —
 * страница с дырой лучше пустого экрана с ошибкой.
 */
export async function openSnapshot(
  fetched: FetchedSnapshot,
  secret?: string,
  onStage?: (stage: string, done: number, total: number) => void,
): Promise<OpenedSnapshot> {
  const stage = onStage ?? (() => undefined);

  let key: CryptoKey | null = null;
  let bundle: Bundle;

  if (isSealed(fetched.payload.body)) {
    if (!secret) throw new Error('this snapshot is locked');
    key = await openLock(fetched.payload.body, secret);
    try {
      bundle = (await unsealJson(key, fetched.payload.body)) as Bundle;
    } catch {
      throw new Error(fetched.locked === 'passphrase' ? 'wrong passphrase' : 'that key does not fit');
    }
  } else {
    bundle = fetched.payload.body as Bundle;
  }

  const assets = new Map<string, Blob>();
  const wanted = bundle.assets;

  for (const [index, asset] of wanted.entries()) {
    const url = fetched.payload.blobs[index];
    if (!url) continue;

    stage('fetching the assets', index, wanted.length);
    try {
      const response = await fetch(url);
      if (!response.ok) continue;

      const raw = new Uint8Array(await response.arrayBuffer());
      const plain = key ? await unsealBytes(key, raw) : raw;
      assets.set(asset.hash, new Blob([plain as BlobPart], { type: asset.mime }));
    } catch {
      /* см. док выше: одна картинка, а не весь снимок */
    }
  }
  stage('fetching the assets', wanted.length, wanted.length);

  return { bundle, assets };
}

export async function removeSnapshot(id: string, manageToken: string): Promise<void> {
  const response = await fetch(`/api/share/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-r3ad-manage': manageToken },
  });
  if (!response.ok && response.status !== 404) {
    const detail = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(detail.message ?? 'the snapshot would not go away');
  }
}

export type { Lock, LockKind, Sealed };
