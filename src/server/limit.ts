/**
 * Рейт-лимит и кэш ответов unfurl.
 *
 * Оба — за интерфейсом, и оба сейчас в памяти процесса. Это не заглушка «на
 * потом», а осознанный порядок: реализация на Upstash появится вместе с
 * шерингом (M5), где счётчики нужны по-настоящему — там лимиты защищают от
 * заливки чужих файлов в наш блоб (§19). До тех пор единственный ходящий
 * наружу эндпоинт защищён ровно настолько, насколько может быть защищён
 * счётчик в одном инстансе.
 *
 * Честная оговорка, которую нельзя потерять при переносе (§15.1): инстансы
 * функций Vercel не делят память. Пока лимитер такой, параллельные запросы с
 * одного адреса могут попасть в разные инстансы, и предел окажется мягче
 * объявленного. Интерфейс от замены не изменится — меняется одна строка в
 * `rateLimiter`.
 */

export interface RateVerdict {
  ok: boolean;
  /** Сколько осталось в окне. Уходит в заголовки ответа. */
  remaining: number;
  /** Когда окно откроется снова, в миллисекундах эпохи. */
  resetAt: number;
}

export interface RateLimiter {
  take(key: string): Promise<RateVerdict>;
}

/** Лимит из §14: шестьдесят разворотов ссылок в час с адреса. */
export const UNFURL_QUOTA = { limit: 60, windowMs: 60 * 60 * 1000 };

interface Window {
  used: number;
  resetAt: number;
}

function memoryLimiter(quota: { limit: number; windowMs: number }): RateLimiter {
  const windows = new Map<string, Window>();

  return {
    async take(key) {
      const now = Date.now();
      const window = windows.get(key);

      if (!window || window.resetAt <= now) {
        const fresh = { used: 1, resetAt: now + quota.windowMs };
        windows.set(key, fresh);
        // Чистка ленивая: отдельный таймер в serverless-процессе жил бы дольше
        // самого процесса и держал бы его от засыпания.
        if (windows.size > 4096) {
          for (const [id, w] of windows) if (w.resetAt <= now) windows.delete(id);
        }
        return { ok: true, remaining: quota.limit - 1, resetAt: fresh.resetAt };
      }

      window.used += 1;
      return {
        ok: window.used <= quota.limit,
        remaining: Math.max(0, quota.limit - window.used),
        resetAt: window.resetAt,
      };
    },
  };
}

export const rateLimiter: RateLimiter = memoryLimiter(UNFURL_QUOTA);

/**
 * Кто спрашивает.
 *
 * За прокси Vercel настоящий адрес приезжает заголовком; напрямую его нет
 * вовсе. Ключ без адреса — общий на всех, и это правильнее, чем считать разными
 * тех, кого мы не различаем: иначе лимит обходится пустым заголовком.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip') || 'anonymous';
}

/* ─── Кэш ответов ───────────────────────────────────────────────────────── */

/** Сутки, как в §10. Вырезка — снимок момента, ей не нужна свежесть. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface Entry<T> {
  value: T;
  bornAt: number;
}

export interface Cache<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
}

export function memoryCache<T>(ttlMs = CACHE_TTL_MS, capacity = 200): Cache<T> {
  const entries = new Map<string, Entry<T>>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (Date.now() - entry.bornAt > ttlMs) {
        entries.delete(key);
        return null;
      }
      // Освежаем порядок: Map хранит его по вставке, и удаление старейшего
      // ниже становится вытеснением по давности обращения.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },

    set(key, value) {
      entries.set(key, { value, bornAt: Date.now() });
      if (entries.size > capacity) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
  };
}
