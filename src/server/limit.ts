/**
 * Рейт-лимиты и кэш ответов unfurl.
 *
 * Третье из платформо-зависимых мест (§15.1); в проде — Upstash, здесь —
 * счётчики в памяти процесса за тем же интерфейсом.
 *
 * Честная оговорка, которую нельзя потерять при переносе: инстансы функций
 * Vercel не делят память. Пока лимитер такой, параллельные запросы с одного
 * адреса попадают в разные инстансы, и предел оказывается мягче объявленного.
 * На M4 это касалось только развёртывания ссылок; с M5 тем же счётчиком
 * защищён блоб, куда заливают чужие файлы (§19), и цена ошибки выросла —
 * поэтому предохранитель из §21.7 (дневной потолок на отдачу) выведен сюда же,
 * отдельным лимитером, а не оставлен на «когда-нибудь».
 *
 * Интерфейс от замены не изменится: меняются три строки — по одной на каждый
 * `memoryLimiter` ниже.
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

/** Оттуда же: двадцать снапшотов в сутки с адреса. */
export const SHARE_QUOTA = { limit: 20, windowMs: 24 * 60 * 60 * 1000 };

/**
 * Заливка ассетов.
 *
 * Считается не в мегабайтах, а в билетах: билет выдаётся на один ассет, и
 * потолок его размера уже стоит в `SHARE_LIMITS`. Четыреста ассетов в час — это
 * шесть-семь полноценных снапшотов, то есть заметно больше, чем нужно человеку,
 * и заметно меньше, чем нужно тому, кто решил, что нашёл себе файлохостинг.
 */
export const UPLOAD_QUOTA = { limit: 400, windowMs: 60 * 60 * 1000 };

/**
 * Предохранитель из §21.7.
 *
 * Открытий публичной страницы в сутки со всего сайта, а не с адреса — ключ у
 * этого лимитера один на всех. Расшаренная полка, залетевшая в X, кончается не
 * тем, что кто-то не посмотрел книжку, а тем, что тарификация Vercel идёт по
 * факту. Дневной потолок — самый грубый из трёх предложенных вариантов и
 * единственный, который не требует ни алертов, ни ручного рубильника: за ним
 * страница отдаётся, но без снапшота.
 */
export const PUBLIC_QUOTA = { limit: 5000, windowMs: 24 * 60 * 60 * 1000 };

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
export const shareLimiter: RateLimiter = memoryLimiter(SHARE_QUOTA);
export const uploadLimiter: RateLimiter = memoryLimiter(UPLOAD_QUOTA);
export const publicLimiter: RateLimiter = memoryLimiter(PUBLIC_QUOTA);

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
