/**
 * Замок на снапшот: AES-GCM на клиенте, ключ мимо сервера.
 *
 * Четыре решения, которые здесь важнее алгоритма.
 *
 * **Шифруем в браузере, а не на сервере.** Иначе «приватный снапшот» значит
 * «сервер обещал не смотреть». В этой схеме сервер хранит шифротекст и не может
 * его прочесть — не потому, что не хочет, а потому что ключа у него нет.
 *
 * **Ключ живёт во фрагменте URL** (`#k=…`, SPEC §11.3). Фрагмент — единственная
 * часть адреса, которая не уходит на сервер: браузер не отправляет его ни в
 * запросе, ни в `Referer`. Ссылка целиком открывает снимок, та же ссылка в
 * логах сервера — нет.
 *
 * **Парольная фраза выводит ключ, а не заменяет его.** Фраза нужна, когда
 * ссылку придётся передать по читаемому каналу: тогда ключа в ссылке нет вовсе.
 * PBKDF2 с 210 000 итераций — рекомендация OWASP для SHA-256; задержка в
 * несколько сотен миллисекунд здесь ровно затем, чтобы быть заметной перебору.
 *
 * **Под замок уходят и байты ассетов, а не только манифест.** Соблазн запереть
 * один манифест велик: он маленький, а картинки дороги. Но конспект — это и
 * есть вставленные в него скриншоты, и «пароль на снимок», оставляющий их
 * лежать открытыми, — обещание, которого мы не выполняем. Цена честности
 * записана в `publish.ts`: у запертого снимка нет дедупликации.
 */
const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Конверт для JSON. Соль есть только у запертого фразой. */
export interface Sealed {
  v: 1;
  salt?: string;
  iv: string;
  ct: string;
}

export function isSealed(value: unknown): value is Sealed {
  const sealed = value as Partial<Sealed> | null;
  return !!sealed && typeof sealed === 'object' && sealed.v === 1 && typeof sealed.ct === 'string';
}

export function needsPassphrase(sealed: Sealed): boolean {
  return typeof sealed.salt === 'string';
}

/* ─── base64url ─────────────────────────────────────────────────────────── */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ─── Ключи ─────────────────────────────────────────────────────────────── */

export type LockKind = 'none' | 'link' | 'passphrase';

export interface Lock {
  key: CryptoKey;
  /** Соль PBKDF2 — попадает в конверт, чтобы получатель вывел тот же ключ. */
  salt?: string;
  /** Ключ для `#k=…`. null — заперто фразой, в ссылке его нет. */
  fragmentKey: string | null;
}

async function fromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Замок для нового снимка. */
export async function newLock(passphrase?: string): Promise<Lock> {
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    return { key: await fromPassphrase(passphrase, salt), salt: toBase64Url(salt), fragmentKey: null };
  }

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return { key, fragmentKey: toBase64Url(raw) };
}

/**
 * Ключ к чужому конверту.
 *
 * Какой это ключ — из фрагмента или из фразы, — решает сам конверт, а не то,
 * что нам передали: соль в нём есть тогда и только тогда, когда снимок заперт
 * фразой. Поэтому «введите пароль» появляется ровно там, где пароль правда есть.
 */
export async function openLock(sealed: Sealed, secret: string): Promise<CryptoKey> {
  if (sealed.salt) return fromPassphrase(secret, fromBase64Url(sealed.salt));
  return crypto.subtle.importKey('raw', fromBase64Url(secret) as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/* ─── Шифрование ────────────────────────────────────────────────────────── */

export async function sealJson(lock: Lock, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, lock.key, plain);

  return { v: 1, salt: lock.salt, iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) };
}

export async function unsealJson(key: CryptoKey, sealed: Sealed): Promise<unknown> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(sealed.iv) as BufferSource },
    key,
    fromBase64Url(sealed.ct) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * Байты ассета: `iv || ciphertext` одним куском.
 *
 * Отдельного конверта им не заводим — блоб и так лежит под своим именем, а
 * двенадцать байт впереди дешевле, чем JSON вокруг мегабайта картинки.
 */
export async function sealBytes(lock: Lock, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, lock.key, bytes as BufferSource),
  );

  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function unsealBytes(key: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = bytes.slice(0, IV_BYTES);
  const ct = bytes.slice(IV_BYTES);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new Uint8Array(plain);
}
