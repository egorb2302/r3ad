import { describe, expect, it } from 'vitest';
import { docStats } from '@/core/content';
import { syntheticDoc } from '@/core/ingest';
import { generateBook, optionsForExtent } from '@/core/text/synthetic';

describe('синтетический текст', () => {
  it('воспроизводится по зерну посимвольно', () => {
    expect(generateBook({ seed: 7, chapters: 4, paragraphsPerChapter: 5 })).toEqual(
      generateBook({ seed: 7, chapters: 4, paragraphsPerChapter: 5 }),
    );
    expect(generateBook({ seed: 7, chapters: 2 }).chapters[0].html).not.toBe(
      generateBook({ seed: 8, chapters: 2 }).chapters[0].html,
    );
  });

  it('число глав и подписи — из настроек', () => {
    const book = generateBook({ chapters: 6, paragraphsPerChapter: 3, title: 'Ligature', author: 'r3' });
    expect(book.chapters).toHaveLength(6);
    expect(book.title).toBe('Ligature');
    expect(book.author).toBe('r3');
  });

  it('обратный ход: настройки под объём дают книгу примерно того объёма', () => {
    for (const target of [60_000, 300_000, 1_200_000]) {
      const options = optionsForExtent(target, { seed: 1, title: 'T', author: 'A' });
      expect(options.chapters).toBeGreaterThanOrEqual(3);
      expect(options.chapters).toBeLessThanOrEqual(48);

      const { charCount } = docStats(generateBook(options).chapters);
      expect(Math.abs(charCount - target) / target, `${target}`).toBeLessThan(0.2);
    }
  });

  it('синтетика проходит тем же конвейером, что и файл', () => {
    const doc = syntheticDoc({ seed: 3, chapters: 5, paragraphsPerChapter: 4 }, 'demo');
    expect(doc.id).toBe('demo');
    expect(doc.format).toBe('synthetic');
    expect(doc.toc).toHaveLength(5);
    expect(doc.toc.map((t) => t.chapterId)).toEqual(doc.chapters.map((c) => c.id));
    expect(doc.charCount).toBe(docStats(doc.chapters).charCount);
    expect(doc.imageCount).toBe(0);
  });
});
