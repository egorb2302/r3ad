/**
 * Плоский режим: та же книга, набранная обычным HTML (SPEC §17).
 *
 * Здесь лежит то, что от React и от DOM не зависит: стили колонки, перевод
 * «страница ↔ глава» и поиск по тексту. Сам вид — в `ui/plain`.
 *
 * Плоский режим намеренно не притворяется страницей. Соблазн был: композитор
 * уже верстает колонку нужной ширины, и можно было бы показать ровно ту же
 * полосу, только без 3D. Но полоса посчитана под лист 148×210 мм, а читают её в
 * окне произвольной формы — на телефоне такая страница либо не помещается, либо
 * набрана шестью пунктами. Поэтому здесь другая мера строки и другой ритм, а
 * общее у режимов — набор: гарнитура, кегль, интерлиньяж, выключка, переносы и
 * бумага. Кегль при этом один и тот же, и это видно: в 3D он делает книгу
 * толще, здесь — крупнее.
 *
 * Второе назначение — деградация. Нет WebGL2, слабая видеокарта, отключённая
 * анимация, скринридер, `Ctrl+F` — всё это ведёт сюда, и потому режим обязан
 * работать без сцены вообще: ни одного импорта three в этой ветке.
 */
import type { Chapter } from './content';
import type { ChapterSpan, PaginationResult } from './paginate/paginate';
import type { PaperStock } from './theme';
import type { Typography } from './typography';

/**
 * Из пунктов на бумаге в пиксели на экране.
 *
 * Кегль книги задан в пунктах при 148 мм ширины полосы; на экране те же 10.5 pt
 * дали бы 14 px — мелко для чтения с расстояния вытянутой руки. Множитель
 * подобран так, чтобы дефолтные 10.5 pt превратились в 18 px, то есть в обычный
 * размер веб-текста, и чтобы ползунок кегля вёл сюда без отдельной настройки.
 */
export const PLAIN_SCALE = 1.72;

export const plainFontPx = (t: Typography) => Math.round(t.sizePt * PLAIN_SCALE * 10) / 10;

/**
 * Мера строки в кеглях.
 *
 * 34 em — примерно 65 знаков, та же цель, что и у наборной полосы книги. На
 * узком экране колонка сжимается сама: ограничение стоит потолком, а не
 * шириной.
 */
const MEASURE_EM = 34;

/**
 * Стили читаемой колонки.
 *
 * Отдельные от `pageCss` намеренно. Тот CSS — единственный источник правды для
 * пары «композитор ↔ растр», и они обязаны совпадать пиксель в пиксель; сюда же
 * приезжает та же книга, но в другую среду, где нет ни колонок фиксированной
 * высоты, ни полей под корешок, ни колонцифры. Свести их в один файл значило бы
 * связать вёрстку страницы с вёрсткой экрана и однажды сдвинуть разбивку,
 * поправив отступ в читалке.
 */
