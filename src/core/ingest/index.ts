/**
 * Единая точка входа для контента: файл → `ContentDoc`.
 *
 * Всё разбирается в браузере. Это не оптимизация, а следствие архитектуры:
 * функции Vercel живут секунды и не имеют диска, так что книге там просто негде
 * пройти обработку (SPEC §15.1). Заодно файл никуда не уходит — local-first
 * получается не лозунгом, а прямым следствием ограничений платформы.
 */
import { docStats, type ContentDoc } from '../content';
import { generateBook, type SyntheticOptions } from '../text/synthetic';
import { readEpub, type IngestProgress } from './epub';
import { readPlain } from './plain';

export type { IngestProgress };

/** Выше этого браузер начнёт задыхаться на распаковке ещё до вёрстки. */
const MAX_BYTES = 80 * 1024 * 1024;
/** Выше этого книга откроется, но не мгновенно — стоит предупредить. */
const SLOW_BYTES = 20 * 1024 * 1024;

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export async function openFile(file: File, onProgress?: IngestProgress): Promise<ContentDoc> {
  if (file.size > MAX_BYTES) {
    throw new Error(
      `${(file.size / 1024 / 1024).toFixed(0)} MB is past the ${MAX_BYTES / 1024 / 1024} MB limit for in-browser composition.`,
    );
  }

  const ext = extensionOf(file.name);
  let doc: ContentDoc;

  switch (ext) {
    case 'epub':
      doc = await readEpub(file, onProgress);
      break;
    case 'txt':
      doc = await readPlain(file, 'txt');
      break;
    case 'md':
    case 'markdown':
      doc = await readPlain(file, 'md');
      break;
    case 'pdf':
      // PDF не перевёрстывается: страница там растр или вектор с зафиксированной
      // вёрсткой, и кегль на толщину тома влиять перестаёт — то есть отваливается
      // главная механика. Отложено осознанно (SPEC §21.3).
      throw new Error('PDF is not supported yet — its pages cannot be recomposed.');
    case 'acsm':
      throw new Error('This is a DRM license file, not a book.');
    default:
      if (file.type.startsWith('text/')) {
        doc = await readPlain(file, 'txt');
        break;
      }
      throw new Error(`Unsupported format: .${ext || file.type || 'unknown'}`);
  }

  if (file.size > SLOW_BYTES) {
    doc.warnings.unshift({
      code: 'large-file',
      message: `${(file.size / 1024 / 1024).toFixed(1)} MB — composing this may take a few seconds.`,
    });
  }

  return doc;
}

/**
 * Синтетика в том же виде, что и книга с диска.
 *
 * Не тестовая заглушка сбоку: демонстрационный том проходит ровно тот же
 * конвейер, что и загруженный EPUB. Разойдись эти два пути — расхождение
 * вылезло бы там, где его труднее всего искать.
 */
export function syntheticDoc(options: SyntheticOptions = {}): ContentDoc {
  const started = performance.now();
  const book = generateBook(options);
  const stats = docStats(book.chapters);

  return {
    id: 'synthetic',
    format: 'synthetic',
    title: book.title,
    author: book.author,
    language: 'en',
    chapters: book.chapters,
    toc: book.chapters.map((c, index) => ({
      id: `toc-${index}`,
      title: c.title,
      chapterId: c.id,
      depth: 0,
    })),
    charCount: stats.charCount,
    imageCount: 0,
    imageBytes: 0,
    sourceBytes: 0,
    warnings: [],
    tookMs: performance.now() - started,
  };
}
