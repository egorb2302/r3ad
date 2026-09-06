/**
 * Реестр снапшотов.
 *
 * Второе из трёх платформо-зависимых мест (§15.1). Спека отводила ему Turso;
 * первый деплой держит его в том же Vercel Blob, что и байты (см.
 * vercelBlob.ts), а здесь — тот же набор операций поверх одного JSON-файла.
 *
 * Операций ровно пять, и модель данных — §13 без изменений: `Snapshot` с
 * идентификатором, версией, объёмом, признаком шифрования, списком ассетов и
 * сроком. Байтов тут нет: манифест лежит в блобе, здесь только ключ на него.
 *
 * Учёт ссылок на ассеты ведётся здесь же, а не в блобе. Дедупликация (§11.3)
 * означает, что один и тот же скриншот принадлежит нескольким снапшотам, и
 * узнать, что он осиротел, можно только пересчитав ссылки — само хранилище
 * байтов про снапшоты не знает и знать не должно.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { STORE_DIR } from './keys';
import { blobCredentials, blobMeta } from './vercelBlob';

export type SnapshotScope = 'appearance' | 'journal' | 'volume';

export interface SnapshotRecord {
  id: string;
  version: number;
  scope: SnapshotScope;
  encrypted: boolean;
  /** Ключ манифеста в блобе. Тело снапшота там, а не тут. */
  key: string;
  title: string;
  assets: string[];
  bytes: number;
  createdAt: number;
  updatedAt: number;
  /** 90 дней, продлеваются при каждом открытии (§14). */
  expiresAt: number;
  /** sha256 от manageToken. Сам токен есть только у того, кто делился. */
  owner: string;
  /** Снят по жалобе. Запись остаётся: лог удалений — требование §18. */
  takenDown?: { at: number; reason: string };
}

export interface MetaStore {
  readonly name: string;
  get(id: string): Promise<SnapshotRecord | null>;
  put(record: SnapshotRecord): Promise<void>;
  remove(id: string): Promise<void>;
  /** Все снапшоты, у которых вышел срок. Для уборки по расписанию (§14). */
  expired(now: number): Promise<SnapshotRecord[]>;
  /** Ассеты, на которые больше никто не ссылается. */
  orphans(candidates: string[]): Promise<string[]>;
}

/* ─── Файловая реализация ───────────────────────────────────────────────── */

const FILE = join(process.cwd(), STORE_DIR, 'snapshots.json');

interface Table {
  snapshots: Record<string, SnapshotRecord>;
}

let table: Table | null = null;
/**
 * Очередь записи.
 *
 * Файл переписывается целиком, и два одновременных сохранения затёрли бы одно
 * другим. В Turso этой проблемы нет — там транзакция; здесь она решается тем,
 * что записи выстраиваются в цепочку промисов. Внутри одного процесса этого
 * достаточно, между процессами — нет, и это записано честно: реализация для
 * разработки.
 */
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Table> {
  if (table) return table;
  try {
    table = JSON.parse(await readFile(FILE, 'utf8')) as Table;
  } catch {
    table = { snapshots: {} };
  }
  return table;
}

/** Пишем через временный файл: обрыв на середине не должен оставлять огрызок. */
async function flush(): Promise<void> {
  const snapshot = JSON.stringify(table, null, 2);
  await mkdir(dirname(FILE), { recursive: true });
  const temporary = `${FILE}.${process.pid}.tmp`;
  await writeFile(temporary, snapshot);
  await rename(temporary, FILE);
}

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

function fileMeta(): MetaStore {
  return {
    name: 'filesystem',

    async get(id) {
      return (await load()).snapshots[id] ?? null;
    },

    async put(record) {
      return serial(async () => {
        const data = await load();
        data.snapshots[record.id] = record;
        await flush();
      });
    },

    async remove(id) {
      return serial(async () => {
        const data = await load();
        delete data.snapshots[id];
        await flush();
      });
    },

    async expired(now) {
      const data = await load();
      return Object.values(data.snapshots).filter((s) => s.expiresAt <= now);
    },

    async orphans(candidates) {
      const data = await load();
      const referenced = new Set<string>();
      for (const snapshot of Object.values(data.snapshots)) {
        for (const hash of snapshot.assets) referenced.add(hash);
      }
      return candidates.filter((hash) => !referenced.has(hash));
    },
  };
}

const BLOB = blobCredentials();
export const meta: MetaStore = BLOB ? blobMeta(BLOB) : fileMeta();

/** Срок жизни снапшота из §14. Продлевается при каждом открытии. */
export const SNAPSHOT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
