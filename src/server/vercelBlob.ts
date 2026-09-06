/**
 * Vercel Blob: байты и реестр снапшотов в одном хранилище.
 *
 * Единственное Vercel-специфичное место в проекте (§15.1). Включается тем, что
 * Vercel подставляет при привязке стора: сегодня это `BLOB_STORE_ID` плюс OIDC
 * — функция получает короткоживущий `VERCEL_OIDC_TOKEN`, и SDK ходит с ним;
 * старый способ — один ключ `BLOB_READ_WRITE_TOKEN`. Оба поддержаны
 * (`blobCredentials`), без того и другого работают файловые реализации, и
 * клиентский код не знает разницы.
 *
 * Спека отводила реестру Turso, а лимитам Upstash. Первый деплой берёт минимум —
 * один Blob на всё, — и это осознанный размен: реестр на сотни снапшотов не
 * нуждается в SQL, а один сервис вместо трёх — это одна кнопка в панели Vercel
 * вместо трёх аккаунтов. Интерфейсы `BlobStore` и `MetaStore` от этого не
 * изменились, и Turso, если понадобится, встанет за тот же `MetaStore`.
 *
 * **Заливка идёт мимо функции** — правило из `blob.ts`, ради которого билет
 * вообще существует. У Vercel Blob для этого есть подписанные адреса: сервер
 * выписывает делегацию на один путь, один размер и десять минут, клиент
 * PUT'ит байты прямо в хранилище по адресу из билета. Единственное, чего
 * хранилище не проверит за нас, — что байты хэшируются в своё имя: файловая
 * реализация сверяла хэш при приёме, здесь принимает не она. Цена — залить
 * чушь под своим же хэшом может только сам заливающий, и испортит он этим
 * только свой снимок.
 */
import {
  BlobNotFoundError,
  del,
  get,
  head,
  issueSignedToken,
  list,
  presignUrl,
  put,
} from '@vercel/blob';
import type { BlobStore } from './blob';
import type { MetaStore, SnapshotRecord } from './meta';
import { assetKey, META_PREFIX } from './keys';
import { TICKET_TTL_MS } from './tokens';

/** Год: ассет и манифест адресуются содержимым, и меняться по адресу им нечему. */
const IMMUTABLE = 365 * 24 * 60 * 60;

/**
 * Версия API, которую клиент называет при заливке.
 *
 * Подписанный адрес самодостаточен, но SDK при заливке шлёт ещё и версию с
 * идентификатором стора, и мы шлём то же самое — чтобы наш PUT был неотличим
 * от PUT'а из `@vercel/blob/client`, с которым сервис точно знаком.
 * Значение — `BLOB_API_VERSION` установленного SDK; при обновлении пакета
 * сверить.
 */
const API_VERSION = '12';

/** Сколько запросов к API держим в воздухе одновременно. */
const PARALLEL = 16;

async function eachLimited<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (next < items.length) {
      const at = next++;
      out[at] = await work(items[at]);
    }
  });
  await Promise.all(lanes);
  return out;
}

/**
 * Как ходить в стор.
 *
 * Либо ключ (`token`), либо только идентификатор — тогда SDK сам возьмёт OIDC
 * из рантайма. Оба поля уходят в каждый вызов SDK как есть: с `token` он
 * пользуется ключом, без него — федерацией.
 */
export interface BlobCredentials {
  storeId: string;
  token?: string;
}

/**
 * Что дал Vercel. `null` — ничего: локальная разработка, файловые реализации.
 *
 * Ключ старого образца несёт идентификатор в себе: `vercel_blob_rw_<store>_<…>`.
 * Идентификатор из окружения бывает с префиксом `store_`, а в адресе блоба он
 * без префикса — SDK снимает его так же.
 */
export function blobCredentials(): BlobCredentials | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) {
    const [, , , storeId = ''] = token.split('_');
    if (!storeId) throw new Error('BLOB_READ_WRITE_TOKEN does not look like a Vercel Blob token');
    return { storeId, token };
  }
  const storeId = process.env.BLOB_STORE_ID?.trim();
  if (storeId) return { storeId: storeId.replace(/^store_/, '') };
  return null;
}

/* ─── Байты ─────────────────────────────────────────────────────────────── */

