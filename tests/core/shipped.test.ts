// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { openFile } from '@/core/ingest';
import { demoLibrary } from '@/core/library/demo';
import {
  SHIPPED,
  SHIPPED_BASE,
  shippedByFile,
  shippedId,
  shippedLibrary,
} from '@/core/library/shipped';
import { isDerived } from '@/core/theme';

describe('книги из комплекта сайта', () => {
  beforeAll(() => {
    // Разбор EPUB жалуется в консоль на картинки, которые jsdom не декодирует.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('каждая лежит в public/demo и открывается тем же конвейером, что EPUB с диска', async () => {
    for (const book of SHIPPED) {
      const path = `public${SHIPPED_BASE}${book.file}`;
      expect(existsSync(path), path).toBe(true);

      const doc = await openFile(new File([readFileSync(path)], book.file));
      expect(doc.format).toBe('epub');
      expect([doc.title, doc.author, doc.language]).toEqual([book.title, book.author, book.language]);
      // Каталожное число знаков — то, что насчитал конвейер. Разошлись —
      // значит, файл подменили, и каталог надо обновить вместе с ним.
      expect(doc.charCount, book.file).toBe(book.chars);
      expect(doc.chapters.length).toBeGreaterThan(3);
      expect(doc.toc.length).toBeGreaterThan(3);
      // Предупреждения о картинках здесь ожидаемы: jsdom их не декодирует.
      // Любое другое — дефект файла или разбора.
      expect(doc.warnings.filter((w) => !w.code.startsWith('image-'))).toEqual([]);
    }
  }, 120_000);

  it('запись: идентификатор из имени файла, корешок под цвет обложки', () => {
    const records = shippedLibrary();
    expect(new Set(records.map((r) => r.id)).size).toBe(SHIPPED.length);

    records.forEach((record, i) => {
      const book = SHIPPED[i];
      expect(record.id).toBe(shippedId(book));
      expect(record.source).toEqual({ kind: 'shipped', file: book.file });
      expect(record.format).toBe('epub');
      expect(record.charCount).toBe(book.chars);
      expect(record.pages).toBeNull();
      // Цвет взят с обложки, а не выведен из названия — как у EPUB с диска.
      expect(isDerived(record.theme, `${record.title}|${record.author}`)).toBe(false);
    });

    expect(shippedByFile(SHIPPED[0].file)).toBe(SHIPPED[0]);
    expect(shippedByFile('gone.epub')).toBeUndefined();
  });

  it('стоят первыми на демо-полке; всего сорок томов и тетрадь', () => {
    const shelf = demoLibrary();
    const volumes = shelf.filter((v) => v.kind === 'volume');

    expect(volumes.slice(0, SHIPPED.length).map((v) => v.source.kind)).toEqual(
      SHIPPED.map(() => 'shipped'),
    );
    expect(volumes).toHaveLength(40);
    expect(shelf.filter((v) => v.kind === 'journal')).toHaveLength(1);

    // Порядок поступления — порядок на полке, без дыр и повторов.
    expect(volumes.map((v) => v.addedAt)).toEqual(volumes.map((_, i) => i));
    expect(new Set(shelf.map((v) => v.id)).size).toBe(shelf.length);
  });
});
