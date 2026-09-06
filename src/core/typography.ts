/**
 * Типографика страницы и перевод «бумажных» величин в пиксели текстуры.
 *
 * Ключевая мысль: кегль задаётся в пунктах, как в вёрстке, а не в CSS-пикселях.
 * Пиксели тут производные — они зависят от разрешения текстуры страницы. Так
 * при смене разрешения (мобильный профиль, зум) вёрстка остаётся той же самой,
 * меняется только чёткость.
 */
import { PHYS } from './units';

export interface Margins {
  topMm: number;
  bottomMm: number;
  /** Со стороны корешка — традиционно больше внешнего. */
  innerMm: number;
  outerMm: number;
}

export interface Typography {
  family: string;
  sizePt: number;
  /**
   * Язык набора. Не косметика: hyphens:auto без него не работает, а словарь
   * переносов у каждого языка свой — от языка напрямую зависит, где рвутся
   * строки и, значит, сколько в книге страниц.
   */
  lang: string;
  /** Множитель интерлиньяжа. */
  leading: number;
  margins: Margins;
  hyphens: boolean;
  justify: boolean;
  /** Красная строка, в кеглях. 0 — абзацы отбиваются пробелом. */
  indentEm: number;
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  family: 'Literata',
  lang: 'en',
  sizePt: 10.5,
  leading: 1.45,
  margins: { topMm: 16, bottomMm: 18, innerMm: 17, outerMm: 13 },
  hyphens: true,
  justify: true,
  indentEm: 1.2,
};

/** Ширина текстуры страницы в пикселях — она же задаёт эффективное разрешение вёрстки. */
export const TEXTURE_PROFILES = {
  mobile: 768,
  desktop: 1024,
  zoom: 1536,
} as const;

export type TextureProfile = keyof typeof TEXTURE_PROFILES;

export interface PageMetrics {
  /** Размер всей страницы в пикселях текстуры. */
  pageWidthPx: number;
  pageHeightPx: number;
  /** Наборная полоса — то, во что реально льётся текст. */
  boxWidthPx: number;
  boxHeightPx: number;
  marginTopPx: number;
  marginBottomPx: number;
  marginInnerPx: number;
  marginOuterPx: number;
  /** Производные от разрешения. */
  pxPerMm: number;
  dpi: number;
  fontSizePx: number;
  lineHeightPx: number;
  /** Разрыв между колонками в композиторе. Не виден, но входит в арифметику смещений. */
  columnGapPx: number;
}

export function computeMetrics(type: Typography, profile: TextureProfile = 'desktop'): PageMetrics {
  const pageWidthPx = TEXTURE_PROFILES[profile];
  const pxPerMm = pageWidthPx / PHYS.trimWidthMm;
  const dpi = pxPerMm * 25.4;

  const round = (v: number) => Math.round(v);
  const marginTopPx = round(type.margins.topMm * pxPerMm);
  const marginBottomPx = round(type.margins.bottomMm * pxPerMm);
  const marginInnerPx = round(type.margins.innerMm * pxPerMm);
  const marginOuterPx = round(type.margins.outerMm * pxPerMm);

  const fontSizePx = (type.sizePt / 72) * dpi;
  const lineHeightPx = fontSizePx * type.leading;

  const pageHeightPx = round(PHYS.trimHeightMm * pxPerMm);
  const boxWidthPx = pageWidthPx - marginInnerPx - marginOuterPx;

  /**
   * Высота полосы подгоняется под целое число строк. Иначе последняя строка
   * страницы обрезается по-разному от страницы к странице, и низ текста «пляшет».
   */
  const rawBoxHeight = pageHeightPx - marginTopPx - marginBottomPx;
  const lines = Math.max(1, Math.floor(rawBoxHeight / lineHeightPx));
  const boxHeightPx = Math.round(lines * lineHeightPx);

  return {
    pageWidthPx,
    pageHeightPx,
    boxWidthPx,
    boxHeightPx,
    marginTopPx,
    marginBottomPx,
    marginInnerPx,
    marginOuterPx,
    pxPerMm,
    dpi,
    fontSizePx,
    lineHeightPx,
    columnGapPx: 64,
  };
}

/** Строк на полосе — для инспектора и для отладки вёрстки. */
export const linesPerPage = (m: PageMetrics) => Math.round(m.boxHeightPx / m.lineHeightPx);
