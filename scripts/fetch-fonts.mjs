/**
 * Забирает шрифты с Google Fonts и раскладывает их по public/fonts вместе с манифестом.
 *
 * Зачем скрипт, а не next/font: шрифты книги нужно инлайнить в SVG при растеризации
 * страниц (см. SPEC §6.4), поэтому нужны сами файлы и — главное — их unicode-range.
 * Манифест позволяет вшивать в каждую страницу только те подмножества, которые она
 * реально использует: страница на русском тянет ~25 КБ кириллицы вместо всего набора.
 *
 * Все шрифты под SIL OFL — встраивание разрешено.
 *
 *   node scripts/fetch-fonts.mjs            # докачать, если чего-то нет
 *   node scripts/fetch-fonts.mjs --force    # забрать заново
 *
 * Скрипт стоит в `prebuild`: шрифты не лежат в репозитории, и на Vercel их
 * некому положить, кроме сборки. Локально сборка от этого не должна ходить в
 * сеть каждый раз, поэтому при полном комплекте скрипт молча выходит.
 */
import { access, mkdir, writeFile, readdir, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');

// UA нужен, чтобы Google отдал woff2, а не ttf.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Подмножества, которые нам нужны. Остальные (греческий, вьетнамский) пропускаем. */
const WANTED = new Set(['latin', 'latin-ext', 'cyrillic']);

/** Что качаем. Literata — текст книги, Inter — интерфейс. */
/**
 * Обе гарнитуры на Google Fonts существуют только как variable, и Google обрезает
 * ось wght по запросу: `wght@400` отдаёт 46 КБ без оси (полужирный будет
 * синтетическим), `wght@400..700` — 86 КБ с настоящей осью.
 *
 * Отсюда компромисс: прямому начертанию ось нужна (заголовки), курсиву — нет,
 * полужирный курсив в книжном тексте почти не встречается. Экономит 39 КБ
 * на каждой странице, где есть курсив.
 */
const FAMILIES = [
  {
    slug: 'literata',
    role: 'body',
    css: 'family=Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400',
    weightRange: { normal: '400 700', italic: '400 400' },
  },
  {
    slug: 'inter',
    role: 'ui',
    css: 'family=Inter:wght@400..600',
    weightRange: { normal: '400 600' },
  },
];

/** Классификация подмножества по сигнатуре unicode-range Google Fonts. */
function classifySubset(range) {
  const first = range.trim().split(',')[0].trim().toUpperCase();
  if (first.startsWith('U+0460')) return 'cyrillic-ext';
  if (first.startsWith('U+0301')) return 'cyrillic';
  if (first.startsWith('U+1F00')) return 'greek-ext';
  if (first.startsWith('U+0370')) return 'greek';
  if (first.startsWith('U+0102')) return 'vietnamese';
  if (first.startsWith('U+0100')) return 'latin-ext';
  if (first.startsWith('U+0000')) return 'latin';
  return 'unknown';
}

function parseFaces(css) {
  const faces = [];
  for (const block of css.split('@font-face').slice(1)) {
    const pick = (re) => block.match(re)?.[1]?.trim();
    const url = pick(/src:\s*url\((https:\/\/[^)]+)\)/);
    const range = pick(/unicode-range:\s*([^;]+);/);
    if (!url || !range) continue;
    faces.push({
      family: pick(/font-family:\s*'([^']+)'/) ?? 'unknown',
      style: pick(/font-style:\s*([^;]+);/) ?? 'normal',
      weight: Number(pick(/font-weight:\s*([\d]+);/) ?? 400),
      unicodeRange: range.replace(/\s+/g, ' '),
      subset: classifySubset(range),
      url,
    });
  }
  return faces;
}

/** Все файлы из манифеста на месте? Тогда качать нечего. */
async function complete() {
  try {
    const manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8'));
    if (!Array.isArray(manifest) || manifest.length === 0) return false;
    for (const face of manifest) await access(join(OUT, face.file));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!process.argv.includes('--force') && (await complete())) {
    console.log('fonts: already fetched (use --force to refetch)');
    return;
  }

  await mkdir(OUT, { recursive: true });

  // Чистим прошлый заход, чтобы не копить осиротевшие файлы.
  for (const f of await readdir(OUT).catch(() => [])) {
    if (f.endsWith('.woff2') || f === 'manifest.json') await unlink(join(OUT, f));
  }

  const manifest = [];

  for (const family of FAMILIES) {
    const res = await fetch(`https://fonts.googleapis.com/css2?${family.css}&display=swap`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`CSS ${family.slug}: HTTP ${res.status}`);

    const seen = new Set();

    for (const face of parseFaces(await res.text())) {
      if (!WANTED.has(face.subset)) continue;

      const style = face.style === 'italic' ? 'italic' : 'roman';
      const file = `${family.slug}-${style}-${face.subset}.woff2`;
      if (seen.has(file)) continue;
      seen.add(file);

      const bin = await fetch(face.url, { headers: { 'User-Agent': UA } });
      if (!bin.ok) throw new Error(`${file}: HTTP ${bin.status}`);
      const bytes = Buffer.from(await bin.arrayBuffer());
      await writeFile(join(OUT, file), bytes);

      manifest.push({
        file,
        role: family.role,
        family: face.family,
        style: face.style,
        weightRange: family.weightRange[face.style] ?? '400 400',
        subset: face.subset,
        unicodeRange: face.unicodeRange,
        bytes: bytes.length,
      });
      console.log(`  ${String(bytes.length).padStart(7)}  ${file}`);
    }
  }

  manifest.sort((a, b) => a.file.localeCompare(b.file));
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const total = manifest.reduce((n, m) => n + m.bytes, 0);
  console.log(`\n${manifest.length} файлов, ${(total / 1024).toFixed(0)} КБ, манифест записан.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
