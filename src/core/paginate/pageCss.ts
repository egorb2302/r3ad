/**
 * Единственный источник правды по вёрстке страницы.
 *
 * Одна и та же строка CSS применяется в двух местах: в скрытом композиторе, где
 * браузер считает разбивку на страницы, и внутри SVG при растеризации. Если бы
 * они разошлись, растр не совпал бы с DOM-слоем, который подставляется в покое
 * (SPEC §6.4), и подмена стала бы заметной.
 */
import type { PageMetrics, Typography } from '../typography';

export function pageCss(m: PageMetrics, t: Typography): string {
  const indent = t.indentEm > 0 ? `text-indent:${t.indentEm}em` : 'text-indent:0';
  const spacing = t.indentEm > 0 ? '0' : `${(m.lineHeightPx * 0.5).toFixed(2)}px`;

  return `
.r3ad-clip{
  box-sizing:border-box;
  overflow:hidden;
  position:relative;
}
.r3ad-flow{
  font-family:'${t.family}', Georgia, serif;
  font-size:${m.fontSizePx.toFixed(3)}px;
  line-height:${m.lineHeightPx.toFixed(3)}px;
  font-weight:400;
  color:#1b1712;
  text-align:${t.justify ? 'justify' : 'left'};
  text-align-last:left;
  hyphens:${t.hyphens ? 'auto' : 'manual'};
  -webkit-hyphens:${t.hyphens ? 'auto' : 'manual'};
  orphans:2;
  widows:2;
  /*
   * Ни text-rendering:optimizeLegibility, ни font-variant-numeric на всей
   * полосе. Оба включают полный проход OpenType-шейпинга по каждому символу и
   * вместе стоят 45% времени вёрстки главы (16.4 мс против 8.9 на замере M0),
   * а платим мы за них дважды: при разбивке и при растеризации каждой страницы.
   * Старостильные цифры остались там, где действительно видны, — в колонцифре.
   */
  font-kerning:normal;
}
.r3ad-flow *{margin:0;padding:0;box-sizing:border-box}
.r3ad-flow p{${indent};margin-bottom:${spacing}}
.r3ad-flow p.first,
.r3ad-flow h1 + p,
.r3ad-flow h2 + p{text-indent:0}
.r3ad-flow h1{
  font-size:${(m.fontSizePx * 1.6).toFixed(3)}px;
  line-height:${(m.lineHeightPx * 2).toFixed(3)}px;
  font-weight:600;
  margin:${(m.lineHeightPx * 2).toFixed(3)}px 0 ${m.lineHeightPx.toFixed(3)}px;
  break-after:avoid;
  text-align:left;
  letter-spacing:0.01em;
}
.r3ad-flow h2{
  font-size:${(m.fontSizePx * 1.15).toFixed(3)}px;
  line-height:${m.lineHeightPx.toFixed(3)}px;
  font-weight:600;
  margin:${m.lineHeightPx.toFixed(3)}px 0 0;
  break-after:avoid;
  text-align:left;
}
.r3ad-flow em,.r3ad-flow i{font-style:italic}
.r3ad-flow strong,.r3ad-flow b{font-weight:600}
.r3ad-flow blockquote{
  margin:${m.lineHeightPx.toFixed(3)}px ${(m.fontSizePx * 2).toFixed(3)}px;
  font-style:italic;
}
.r3ad-flow blockquote p{text-indent:0}
.r3ad-flow .break{break-before:column}
.r3ad-folio{
  position:absolute;
  left:0;right:0;
  text-align:center;
  font-family:'${t.family}', Georgia, serif;
  font-size:${(m.fontSizePx * 0.82).toFixed(3)}px;
  color:#6b6157;
  font-variant-numeric:oldstyle-nums;
}`.trim();
}

/** Инлайновые стили полосы набора. Держим отдельно — они зависят от стороны разворота. */
export function flowInlineStyle(m: PageMetrics, side: 'left' | 'right'): string {
  return [
    `width:${m.boxWidthPx}px`,
    `height:${m.boxHeightPx}px`,
    `column-width:${m.boxWidthPx}px`,
    `column-gap:${m.columnGapPx}px`,
    `column-fill:auto`,
    `will-change:transform`,
    // Сторона влияет только на поля, поэтому смещение живёт на обёртке, а не здесь.
    `--side:${side}`,
  ].join(';');
}
