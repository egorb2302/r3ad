/**
 * Подписи и секреты сервера.
 *
 * Две разные вещи, у которых общий примитив.
 *
 * **Билет на заливку.** Клиент кладёт байты в блоб напрямую, мимо функций
 * (§11.3, шаг 4) — иначе десятимегабайтный ассет не пройдёт четырёхмегабайтный
 * лимит тела (§15.1). Значит, право положить конкретный хэш надо выдать
 * заранее и так, чтобы его нельзя было выписать себе самому: подписанный билет
 * с хэшом, размером и сроком.
 *
 * **`manageToken`.** Владение снапшотом без аккаунта (§11.3, шаг 7). Токен
 * отдаётся клиенту один раз и живёт у него; у нас лежит только его sha256 —
 * тот же приём, что и с паролями, и по той же причине: утёкшая база снапшотов
 * не должна означать право их править.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Секрет подписи.
 *
 * В проде задаётся переменной окружения. Без неё берётся случайный на процесс:
 * билеты живут десять минут и не обязаны переживать перезапуск, а вот тихо
 * подписывать пустой строкой — это подписывать чем-то, что знают все.
 */
const SECRET = process.env.R3AD_SHARE_SECRET || randomBytes(32).toString('hex');

/** Сколько живёт билет. Заливка одного ассета укладывается на порядок быстрее. */
export const TICKET_TTL_MS = 10 * 60 * 1000;

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export interface TicketClaims {
  hash: string;
  bytes: number;
  expiresAt: number;
}

export function issueTicket(claims: TicketClaims): string {
  const payload = `${claims.hash}.${claims.bytes}.${claims.expiresAt}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

/**
 * Проверить билет.
 *
 * Возвращает `null` на любую неудачу, не объясняя какую. Отличать «подпись не
 * сошлась» от «срок вышел» в ответе значит помогать подбирать.
 */
export function readTicket(token: string): TicketClaims | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;

  const payload = Buffer.from(token.slice(0, dot), 'base64url').toString();
  if (!equal(sign(payload), token.slice(dot + 1))) return null;

  const [hash, bytes, expiresAt] = payload.split('.');
  const claims = { hash, bytes: Number(bytes), expiresAt: Number(expiresAt) };
  if (!claims.hash || !Number.isFinite(claims.bytes) || !Number.isFinite(claims.expiresAt)) {
    return null;
  }
  return claims.expiresAt > Date.now() ? claims : null;
}

/** Сравнение за постоянное время: подпись сверяется, а не «совпадает ли строка». */
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/* ─── Владение снапшотом ────────────────────────────────────────────────── */

export function newManageToken(): string {
  return randomBytes(24).toString('base64url');
}

export function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenMatches(token: string, stored: string): boolean {
  return equal(fingerprint(token), stored);
}

/**
 * Идентификатор снапшота.
 *
 * Шесть знаков, как `kq7f2m` из §11.3, из алфавита без похожих букв. Ссылка
 * неугадываемая не длиной, а тем, что снапшоты unlisted и их мало; шесть знаков
 * этого алфавита — это 1.5 миллиарда вариантов, и перебор упирается в
 * рейт-лимит куда раньше, чем в число.
 */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function newSnapshotId(size = 6): string {
  const bytes = randomBytes(size);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}