export function plainCss(t: Typography, paper: PaperStock): string {
  const px = plainFontPx(t);
  const line = px * t.leading;
  const indent = t.indentEm > 0 ? `text-indent:${t.indentEm}em;margin-bottom:0` : `text-indent:0;margin-bottom:${(line * 0.5).toFixed(2)}px`;

  return `
.r3ad-plain{
  font-family:'${t.family}', Georgia, serif;
  font-size:${px}px;
  line-height:${line.toFixed(2)}px;
  color:${paper.ink};
  text-align:${t.justify ? 'justify' : 'left'};
  text-align-last:left;
  hyphens:${t.hyphens ? 'auto' : 'manual'};
  -webkit-hyphens:${t.hyphens ? 'auto' : 'manual'};
  orphans:2;
  widows:2;
  font-kerning:normal;
  max-width:${MEASURE_EM}em;
  margin:0 auto;
  padding:${(line * 2).toFixed(2)}px 20px ${(line * 6).toFixed(2)}px;
}
.r3ad-plain :where(p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,figure,table,hr){margin:0;padding:0}
.r3ad-plain p{${indent}}
.r3ad-plain p.first,
.r3ad-plain h1 + p,
.r3ad-plain h2 + p,
.r3ad-plain h3 + p,
.r3ad-plain blockquote p:first-child,
.r3ad-plain li p{text-indent:0}
.r3ad-plain h1{
  font-size:${(px * 1.6).toFixed(2)}px;
  line-height:${(line * 1.5).toFixed(2)}px;
  font-weight:600;
  margin:${(line * 2).toFixed(2)}px 0 ${line.toFixed(2)}px;
  text-align:left;
  letter-spacing:0.01em;
}
.r3ad-plain h2{
  font-size:${(px * 1.2).toFixed(2)}px;
  line-height:${(line * 1.25).toFixed(2)}px;
  font-weight:600;
  margin:${(line * 1.5).toFixed(2)}px 0 ${(line * 0.25).toFixed(2)}px;
  text-align:left;
}
.r3ad-plain h3,.r3ad-plain h4,.r3ad-plain h5,.r3ad-plain h6{
  font-size:${(px * 1.05).toFixed(2)}px;
  line-height:${line.toFixed(2)}px;
  font-weight:600;
  margin:${line.toFixed(2)}px 0 0;
  text-align:left;
}
.r3ad-plain em,.r3ad-plain i{font-style:italic}
.r3ad-plain strong,.r3ad-plain b{font-weight:600}
.r3ad-plain a{color:inherit;text-underline-offset:0.18em}
.r3ad-plain blockquote{
  margin:${line.toFixed(2)}px ${(px * 1.6).toFixed(2)}px;
  font-style:italic;
}
.r3ad-plain img{
  display:block;
  max-width:100%;
  height:auto;
  margin:${line.toFixed(2)}px auto;
}
.r3ad-plain figure{margin:${line.toFixed(2)}px 0}
.r3ad-plain figcaption{
  text-indent:0;
  text-align:center;
  font-size:${(px * 0.84).toFixed(2)}px;
  line-height:${(line * 0.86).toFixed(2)}px;
  opacity:0.68;
}
.r3ad-plain ul,.r3ad-plain ol{margin:${(line * 0.5).toFixed(2)}px 0 ${(line * 0.5).toFixed(2)}px ${(px * 1.6).toFixed(2)}px}
.r3ad-plain li{text-indent:0;text-align:left}
.r3ad-plain ul{list-style:disc}
.r3ad-plain ol{list-style:decimal}
.r3ad-plain hr{border:0;border-top:1px solid currentColor;opacity:0.22;margin:${(line * 1.5).toFixed(2)}px 22%}
.r3ad-plain pre{
  white-space:pre-wrap;
  text-indent:0;
  text-align:left;
  font-family:'JetBrains Mono', ui-monospace, monospace;
  font-size:${(px * 0.8).toFixed(2)}px;
  line-height:${(line * 0.9).toFixed(2)}px;
  margin:${(line * 0.5).toFixed(2)}px 0;
  overflow-x:auto;
}
.r3ad-plain code{font-family:'JetBrains Mono', ui-monospace, monospace;font-size:0.84em}
.r3ad-plain table{
  width:100%;
  border-collapse:collapse;
  text-indent:0;
  font-size:${(px * 0.9).toFixed(2)}px;
  margin:${(line * 0.5).toFixed(2)}px 0;
}
.r3ad-plain td,.r3ad-plain th{
  border:1px solid currentColor;
  padding:0.22em 0.4em;
  text-indent:0;
  text-align:left;
  vertical-align:top;
}
.r3ad-plain sup,.r3ad-plain sub{font-size:0.7em;line-height:0}
/*
 * Узкий экран отменяет выключку по формату.
 *
 * Выключка равняет правый край, растягивая пробелы, и на длинной строке этого
 * не видно. На телефоне в строке помещается слов пять, растягивать приходится
 * втрое, и посреди абзаца встают белые реки. Настройку человека мы при этом не
 * трогаем: она про книгу, а это про то, что строка кончилась раньше.
 */
@media (max-width: 30em){
  .r3ad-plain{text-align:left;hyphens:auto;-webkit-hyphens:auto}
}
/* Найденное поиском. Тот же жёлтый, что и у тиснения, — других красок тут нет. */
.r3ad-plain mark{background:#d9a44133;color:inherit;border-radius:2px}
.r3ad-plain mark.here{background:#d9a441;color:#17140f}
`.trim();
}

/* ─── Где мы в книге ─────────────────────────────────────────────────────── */

/**
 * Глава, которой принадлежит страница.
 *
 * Переход между режимами держится на этих двух функциях: из 3D в плоский режим
 * человек приезжает в ту главу, которую читал, и обратно — на её страницу. До
 * строки довести нельзя, и причина не в лени: содержимое колонки браузер наружу
 * не отдаёт (§6.4), поэтому «страница 114» и «вот это место в тексте» — разные
 * величины, и между ними есть только глава.
 */
export function chapterAtPage(
  pagination: PaginationResult | null,
  page: number,
): ChapterSpan | null {
  if (!pagination) return null;
  return pagination.chapters.findLast((c) => c.startPage <= page) ?? null;
}

export function pageOfChapter(
  pagination: PaginationResult | null,
  chapterId: string,
): number | null {
  const span = pagination?.chapters.find((c) => c.id === chapterId);
  return span ? span.startPage : null;
}

/* ─── Поиск по книге ─────────────────────────────────────────────────────── */

export interface Hit {
  chapterId: string;
  title: string;
  /** Страница, с которой начинается глава, — до строки в 3D дойти нечем. */
  page: number | null;
  /** Порядковый номер совпадения внутри главы: по нему подсвечивается нужное. */
  nth: number;
  before: string;
  match: string;
  after: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

/**
 * Текст главы без разметки.
 *
 * Теги заменяются пробелом, а не пустой строкой: `<p>конец</p><p>начало</p>`
 * без пробела склеивается в «конецначало», и поиск находит слова, которых в
 * книге нет.
 */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Сколько знаков контекста показывать вокруг найденного. */
const CONTEXT = 42;

/**
 * Поиск по книге. Регистронезависимый, по подстроке.
 *
 * Не по словам и без морфологии: книга может быть на любом языке, а словарь
 * форм — это словарь на каждый язык. Подстрока при этом честно находит и
 * «книг», и «книгами», чего для поиска по тому, что читаешь, обычно достаточно.
 */
export function searchDoc(
  chapters: Chapter[],
  pagination: PaginationResult | null,
  query: string,
  limit = 60,
): Hit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const hits: Hit[] = [];
  for (const chapter of chapters) {
    const text = plainText(chapter.html);
    const haystack = text.toLowerCase();

    let from = 0;
    let nth = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;

      hits.push({
        chapterId: chapter.id,
        title: chapter.title,
        page: pageOfChapter(pagination, chapter.id),
        nth,
        before: (at > CONTEXT ? '…' : '') + text.slice(Math.max(0, at - CONTEXT), at),
        match: text.slice(at, at + needle.length),
        after:
          text.slice(at + needle.length, at + needle.length + CONTEXT) +
          (at + needle.length + CONTEXT < text.length ? '…' : ''),
      });

      nth += 1;
      from = at + needle.length;
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
