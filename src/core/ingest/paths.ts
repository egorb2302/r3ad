/**
 * Пути внутри архива.
 *
 * Внутри EPUB всё относительно: OPF ссылается на главы от своей папки, глава на
 * картинки — от своей. Своя реализация, а не `new URL()`, потому что архивные
 * пути не адреса: у них нет схемы и хоста, а `URL` требует и то и другое.
 */

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** Всё после # — якорь внутри документа, к имени файла он не относится. */
export function stripFragment(path: string): string {
  const i = path.indexOf('#');
  return i < 0 ? path : path.slice(0, i);
}

export function fragment(path: string): string {
  const i = path.indexOf('#');
  return i < 0 ? '' : path.slice(i + 1);
}

/** Ссылка наружу архива — её мы не разрешаем и не грузим. */
export const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

/** Проценты в путях встречаются, но не в именах записей zip. */
export function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Склеить относительную ссылку с папкой, свернув `.` и `..`. */
export function joinPath(baseDir: string, href: string): string {
  const clean = stripFragment(href);
  if (isExternal(clean)) return clean;

  const raw = clean.startsWith('/')
    ? clean.slice(1)
    : baseDir
      ? `${baseDir}/${clean}`
      : clean;

  const out: string[] = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