export function vercelStore(auth: BlobCredentials): BlobStore {
  const { storeId } = auth;
  const publicUrl = (key: string) => `https://${storeId}.public.blob.vercel-storage.com/${key}`;

  const exists = async (key: string): Promise<boolean> => {
    try {
      await head(key, auth);
      return true;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      throw error;
    }
  };

  return {
    name: 'vercel-blob',

    async present(hashes) {
      const found = new Set<string>();
      const flags = await eachLimited(hashes, (hash) => exists(assetKey(hash)));
      hashes.forEach((hash, i) => flags[i] && found.add(hash));
      return found;
    },

    async ticket(hash, bytes) {
      const pathname = assetKey(hash);
      const expiresAt = Date.now() + TICKET_TTL_MS;

      /*
       * Делегация — на один путь и не больше заявленного размера. Нулевой
       * размер у ассета не бывает, но `maximumSizeInBytes: 0` сервис прочёл бы
       * как «без ограничения», поэтому нижняя граница — байт.
       */
      const signed = await issueSignedToken({
        ...auth,
        pathname,
        operations: ['put'],
        validUntil: expiresAt,
        maximumSizeInBytes: Math.max(1, bytes),
      });
      const { presignedUrl } = await presignUrl(signed, {
        operation: 'put',
        pathname,
        access: 'public',
        addRandomSuffix: false,
        // Тот же хэш — те же байты: повторная заливка безвредна, а отказ на
        // ней ломал бы клиенту второй шеринг той же полки.
        allowOverwrite: true,
        cacheControlMaxAge: IMMUTABLE,
      });

      return {
        hash,
        url: presignedUrl,
        method: 'PUT',
        headers: {
          'x-api-version': API_VERSION,
          'x-vercel-blob-store-id': storeId,
          'x-vercel-blob-access': 'public',
        },
        expiresAt,
      };
    },

    async put(key, body, mime) {
      // SDK принимает Buffer, а не Uint8Array; копия — те же байты.
      await put(key, Buffer.from(body), {
        ...auth,
        access: 'public',
        contentType: mime,
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: IMMUTABLE,
      });
    },

    url: publicUrl,

    async read(key) {
      const response = await fetch(publicUrl(key));
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    },

    async remove(keys) {
      if (keys.length === 0) return;
      await del(keys.map(publicUrl), auth);
    },

    async list(prefix) {
      const out: { key: string; updatedAt: number }[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ ...auth, prefix, cursor, limit: 1000 });
        for (const blob of page.blobs) {
          out.push({ key: blob.pathname, updatedAt: blob.uploadedAt.getTime() });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out;
    },
  };
}

/* ─── Реестр ────────────────────────────────────────────────────────────── */

/**
 * Реестр поверх того же блоба.
 *
 * Запись снапшота — приватный JSON под `meta/<id>/<время>.<срок>.json`.
 * Три решения, без которых это не работало бы:
 *
 * — **Запись не перезаписывается, а кладётся рядом, новым именем.** У блоба
 *   есть CDN с кэшем от минуты, и «обновить файл на месте» значило бы минуту
 *   читать старое. Новое имя — новый адрес, кэшу нечего помнить. Прошлые
 *   записи того же снапшота убираются после того, как легла новая.
 *
 * — **Актуальная — последняя по имени.** Имя начинается со времени записи,
 *   дополненного нулями до одной длины, и список по префиксу отдаёт его в
 *   порядке строк. Читать содержимое, чтобы узнать, какая из записей свежее,
 *   не нужно.
 *
 * — **Срок — в имени.** Уборка по расписанию (§14) спрашивает «у кого вышел
 *   срок» про все снапшоты разом, и открывать для этого каждую запись значило
 *   бы по запросу на снимок каждую ночь. Со сроком в имени она открывает
 *   только те, что пора убирать.
 *
 * Пересчёт ссылок на ассеты (`orphans`) записи открывает — все. Это цена
 * реестра без запросов, и она оплачивается только при удалении и уборке.
 */
export function blobMeta(auth: BlobCredentials): MetaStore {
  const folder = (id: string) => `${META_PREFIX}${id}/`;
  const nameOf = (id: string, expiresAt: number) =>
    `${folder(id)}${String(Date.now()).padStart(14, '0')}.${expiresAt}.json`;

  interface Entry {
    pathname: string;
    expiresAt: number;
  }

  /** Записи по префиксу, последняя — актуальная. */
  const entries = async (prefix: string): Promise<Entry[]> => {
    const out: Entry[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ ...auth, prefix, cursor, limit: 1000 });
      for (const blob of page.blobs) {
        const match = /\/\d+\.(\d+)\.json$/.exec(blob.pathname);
        if (match) out.push({ pathname: blob.pathname, expiresAt: Number(match[1]) });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out.sort((a, b) => (a.pathname < b.pathname ? -1 : 1));
  };

  /** Актуальная запись каждого снапшота под префиксом. */
  const latest = async (prefix: string): Promise<Map<string, Entry>> => {
    const byId = new Map<string, Entry>();
    for (const entry of await entries(prefix)) {
      const id = entry.pathname.slice(META_PREFIX.length, entry.pathname.lastIndexOf('/'));
      byId.set(id, entry); // отсортировано по имени: последняя перекрывает прошлые
    }
    return byId;
  };

  const open = async (pathname: string): Promise<SnapshotRecord | null> => {
    const result = await get(pathname, { ...auth, access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return JSON.parse(await new Response(result.stream).text()) as SnapshotRecord;
  };

  const drop = async (paths: string[]) => {
    if (paths.length > 0) await del(paths, auth);
  };

  return {
    name: 'vercel-blob',

    async get(id) {
      const known = await entries(folder(id));
      const current = known.at(-1);
      return current ? open(current.pathname) : null;
    },

    async put(record) {
      const before = await entries(folder(record.id));
      await put(nameOf(record.id, record.expiresAt), JSON.stringify(record), {
        ...auth,
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      });
      await drop(before.map((entry) => entry.pathname));
    },

    async remove(id) {
      await drop((await entries(folder(id))).map((entry) => entry.pathname));
    },

    async expired(now) {
      const stale = [...(await latest(META_PREFIX)).values()].filter((e) => e.expiresAt <= now);
      const records = await eachLimited(stale, (entry) => open(entry.pathname));
      return records.filter((record): record is SnapshotRecord => record !== null);
    },

    async orphans(candidates) {
      if (candidates.length === 0) return [];
      const current = [...(await latest(META_PREFIX)).values()];
      const records = await eachLimited(current, (entry) => open(entry.pathname));

      const referenced = new Set<string>();
      for (const record of records) {
        for (const hash of record?.assets ?? []) referenced.add(hash);
      }
      return candidates.filter((hash) => !referenced.has(hash));
    },
  };
}

