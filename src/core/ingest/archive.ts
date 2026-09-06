/**
 * Доступ к записям zip с поправкой на реальность.
 *
 * Путь из OPF совпадает с именем записи в архиве далеко не всегда: встречаются
 * проценты в ссылках, расхождение регистра (архив собран на Windows, читается
 * везде), лишний `./` в начале. Каждый такой случай — не «битый файл», а книга,
 * которую все остальные читалки открывают.
 *
 * Поэтому поиск идёт лесенкой от точного совпадения к всё более вольному, и
 * вызывающий узнаёт, на какой ступени нашлось: последняя, по одному имени
 * файла, вполне может промахнуться, и об этом стоит предупредить.
 */
import type JSZip from 'jszip';
import { basename, safeDecode, stripFragment } from './paths';

export interface Found {
  entry: JSZip.JSZipObject;
  /** true — совпал не путь, а только имя файла. Повод для предупреждения. */
  fuzzy: boolean;
}

export class Archive {
  private byPath = new Map<string, JSZip.JSZipObject>();
  private byLower = new Map<string, JSZip.JSZipObject>();
  private byBase = new Map<string, JSZip.JSZipObject>();

  constructor(zip: JSZip) {
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      this.byPath.set(path, entry);
      this.byLower.set(path.toLowerCase(), entry);
      const base = basename(path).toLowerCase();
      // Первый выигрывает: при дубликатах имён верхний по архиву обычно основной.
      if (!this.byBase.has(base)) this.byBase.set(base, entry);
    });
  }

  find(path: string): Found | null {
    const clean = stripFragment(path);
    const decoded = safeDecode(clean);

    const exact =
      this.byPath.get(clean) ??
      this.byPath.get(decoded) ??
      this.byLower.get(clean.toLowerCase()) ??
      this.byLower.get(decoded.toLowerCase());
    if (exact) return { entry: exact, fuzzy: false };

    const loose = this.byBase.get(basename(decoded).toLowerCase());
    return loose ? { entry: loose, fuzzy: true } : null;
  }

  has(path: string): boolean {
    return this.find(path) !== null;
  }

  async text(path: string): Promise<string> {
    const found = this.find(path);
    if (!found) throw new Error(`Missing from the archive: ${path}`);
    return found.entry.async('text');
  }

  async bytes(path: string): Promise<Uint8Array> {
    const found = this.find(path);
    if (!found) throw new Error(`Missing from the archive: ${path}`);
    return found.entry.async('uint8array');
  }
}
