/**
 * Локальная база: полка, пережившая перезагрузку.
 *
 * До M5 всё жило в памяти вкладки, и это был честный долг (§21.15): конспект,
 * вырезки и вставленные скриншоты исчезали от F5. Возвращает их сюда не
 * отдельный формат сохранения, а тот же бандл, который уезжает в снапшот и
 * ложится в `.r3ad` (см. core/share/bundle.ts). Выигрыш не в экономии кода:
 * сохранение — путь, который никто не проверяет чужими глазами, и, разойдясь с
 * импортом, оно разойдётся молча. Общая дорога означает, что каждая
 * перезагрузка проверяет тот же разбор, которым открывается чужая ссылка.
 *
 * **Почему не Dexie, которую называет §15.** Здесь ровно два хранилища —
 * «манифест» на один ключ и «байты по хэшу», — ни запросов, ни индексов, ни
 * миграций схемы. Всё, что Dexie даёт сверх сырого IndexedDB, тут не
 * используется, а платить за неё пришлось бы в загрузке первого экрана, потому
 * что база открывается на старте. Появятся запросы (поиск по библиотеке,
 * история версий вырезки из §21.14) — вернуться к ней будет дешевле, чем
 * сейчас снимать.
 *
 * **Почему не OPFS для байтов.** IndexedDB хранит `Blob` как есть, без base64 и
 * без копии в память, а OPFS потребовал бы собственного каталога, собственной
 * сборки мусора и воркера для синхронного доступа. Смысл он приобретёт на
 * файлах в сотни мегабайт; сегодняшний потолок — десять (§14).
 */
import { adoptAsset, assetBlob } from '@/core/assets';
import { referencedAssets, type Bundle } from '@/core/share/bundle';

const DB_NAME = 'r3ad';
const DB_VERSION = 1;
const SHELF = 'shelf';
const ASSETS = 'assets';
/** Ключ единственной записи манифеста: библиотека у вкладки одна. */
const CURRENT = 'current';

let opening: Promise<IDBDatabase | null> | null = null;

/**
 * Открыть базу.
 *
 * Отказ — не ошибка приложения. В приватном окне, при запрете хранилища и в
 * старом браузере IndexedDB просто нет, и сайт обязан работать так, как
 * работал до M5: в памяти вкладки. Поэтому здесь `null`, а не исключение, и
 * все вызовы ниже молча становятся пустыми.
 */
function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;

  opening = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHELF)) db.createObjectStore(SHELF);
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return opening;
}

function run<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ─── Манифест ──────────────────────────────────────────────────────────── */

export async function loadBundle(): Promise<Bundle | null> {
  const db = await open();
  if (!db) return null;

  try {
    const tx = db.transaction(SHELF, 'readonly');
    const value = await run(tx.objectStore(SHELF).get(CURRENT));
    return (value as Bundle) ?? null;
  } catch {
    return null;
  }
}

/**
 * Записать манифест и недостающие байты.
 *
 * Байты пишутся до манифеста и не удаляются вместе с ним. Порядок не
 * косметика: манифест, сохранившийся раньше ассетов, после падения вкладки
 * ссылался бы на то, чего в базе нет, — а это ровно та страница с дырой, из-за
 * которой M4 и остался без сохранения.
 */
