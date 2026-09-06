/**
 * Хранилище байтов на той стороне.
 *
 * Одно из трёх мест, которые §15.1 объявляет платформо-зависимыми. Интерфейс
 * здесь, реализация — та, что нашлась по переменным окружения.
 *
 * Главное правило, которое нельзя «починить» рефакторингом: **байты
 * пользовательских файлов не проходят через функцию**. Тело запроса и ответа
 * serverless-функции ограничено 4.5 МБ, а ассет бывает до 10 (§14), и
 * проксирование упирается в это не иногда, а всегда. Поэтому в интерфейсе нет
 * метода «залей файл» — есть `ticket`, который выдаёт клиенту право положить
 * байты самому.
 *
 * Локальная реализация складывает файлы на диск и принимает их своим же
 * маршрутом. Это не нарушение правила, а его частный случай: клиент по-прежнему
 * кладёт байты по адресу, который ему выдали, и не знает, кто на том конце.
 * Разница только в том, что в разработке тот конец — это мы, и лимита в 4.5 МБ
 * там нет. С ключом Vercel Blob в окружении `ticket` возвращает подписанный
 * адрес blob-хранилища (см. vercelBlob.ts), а маршрут заливки перестаёт
 * отвечать — клиентский код при этом один и тот же.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assetKey } from './keys';
import { issueTicket, TICKET_TTL_MS } from './tokens';
import { vercelStore } from './vercelBlob';

export { ASSET_PREFIX, assetKey, snapshotKey, STORE_DIR } from './keys';

export interface UploadTicket {
  hash: string;
  /** Куда класть байты. Клиент про природу адреса ничего не знает. */
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: number;
}

export interface BlobStore {
  /** Имя реализации — уходит в ответ, чтобы в проде было видно, что подключено. */
  readonly name: string;
  /** Есть ли уже такие байты. Ответ на этот вопрос и есть дедупликация (§11.3). */
  present(hashes: string[]): Promise<Set<string>>;
  /** Право положить один ассет. */
  ticket(hash: string, bytes: number): Promise<UploadTicket>;
  /** Мелкое и наше: манифест снапшота. Он ≤ 2 МБ и в лимит функции проходит. */
  put(key: string, body: Uint8Array, mime: string): Promise<void>;
  /** Публичный адрес — на него уводит 302 из `GET /api/share/:id` (§14). */
  url(key: string): string;
  read(key: string): Promise<Uint8Array | null>;
  remove(keys: string[]): Promise<void>;
  /**
   * Что лежит под префиксом и когда положено.
   *
   * Нужно ровно уборке (§14). Ассет, залитый по билету, но так и не названный
   * ни одним снапшотом, иначе остаётся навсегда: реестр про него не знает —
   * его туда никто не записывал, — а хранилище не знает, нужен ли он. Без
   * этого метода `negotiate` + `PUT` работали бы бесплатным файлохостингом.
   */
  list(prefix: string): Promise<{ key: string; updatedAt: number }[]>;
}

/* ─── Файловая реализация ───────────────────────────────────────────────── */

/*
 * Куда складывать. Имя каталога — литерал, а не `STORE_DIR` из keys.ts, хотя
 * это одна и та же строка: трассировщик сборки понимает `join(cwd, 'литерал')`
 * как доступ внутрь подкаталога, а константу из другого модуля — нет, и на
 * всякий случай тащит в функцию весь проект вместе с `public`.
 */
const ROOT = join(process.cwd(), '.r3ad-store');

/**
 * Ключ приходит снаружи — значит, он должен быть разрешён, а не проверен на
 * запрещённое.
 *
 * Первая версия склеивала путь и сверяла результат с корнем через `resolve`.
 * Работало, но у этого есть неочевидная цена: сборщик Next видит файловый
 * доступ по вычисляемому пути и на всякий случай тащит в трассировку функции
 * весь проект — включая `public` и исходники. Список разрешённых знаков решает
 * и это, и исходную задачу строже: `..` в ключе не нужно отсекать, если его в
 * нём просто не бывает.
 */
const SAFE_KEY = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/i;

function pathFor(key: string): string {
  if (!SAFE_KEY.test(key)) throw new Error('key escapes the store');
  return join(ROOT, key);
}

function fileStore(): BlobStore {
  return {
    name: 'filesystem',

    async present(hashes) {
      const found = new Set<string>();
      await Promise.all(
        hashes.map(async (hash) => {
          try {
            await stat(pathFor(assetKey(hash)));
            found.add(hash);
          } catch {
            /* нет — значит, его и попросим залить */
          }
        }),
      );
      return found;
    },

    async ticket(hash, bytes) {
      const expiresAt = Date.now() + TICKET_TTL_MS;
      const token = issueTicket({ hash, bytes, expiresAt });
      return {
        hash,
        url: `/api/blob/${assetKey(hash)}?t=${encodeURIComponent(token)}`,
        method: 'PUT',
        headers: {},
        expiresAt,
      };
    },

    async put(key, body) {
      const file = pathFor(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body);
    },

    url(key) {
      return `/api/blob/${key}`;
    },

    async read(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch {
        return null;
      }
    },

    async remove(keys) {
      await Promise.all(keys.map((key) => rm(pathFor(key), { force: true })));
    },

    async list(prefix) {
      try {
        const names = await readdir(pathFor(prefix));
        const out: { key: string; updatedAt: number }[] = [];

        for (const name of names) {
          const info = await stat(pathFor(prefix + name)).catch(() => null);
          if (info?.isFile()) out.push({ key: prefix + name, updatedAt: info.mtimeMs });
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}

/**
 * Что подключено.
 *
 * Ровно одна строка, как и задумано в §15.1: ключ в окружении — работает
 * Vercel Blob, нет ключа — файлы. Ключ Vercel подставляет сам, когда стор
 * привязан к проекту; локально его нет, и ничего для этого делать не надо.
 */
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
export const blobs: BlobStore = BLOB_TOKEN ? vercelStore(BLOB_TOKEN) : fileStore();

/** Байты пришли — но те ли это байты. Хранилище адресуется содержимым. */
export function hashOf(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

/** Умеет ли текущее хранилище принимать заливку нашим же маршрутом. */
export const localUploads = blobs.name === 'filesystem';
