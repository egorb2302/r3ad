/**
 * Инлайн шрифтов в SVG.
 *
 * Внешние @font-face внутри foreignObject не загружаются — SVG рендерится в
 * изоляции, без доступа к сети документа. Поэтому шрифт приходится вшивать
 * в разметку как data-URI.
 *
 * Наивный вариант — вшить весь набор — стоит ~460 КБ на каждую страницу.
 * Вместо этого смотрим, какие символы и начертания реально есть на странице, и
 * вшиваем только их: страница на русском тянет кириллицу и латиницу (в ней
 * знаки препинания), но не греческий, не вьетнамский и не курсив, если курсива
 * на ней нет.
 *
 * Что шрифты именно вшиваются, а не берутся из документа, проверено замером:
 * гарнитура, зарегистрированная через document.fonts, внутри SVG-картинки
 * недоступна — текст молча раскладывается запасным serif.
 */

export interface FontEntry {
  file: string;
  role: 'body' | 'ui';
  family: string;
  style: string;
  weightRange: string;
  subset: string;
  unicodeRange: string;
  bytes: number;
}

type Range = [number, number];

let manifestPromise: Promise<FontEntry[]> | null = null;
const base64Cache = new Map<string, string>();
const rangeCache = new Map<string, Range[]>();

export function loadFontManifest(): Promise<FontEntry[]> {
  manifestPromise ??= fetch('/fonts/manifest.json').then((r) => {
    if (!r.ok) throw new Error(`Missing /fonts/manifest.json (HTTP ${r.status}). Run: node scripts/fetch-fonts.mjs`);
    return r.json() as Promise<FontEntry[]>;
  });
  return manifestPromise;
}

/** "U+0400-045F, U+2116" → [[0x400,0x45f],[0x2116,0x2116]] */
export function parseUnicodeRange(spec: string): Range[] {
  const cached = rangeCache.get(spec);
  if (cached) return cached;

  const out: Range[] = [];
  for (const part of spec.split(',')) {
    const token = part.trim().replace(/^U\+/i, '');
    if (!token) continue;
    if (token.includes('-')) {
      const [a, b] = token.split('-');
      out.push([parseInt(a, 16), parseInt(b, 16)]);
    } else if (token.includes('?')) {
      // Форма вида 04?? — маска на младшие разряды.
      out.push([parseInt(token.replace(/\?/g, '0'), 16), parseInt(token.replace(/\?/g, 'F'), 16)]);
    } else {
      const cp = parseInt(token, 16);
      out.push([cp, cp]);
    }
  }
  rangeCache.set(spec, out);
  return out;
}

const inRanges = (cp: number, ranges: Range[]) =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

/** Уникальные кодовые точки текста. Пробелы и переводы строк отбрасываем. */
function codepoints(text: string): Set<number> {
  const set = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 32) set.add(cp);
  }
  return set;
}

export type FontStyle = 'normal' | 'italic';

/**
 * Начертания, без которых страница не отрисуется.
 *
 * Фильтруем по двум осям сразу. Только по unicode-range недостаточно: курсивные
 * файлы перекрывают те же диапазоны, что и прямые, и страница без единого
 * курсива утаскивала бы в разметку лишние 74 КБ шрифтов.
 */
export function selectSubsets(
  text: string,
  entries: FontEntry[],
  styles: ReadonlySet<FontStyle> = new Set<FontStyle>(['normal']),
): FontEntry[] {
  const cps = [...codepoints(text)];
  return entries.filter((entry) => {
    if (!styles.has(entry.style === 'italic' ? 'italic' : 'normal')) return false;
    const ranges = parseUnicodeRange(entry.unicodeRange);
    return cps.some((cp) => inRanges(cp, ranges));
  });
}

async function toBase64(file: string): Promise<string> {
  const cached = base64Cache.get(file);
  if (cached) return cached;

  const res = await fetch(`/fonts/${file}`);
  if (!res.ok) throw new Error(`Font ${file}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  // btoa не принимает большие строки целиком — режем на куски.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary);
  base64Cache.set(file, b64);
  return b64;
}

export interface FontCssResult {
  css: string;
  /** Что вшили — для отладочного HUD и для замеров. */
  files: string[];
  bytes: number;
}

/**
 * Собрать @font-face с data-URI для тех подмножеств, которые нужны этому тексту.
 * Файлы кэшируются в base64, так что со второй страницы это чистая склейка строк.
 */
export async function fontCssForText(
  text: string,
  role: FontEntry['role'] = 'body',
  styles: ReadonlySet<FontStyle> = new Set<FontStyle>(['normal']),
): Promise<FontCssResult> {
  const manifest = await loadFontManifest();
  const candidates = manifest.filter((e) => e.role === role);
  const needed = selectSubsets(text, candidates, styles);

  const blocks = await Promise.all(
    needed.map(async (entry) => {
      const b64 = await toBase64(entry.file);
      /*
       * font-display: swap — не стилистический выбор, а единственный работающий.
       *
       * Замерено в M0: внутри SVG-картинки при block и при auto (значение по
       * умолчанию) текст не рисуется вообще. Шрифт с data-URI не успевает
       * стать «готовым» к единственному проходу отрисовки, а block означает
       * «пока не готов — не показывай». Страница выходила чистым фоном.
       *
       * При swap вшитый шрифт применяется на месте: контрольная строка даёт
       * 2126 закрашенных пикселей против 1568 у запасного serif и 1893 у
       * Georgia — то есть подставляется именно Literata, а не замена.
       */
      return (
        `@font-face{font-family:'${entry.family}';font-style:${entry.style};` +
        `font-weight:${entry.weightRange};font-display:swap;` +
        `src:url(data:font/woff2;base64,${b64}) format('woff2');` +
        `unicode-range:${entry.unicodeRange}}`
      );
    }),
  );

  return {
    css: blocks.join('\n'),
    files: needed.map((e) => e.file),
    bytes: needed.reduce((n, e) => n + e.bytes, 0),
  };
}

/**
 * Зарегистрировать шрифты в самом документе — нужно композитору, иначе браузер
 * разложит текст запасным шрифтом и разбивка на страницы не совпадёт с растром.
 */
export async function ensureDocumentFonts(role: FontEntry['role'] = 'body'): Promise<void> {
  const manifest = await loadFontManifest();
  await Promise.all(
    manifest
      .filter((e) => e.role === role)
      .map(async (entry) => {
        const face = new FontFace(entry.family, `url(/fonts/${entry.file}) format('woff2')`, {
          style: entry.style,
          weight: entry.weightRange,
          unicodeRange: entry.unicodeRange,
          display: 'block',
        });
        await face.load();
        document.fonts.add(face);
      }),
  );
  await document.fonts.ready;
}
