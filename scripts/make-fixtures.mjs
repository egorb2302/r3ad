/**
 * Генератор книг для проверки разбора.
 *
 *   node scripts/make-fixtures.mjs [каталог]
 *
 * Кладёт рядом три файла: EPUB 3 с навигационным документом, EPUB 2 с NCX и
 * плоский текст. Все три собраны не «как правильно», а как встречается в жизни,
 * и каждая ловушка здесь однажды ломала разбор:
 *
 * — проценты в ссылке из оглавления при обычном имени записи в архиве;
 * — расхождение регистра между NCX и манифестом (`text/` против `Text/`);
 * — обложка, отданная через `<svg><image>` вместо `<img>`;
 * — чужой CSS с `position:fixed`, который развалил бы разбивку на колонки;
 * — `<script>` в главе;
 * — иллюстрация 1600×1200, которую обязан ужать конвейер;
 * — вложенные navPoint и вложенный `<ol>` — проверка глубины оглавления.
 *
 * Файлы в репозиторий не кладутся: скрипт короче и честнее, чем бинарники,
 * а корпус из настоящих книг (SPEC §19) он всё равно не заменяет.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';

const JSZip = createRequire(import.meta.url)('jszip');

const OUT = process.argv[2] ?? '.fixtures';
mkdirSync(OUT, { recursive: true });

// ─── PNG-энкодер: градиент нужного размера ────────────────────────────────
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolor
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[p++] = Math.round((x / width) * 255);
      raw[p++] = Math.round((y / height) * 200) + 40;
      raw[p++] = 120;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lorem = (n, seed) => {
  const words = ('the quick spine folds against a warm lamp while margins keep their promise ' +
    'paper remembers pressure and ink settles into fibre a compositor counts lines ' +
    'not letters because the page is a measure of time not of space').split(' ');
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = [];
  for (let i = 0; i < n; i++) {
    const len = 12 + Math.floor(rnd() * 40);
    const parts = [];
    for (let j = 0; j < len; j++) parts.push(words[Math.floor(rnd() * words.length)]);
    const text = parts.join(' ');
    out.push(text.charAt(0).toUpperCase() + text.slice(1) + '.');
  }
  return out;
};

const chapterHtml = (title, seed, extras = '') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title><link rel="stylesheet" href="../styles/book.css"/></head>
<body>
  <section epub:type="chapter">
    <h1>${title}</h1>
    ${extras}
    ${lorem(26, seed).map((p, i) => `<p class="${i === 0 ? 'first' : ''}">${p} <em>Set in italics.</em> And <strong>bold</strong>.</p>`).join('\n    ')}
  </section>
  <script>alert('this must never run')</script>
</body></html>`;

// ─── EPUB 3 ───────────────────────────────────────────────────────────────
async function epub3() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);

  zip.file('OEBPS/styles/book.css', 'body{font-family:serif} .first{text-indent:0} p{position:fixed}');
  zip.file('OEBPS/images/plate.png', png(1600, 1200));
  zip.file('OEBPS/images/mark.png', png(64, 64));

  const table = `<table><tr><th>Sheet</th><th>mm</th></tr><tr><td>144</td><td>14.4</td></tr><tr><td>337</td><td>33.7</td></tr></table>`;
  const list = `<ul><li>First measure</li><li>Second measure</li><li>Third</li></ul>`;
  const quote = `<blockquote><p>A page is a measure of time.</p></blockquote>`;

  zip.file('OEBPS/text/cover.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head>
<body><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1600 1200">
<image width="1600" height="1200" xlink:href="../images/plate.png"/></svg></body></html>`);

  zip.file('OEBPS/text/ch1.xhtml', chapterHtml('The Compositor', 11, `<figure><img src="../images/plate.png" alt="A plate"/><figcaption>Plate I — the gradient</figcaption></figure>${list}`));
  zip.file('OEBPS/text/ch2.xhtml', chapterHtml('Kerning and Consequence', 22, table + quote));
  // Проценты в ссылке и другой регистр в имени записи — обе ловушки сразу.
  zip.file('OEBPS/text/Ch3 Notes.xhtml', chapterHtml('Notes on the Spine', 33, `<p><img src="../images/mark.png" alt="mark"/> inline mark.</p>`));
  zip.file('OEBPS/text/ch4.xhtml', chapterHtml('The Endpaper', 44));

  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body>
<nav epub:type="toc" id="toc"><ol>
  <li><a href="text/ch1.xhtml">The Compositor</a>
    <ol><li><a href="text/ch2.xhtml">Kerning and Consequence</a></li></ol>
  </li>
  <li><a href="text/Ch3%20Notes.xhtml">Notes on the Spine</a></li>
  <li><a href="text/ch4.xhtml">The Endpaper</a></li>
</ol></nav></body></html>`);

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:test-epub3</dc:identifier>
    <dc:title>Impression: an EPUB 3 fixture</dc:title>
    <dc:creator>A. Compositor</dc:creator>
    <dc:language>en-GB</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    <item id="plate" href="images/plate.png" media-type="image/png" properties="cover-image"/>
    <item id="mark" href="images/mark.png" media-type="image/png"/>
    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="text/Ch3%20Notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="c4" href="text/ch4.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
    <itemref idref="c4"/>
  </spine>
</package>`);

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(path.join(OUT, 'epub3.epub'), buf);
  return buf.length;
}

// ─── EPUB 2 ───────────────────────────────────────────────────────────────
async function epub2() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);

  zip.file('Images/front.png', png(600, 900));
  zip.file('Text/one.html', chapterHtml('Part One', 55));
  zip.file('Text/two.html', chapterHtml('Part Two', 66));
  zip.file('Text/three.html', chapterHtml('Part Three', 77));

  zip.file('toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="test-epub2"/></head>
<docTitle><text>Signature</text></docTitle>
<navMap>
  <navPoint id="n1" playOrder="1"><navLabel><text>Part One</text></navLabel><content src="text/one.html"/>
    <navPoint id="n1a" playOrder="2"><navLabel><text>Part Two</text></navLabel><content src="text/two.html"/></navPoint>
  </navPoint>
  <navPoint id="n2" playOrder="3"><navLabel><text>Part Three</text></navLabel><content src="text/three.html"/></navPoint>
</navMap></ncx>`);

  zip.file('content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="id" opf:scheme="UUID">test-epub2</dc:identifier>
    <dc:title>Signature</dc:title>
    <dc:creator opf:role="aut">B. Binder</dc:creator>
    <dc:language>en</dc:language>
    <!-- EPUB 2 объявляет обложку так: метатегом со ссылкой на элемент манифеста -->
    <meta name="cover" content="front"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="front" href="Images/front.png" media-type="image/png"/>
    <item id="one" href="Text/one.html" media-type="application/xhtml+xml"/>
    <item id="two" href="Text/two.html" media-type="application/xhtml+xml"/>
    <item id="three" href="Text/three.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="one"/><itemref idref="two"/><itemref idref="three"/>
  </spine>
</package>`);

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(path.join(OUT, 'epub2.epub'), buf);
  return buf.length;
}

// ─── Плоский текст ────────────────────────────────────────────────────────
function plain() {
  const parts = [];
  for (let c = 1; c <= 4; c++) {
    parts.push(`CHAPTER ${c}`);
    parts.push(...lorem(18, c * 7));
  }
  writeFileSync(path.join(OUT, 'plain.txt'), parts.join('\n\n'), 'utf8');
}

console.log('epub3', await epub3(), 'bytes');
console.log('epub2', await epub2(), 'bytes');
plain();
console.log('done ->', OUT);