export async function saveBundle(bundle: Bundle): Promise<void> {
  const db = await open();
  if (!db) return;

  try {
    // Ключи читаются своей транзакцией; запись ниже открывает новую.
    const have = await knownHashes();
    const missing = bundle.assets.filter((a) => !have.has(a.hash));

    if (missing.length > 0) {
      const tx = db.transaction(ASSETS, 'readwrite');
      const store = tx.objectStore(ASSETS);
      for (const asset of missing) {
        const blob = assetBlob(asset.hash);
        if (blob) store.put(blob, asset.hash);
      }
      await done(tx);
    }

    const tx = db.transaction(SHELF, 'readwrite');
    tx.objectStore(SHELF).put(bundle, CURRENT);
    await done(tx);
  } catch {
    /* Кончилось место или окно приватное — полка просто не переживёт вкладку. */
  }
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ─── Ассеты ────────────────────────────────────────────────────────────── */

async function knownHashes(): Promise<Set<string>> {
  const db = await open();
  if (!db) return new Set();

  const tx = db.transaction(ASSETS, 'readonly');
  const keys = await run(tx.objectStore(ASSETS).getAllKeys());
  return new Set(keys as string[]);
}

/**
 * Поднять байты бандла в хранилище ассетов.
 *
 * Все запросы к базе создаются **до** первого `await`, и это не стиль, а
 * условие работоспособности. Транзакция IndexedDB живёт, пока не опустеет
 * очередь микрозадач, и первое же ожидание чего-то постороннего — здесь это
 * пересчёт sha256 в `adoptAsset` — её закрывает. Цикл вида «прочитал —
 * положил — прочитал» поэтому восстанавливает ровно один ассет, а на втором
 * тихо получает `TransactionInactiveError`: картинки в конспекте пропадают, а
 * ошибки нет. Читаем всё одной пачкой, раскладываем — потом.
 *
 * Хэш при укладке проверяется (`adoptAsset`), и это не паранойя по отношению к
 * собственной базе: та же функция принимает байты из чужого `.r3ad` и из
 * снапшота, и путь у них один.
 */
export async function restoreAssets(bundle: Bundle): Promise<number> {
  const db = await open();
  if (!db) return 0;

  /*
   * Спрашиваем по ссылкам страниц, а не по списку ассетов манифеста. Список —
   * это «что мы могли отдать в момент записи», и он на один эпизод беспамятства
   * короче: стоит байтам разок не оказаться под рукой, и картинка выпадает из
   * него навсегда, хотя лежит в базе и на неё по-прежнему показывает страница.
   * Ссылка — это «что нужно»; она и должна поднимать байты.
   */
  const wanted = referencedAssets(bundle);
  const mime = new Map(bundle.assets.map((a) => [a.hash, a.mime]));

  let blobs: (Blob | undefined)[];
  try {
    const store = db.transaction(ASSETS, 'readonly').objectStore(ASSETS);
    blobs = (await Promise.all(wanted.map((hash) => run(store.get(hash))))) as (
      | Blob
      | undefined
    )[];
  } catch {
    return 0;
  }

  let restored = 0;
  for (const [index, blob] of blobs.entries()) {
    if (!blob) continue;
    const hash = wanted[index];
    try {
      await adoptAsset(hash, new Blob([blob], { type: mime.get(hash) ?? blob.type }));
      restored += 1;
    } catch {
      /* Байты не сошлись с именем — ссылка останется пустым местом. */
    }
  }
  return restored;
}

/**
 * Убрать байты, на которые больше никто не ссылается.
 *
 * Зовётся после записи манифеста, а не вместо неё: пока ассет числится в
 * прошлой версии полки, удалять его рано — отмена ещё может вернуть страницу,
 * с которой убрали картинку.
 */
export async function pruneAssets(keep: Set<string>): Promise<number> {
  const db = await open();
  if (!db) return 0;

  try {
    // Читаем в одной транзакции, удаляем в другой — по той же причине, что и в
    // `restoreAssets`: между чтением и записью здесь стоит `await`.
    const keys = (await run(
      db.transaction(ASSETS, 'readonly').objectStore(ASSETS).getAllKeys(),
    )) as string[];

    const stale = keys.filter((key) => !keep.has(key));
    if (stale.length === 0) return 0;

    const tx = db.transaction(ASSETS, 'readwrite');
    const store = tx.objectStore(ASSETS);
    for (const key of stale) store.delete(key);
    await done(tx);

    return stale.length;
  } catch {
    return 0;
  }
}

/** Полностью забыть сохранённое — «начать с чистой полки». */
export async function forgetAll(): Promise<void> {
  const db = await open();
  if (!db) return;

  try {
    const tx = db.transaction([SHELF, ASSETS], 'readwrite');
    tx.objectStore(SHELF).clear();
    tx.objectStore(ASSETS).clear();
    await done(tx);
  } catch {
    /* нечего забывать */
  }
}

export interface LocalUsage {
  assets: number;
  bytes: number;
}

/** Сколько занято — для инспектора. */
export async function localUsage(): Promise<LocalUsage> {
  const db = await open();
  if (!db) return { assets: 0, bytes: 0 };

  try {
    const tx = db.transaction(ASSETS, 'readonly');
    const store = tx.objectStore(ASSETS);
    const blobs = (await run(store.getAll())) as Blob[];
    return { assets: blobs.length, bytes: blobs.reduce((n, b) => n + b.size, 0) };
  } catch {
    return { assets: 0, bytes: 0 };
  }
}
