import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fingerprint,
  issueTicket,
  newManageToken,
  newSnapshotId,
  readTicket,
  tokenMatches,
} from '@/server/tokens';

afterEach(() => vi.useRealTimers());

describe('билет на заливку', () => {
  const claims = { hash: 'a'.repeat(64), bytes: 1234, expiresAt: Date.now() + 60_000 };

  it('читается обратно, пока не вышел срок', () => {
    expect(readTicket(issueTicket(claims))).toEqual(claims);

    vi.useFakeTimers();
    vi.setSystemTime(claims.expiresAt + 1);
    expect(readTicket(issueTicket(claims))).toBeNull();
  });

  it('подделанный не читается — и не объясняет почему', () => {
    const ticket = issueTicket(claims);
    const [payload, signature] = ticket.split('.');
    const other = Buffer.from(`${claims.hash}.${claims.bytes * 10}.${claims.expiresAt}`).toString(
      'base64url',
    );

    expect(readTicket(`${other}.${signature}`)).toBeNull();
    expect(readTicket(`${payload}.${signature.slice(0, -2)}xx`)).toBeNull();
    expect(readTicket(payload)).toBeNull();
    expect(readTicket('')).toBeNull();
  });
});

describe('владение снапшотом', () => {
  it('хранится отпечаток, а сверяется токен', () => {
    const token = newManageToken();
    const stored = fingerprint(token);
    expect(stored).not.toBe(token);
    expect(tokenMatches(token, stored)).toBe(true);
    expect(tokenMatches(newManageToken(), stored)).toBe(false);
  });

  it('идентификатор снапшота — шесть знаков без похожих букв', () => {
    for (let i = 0; i < 50; i++) expect(newSnapshotId()).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/);
    expect(newSnapshotId(10)).toHaveLength(10);
  });
});
