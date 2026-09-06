/**
 * Идентификаторы записей тетради.
 *
 * SPEC §13 просит nanoid(12); зависимость ради двенадцати символов не нужна —
 * это ровно тот случай, когда пакет весит больше своей функции. Алфавит
 * URL-безопасный, источник случайности — `crypto`, потому что идентификаторы
 * переживут снапшот и встретятся с чужими (M6).
 */
const ALPHABET = 'useandom26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict';

export function id(size = 12): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);

  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}
