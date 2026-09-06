/**
 * Vercel Blob: байты и реестр снапшотов в одном хранилище.
 *
 * Единственное Vercel-специфичное место в проекте (§15.1). Включается ключом
 * `BLOB_READ_WRITE_TOKEN`, который Vercel подставляет сам, когда стор привязан
 * к проекту; без ключа работают файловые реализации, и клиентский код не знает
 * разницы.
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

/** Идентификатор стора из ключа: `vercel_blob_rw_<store>_<secret>`. */
function storeIdOf(token: string): string {
  const [, , , storeId = ''] = token.split('_');
  if (!storeId) throw new Error('BLOB_READ_WRITE_TOKEN does not look like a Vercel Blob token');
  return storeId;
}

/* ─── Байты ─────────────────────────────────────────────────────────────── */

export function vercelStore(token: string): BlobStore {
  const storeId = storeIdOf(token);
  const publicUrl = (key: string) => `https://${storeId}.public.blob.vercel-storage.com/${key}`;

  const exists = async (key: string): Promise<boolean> => {
    try {
      await head(key, { token });
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
        token,
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
        token,
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
      await del(keys.map(publicUrl), { token });
    },

    async list(prefix) {
      const out: { key: string; updatedAt: number }[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ token, prefix, cursor, limit: 1000 });
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
export function blobMeta(token: string): MetaStore {
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
      const page = await list({ token, prefix, cursor, limit: 1000 });
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
    const result = await get(pathname, { token, access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return JSON.parse(await new Response(result.stream).text()) as SnapshotRecord;
  };

  const drop = async (paths: string[]) => {
    if (paths.length > 0) await del(paths, { token });
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
        token,
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

