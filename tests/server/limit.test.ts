import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientKey, memoryCache, SHARE_QUOTA, shareLimiter } from '@/server/limit';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('рейт-лимит в памяти', () => {
  it('отсчитывает окно и открывает его заново по сроку', async () => {
    const key = `ip-${Math.random()}`;
    for (let i = 1; i <= SHARE_QUOTA.limit; i++) {
      const verdict = await shareLimiter.take(key);
      expect(verdict.ok, `запрос ${i}`).toBe(true);
      expect(verdict.remaining).toBe(SHARE_QUOTA.limit - i);
    }

    const over = await shareLimiter.take(key);
    expect(over.ok).toBe(false);
    expect(over.remaining).toBe(0);

    vi.advanceTimersByTime(SHARE_QUOTA.windowMs + 1);
    expect((await shareLimiter.take(key)).ok).toBe(true);
  });

  it('адреса считаются порознь', async () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    for (let i = 0; i < SHARE_QUOTA.limit; i++) await shareLimiter.take(a);
    expect((await shareLimiter.take(a)).ok).toBe(false);
    expect((await shareLimiter.take(b)).ok).toBe(true);
  });

  it('ключ клиента — первый адрес из заголовка прокси, без него общий', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }))).toBe('10.0.0.1');
    expect(clientKey(new Headers({ 'x-real-ip': '10.0.0.3' }))).toBe('10.0.0.3');
    expect(clientKey(new Headers())).toBe('anonymous');
    expect(clientKey(new Headers({ 'x-forwarded-for': '' }))).toBe('anonymous');
  });
});

describe('кэш ответов', () => {
  it('живёт до срока и вытесняет давно не спрошенное', () => {
    const cache = memoryCache<number>(1000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);

    // «a» освежили — вылетает «b».
    cache.set('c', 3);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe(1);

    vi.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeNull();
    expect(cache.get('c')).toBeNull();
  });
});
