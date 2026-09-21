// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentDoc } from '@/core/content';
import { openFile } from '@/core/ingest';
import {
  basename,
  dirname,
  fragment,
  isExternal,
  joinPath,
  safeDecode,
  stripFragment,
} from '@/core/ingest/paths';

describe('пути внутри архива', () => {
  it('склеивает относительные ссылки и сворачивает «..»', () => {
    expect(joinPath('OEBPS/text', '../images/plate.png')).toBe('OEBPS/images/plate.png');
    expect(joinPath('a', './b/../c')).toBe('a/c');
    expect(joinPath('', 'text/ch1.xhtml#frag')).toBe('text/ch1.xhtml');
    expect(joinPath('a/b', '/c.html')).toBe('c.html');
    expect(joinPath('a', 'https://example.org/x')).toBe('https://example.org/x');
  });

  it('отличает ссылку наружу от пути', () => {
    expect(isExternal('mailto:x@y')).toBe(true);
    expect(isExternal('http://x')).toBe(true);
    expect(isExternal('text/a.html')).toBe(false);
    expect(isExternal('../a.html')).toBe(false);
  });

  it('проценты раскрываются, а битые — остаются как есть', () => {
    expect(safeDecode('Ch3%20Notes.xhtml')).toBe('Ch3 Notes.xhtml');
    expect(safeDecode('100%')).toBe('100%');
  });

  it('якорь, папка и имя', () => {
    expect(stripFragment('a/b.html#c')).toBe('a/b.html');
    expect(fragment('a/b.html#c')).toBe('c');
    expect(fragment('a/b.html')).toBe('');
    expect(dirname('a/b/c.html')).toBe('a/b');
    expect(dirname('c.html')).toBe('');
    expect(basename('a/b/c.html')).toBe('c.html');
  });
});

/*
 * Книги — те самые фикстуры из scripts/make-fixtures.mjs: каждая ловушка в
 * них однажды ломала разбор. Картинки под jsdom не декодируются (нет canvas),
 * и это ожидаемо: здесь проверяется структура, а не растр.
 */
describe('разбор книг', () => {
  const docs = new Map<string, ContentDoc>();

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r3ad-fixtures-'));
    execFileSync(process.execPath, ['scripts/make-fixtures.mjs', dir], { stdio: 'ignore' });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const name of ['epub3.epub', 'epub2.epub', 'plain.txt']) {
      docs.set(name, await openFile(new File([readFileSync(join(dir, name))], name)));
    }
    quiet.mockRestore();
  }, 30_000);

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('EPUB 3: метаданные, главы и вложенное оглавление', () => {
    const doc = docs.get('epub3.epub')!;
    expect(doc.format).toBe('epub');
    expect(doc.title).toBe('Impression: an EPUB 3 fixture');
    expect(doc.author).toBe('A. Compositor');
    expect(doc.language).toBe('en-GB');

    expect(doc.toc.map((t) => t.title)).toEqual([
      'The Compositor',
      'Kerning and Consequence',
      'Notes on the Spine',
      'The Endpaper',
    ]);
    expect(doc.toc.find((t) => t.title === 'Kerning and Consequence')?.depth).toBe(1);
  });

  it('EPUB 3: проценты в оглавлении разрешаются в главу', () => {
    const doc = docs.get('epub3.epub')!;
    const ids = new Set(doc.chapters.map((c) => c.id));
    for (const entry of doc.toc) expect(ids.has(entry.chapterId), entry.title).toBe(true);
  });

  it('EPUB 3: чужой CSS и скрипты не доезжают до вёрстки, таблицы и цитаты — доезжают', () => {
    const doc = docs.get('epub3.epub')!;
    const html = doc.chapters.map((c) => c.html).join('\n');
    expect(html).not.toMatch(/<script|class=|style=|position:fixed|<section/);
    expect(html).toContain('<table>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<em>Set in italics.</em>');
    expect(doc.charCount).toBeGreaterThan(10_000);
  });

  it('EPUB 2: NCX с другим регистром папки всё равно находит главы', () => {
    const doc = docs.get('epub2.epub')!;
    expect(doc.title).toBe('Signature');
    expect(doc.author).toBe('B. Binder');
    expect(doc.chapters).toHaveLength(3);
    expect(doc.toc.map((t) => [t.title, t.depth])).toEqual([
      ['Part One', 0],
      ['Part Two', 1],
      ['Part Three', 0],
    ]);
    const ids = new Set(doc.chapters.map((c) => c.id));
    for (const entry of doc.toc) expect(ids.has(entry.chapterId), entry.title).toBe(true);
  });

  it('плоский текст — тоже книга', () => {
    const doc = docs.get('plain.txt')!;
    expect(doc.format).toBe('txt');
    expect(doc.chapters.length).toBeGreaterThanOrEqual(1);
    expect(doc.charCount).toBeGreaterThan(1000);
    expect(doc.chapters.map((c) => c.html).join('')).toContain('<p>');
  });

  it('PDF и DRM отказываются честно', async () => {
    await expect(openFile(new File(['%PDF'], 'book.pdf'))).rejects.toThrow(/PDF/);
    await expect(openFile(new File(['<x/>'], 'book.acsm'))).rejects.toThrow(/DRM/);
    await expect(openFile(new File(['?'], 'book.xyz'))).rejects.toThrow(/Unsupported/);
  });
});
