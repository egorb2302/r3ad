/**
 * Вырезка на странице тетради.
 *
 * Карточка — это распечатка, приклеенная в конспект: белая бумага поверх
 * кремовой, тень, лёгкий поворот. Смысл именно в этом контрасте — вырезка
 * обязана читаться как чужое, принесённое извне, а не как то, что человек
 * написал сам. По ней потом ведут пером, и разница между своим и принесённым
 * должна оставаться видимой.
 *
 * Вёрстка считается по месту, а не хранится: карточку двигают и растягивают,
 * и текст в ней должен перетекать так же, как в любом текстовом блоке. Один и
 * тот же расчёт даёт и высоту при вставке, и печать — иначе вставленная
 * карточка оказывалась бы не той высоты, что нарисованная.
 *
 * Атрибуция рисуется всегда (§10). Это не строчка в подвале, которую можно
 * потерять при рефакторинге: `paintCard` печатает её вне зависимости от того,
 * поместилось ли остальное.
 */
import { ellipsize, FACES, wrapText } from '../journal/text';
import type { Rect } from '../journal/types';
import type { Clipping } from './types';

/** Размеры карточки в миллиметрах страницы. */
export const CARD = {
  pad: 3.6,
  gap: 2,
  radius: 1.4,
  avatar: 6.4,
  title: 3.9,
  name: 3.2,
  meta: 2.5,
  body: 3,
  foot: 2.4,
  leading: 1.42,
  /** Картинка выше этого начинает вытеснять со страницы всё остальное. */
  media: 52,
  /** Минимальная ширина, ниже которой строки перестают быть строками. */
  minWidth: 40,
} as const;

const INK = {
  paper: '#fbf8f3',
  edge: 'rgba(40,30,20,0.18)',
  text: '#1c1a17',
  muted: '#6f675c',
  rule: 'rgba(40,30,20,0.12)',
} as const;

/** Полоска на левом поле: по ней вырезка узнаётся, не читая подвала. */
const ACCENT: Record<Clipping['adapter'], string> = {
  'x-post': '#1d9bf0',
  article: '#b07d3a',
  'og-card': '#7a8b6f',
  image: '#8d6f9c',
  paste: '#a2a08f',
};

type Row =
  | { kind: 'text'; text: string; font: string; color: string; size: number }
  | { kind: 'media'; index: number; h: number }
  | { kind: 'gap'; h: number }
  | { kind: 'rule' };

export interface CardLayout {
  rows: Row[];
  /** Высота содержимого вместе с полями. */
  height: number;
  headerHeight: number;
  footerHeight: number;
}

export interface CardContext {
  /** Размеры ассета по хэшу — нужны, чтобы посчитать высоту картинки. */
  size?: (hash: string) => { width: number; height: number } | null;
}

const font = (size: number, weight = 400, face: keyof typeof FACES = 'sans') =>
  `${weight} ${size}px ${FACES[face]}`;

/**
 * Раскладка карточки при данной ширине.
 *
 * Контекст нужен только чтобы мерить строки: ничего не рисуется, состояние
 * сохраняется и возвращается.
 */
export function layoutCard(
  ctx: CanvasRenderingContext2D,
  clipping: Clipping,
  width: number,
  options: CardContext = {},
): CardLayout {
  const inner = Math.max(10, width - CARD.pad * 2);
  const rows: Row[] = [];
  ctx.save();

  const line = (text: string, size: number, weight: number, color: string, face: keyof typeof FACES = 'sans') => {
    ctx.font = font(size, weight, face);
    for (const part of wrapText(ctx, text, inner)) {
      rows.push({ kind: 'text', text: part, font: ctx.font, color, size });
    }
  };

  /* Шапка: автор с аватаром или имя источника. */
  const author = clipping.author;
  ctx.font = font(CARD.name, 600);
  const headerHeight = author?.avatarHash
    ? Math.max(CARD.avatar, CARD.name * 2.2)
    : CARD.name * CARD.leading;

  if (clipping.title && clipping.adapter !== 'x-post') {
    line(clipping.title, CARD.title, 600, INK.text, 'serif');
    rows.push({ kind: 'gap', h: CARD.gap * 0.6 });
  }

  for (const block of clipping.body) {
    switch (block.type) {
      case 'para':
        line(block.text, CARD.body, 400, INK.text);
        break;
      case 'heading':
        rows.push({ kind: 'gap', h: CARD.gap * 0.5 });
        line(block.text, CARD.body * 1.1, 600, INK.text);
        break;
      case 'quote':
        line(`« ${block.text} »`, CARD.body, 400, INK.muted, 'serif');
        break;
      case 'code':
        line(block.text, CARD.body * 0.92, 400, INK.muted);
        break;
      case 'list':
        block.items.forEach((item, i) =>
          line(`${block.ordered ? `${i + 1}.` : '·'} ${item}`, CARD.body, 400, INK.text),
        );
        break;
      case 'media': {
        const asset = clipping.media[block.index];
        const size = asset ? options.size?.(asset.assetHash) ?? asset : null;
        const h = size && size.width > 0 ? Math.min(CARD.media, (inner * size.height) / size.width) : 24;
        rows.push({ kind: 'gap', h: CARD.gap * 0.5 });
        rows.push({ kind: 'media', index: block.index, h });
        break;
      }
    }
    rows.push({ kind: 'gap', h: CARD.gap * 0.45 });
  }

  const footerHeight = CARD.foot * 2.4;
  ctx.restore();

  const body = rows.reduce((sum, row) => sum + rowHeight(row), 0);
  return {
    rows,
    headerHeight,
    footerHeight,
    height: CARD.pad * 2 + headerHeight + CARD.gap + body + footerHeight,
  };
}

function rowHeight(row: Row): number {
  if (row.kind === 'text') return row.size * CARD.leading;
  if (row.kind === 'media') return row.h;
  if (row.kind === 'gap') return row.h;
  return CARD.gap;
}

export interface PaintCardOptions extends CardContext {
  image?: (hash: string) => CanvasImageSource | null;
}

/**
 * Печать карточки в прямоугольник блока.
 *
 * Содержимое обрезается по нижнему краю, а не сжимается: карточку растягивают
 * руками, и текст, меняющий кегль под размер рамки, вёл бы себя не как бумага.
 * Подвал с атрибуцией при этом всегда на месте — он рисуется поверх обреза.
 */
export function paintCard(
  ctx: CanvasRenderingContext2D,
  clipping: Clipping,
  rect: Rect,
  options: PaintCardOptions = {},
) {
  const { w, h } = rect;
  const layout = layoutCard(ctx, clipping, w, options);

  /* Бумага карточки с тенью: она лежит на странице, а не напечатана на ней. */
  ctx.save();
  ctx.shadowColor = 'rgba(28,20,12,0.32)';
  ctx.shadowBlur = 2.4;
  ctx.shadowOffsetY = 1.1;
  ctx.fillStyle = INK.paper;
  roundRect(ctx, 0, 0, w, h, CARD.radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, 0, 0, w, h, CARD.radius);
  ctx.clip();

  // Полоска источника по левому краю.
  ctx.fillStyle = ACCENT[clipping.adapter];
  ctx.fillRect(0, 0, 0.9, h);

  const left = CARD.pad;
  const inner = Math.max(10, w - CARD.pad * 2);
  let y = CARD.pad;

  /* Шапка. */
  ctx.textBaseline = 'alphabetic';
  const author = clipping.author;
  let textLeft = left;

  if (author?.avatarHash) {
    const avatar = options.image?.(author.avatarHash) ?? null;
    ctx.save();
    ctx.beginPath();
    ctx.arc(left + CARD.avatar / 2, y + CARD.avatar / 2, CARD.avatar / 2, 0, Math.PI * 2);
    ctx.clip();
    if (avatar) ctx.drawImage(avatar, left, y, CARD.avatar, CARD.avatar);
    else {
      ctx.fillStyle = 'rgba(120,104,84,0.2)';
      ctx.fillRect(left, y, CARD.avatar, CARD.avatar);
    }
    ctx.restore();
    textLeft = left + CARD.avatar + CARD.gap * 0.8;
  }

  const nameWidth = w - CARD.pad - textLeft;
  ctx.fillStyle = INK.text;
  ctx.font = font(CARD.name, 600);
  ctx.fillText(
    ellipsize(ctx, author?.name ?? clipping.attribution.sourceName, nameWidth),
    textLeft,
    y + CARD.name,
  );

  ctx.fillStyle = INK.muted;
  ctx.font = font(CARD.meta, 400);
  ctx.fillText(ellipsize(ctx, subtitle(clipping), nameWidth), textLeft, y + CARD.name + CARD.meta * 1.5);

  y += layout.headerHeight + CARD.gap;

  /* Тело. Обрезается по началу подвала — там, где кончается бумага. */
  const bottom = h - layout.footerHeight;
  let truncated = false;
  for (const row of layout.rows) {
    if (y >= bottom) {
      truncated = true;
      break;
    }

    if (row.kind === 'text') {
      ctx.font = row.font;
      ctx.fillStyle = row.color;
      ctx.fillText(row.text, left, y + row.size);
    } else if (row.kind === 'media') {
      const asset = clipping.media[row.index];
      const image = asset ? options.image?.(asset.assetHash) ?? null : null;
      const height = Math.min(row.h, bottom - y);
      if (image) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, y, inner, height);
        ctx.clip();
        ctx.drawImage(image, left, y, inner, row.h);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(120,104,84,0.15)';
        ctx.fillRect(left, y, inner, height);
      }
    } else if (row.kind === 'rule') {
      ctx.strokeStyle = INK.rule;
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + inner, y);
      ctx.stroke();
    }

    y += rowHeight(row);
  }

  /*
   * Текст, который не поместился, гасится к бумаге. Резать его по букве —
   * значит выдать обрезок за целое; растворение читается как «дальше есть ещё»,
   * и это правда: целиком вырезка лежит в скомпилированном томе.
   */
  if (truncated) {
    const fade = ctx.createLinearGradient(0, bottom - CARD.body * 3, 0, bottom);
    fade.addColorStop(0, 'rgba(251,248,243,0)');
    fade.addColorStop(1, INK.paper);
    ctx.fillStyle = fade;
    ctx.fillRect(0, bottom - CARD.body * 3, w, CARD.body * 3);
  }

  /*
   * Подвал: имя источника и адрес. Рисуется всегда и поверх всего — правило
   * §10 «атрибуция не отключается» держится именно этим порядком операций.
   */
  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, h - layout.footerHeight, w, layout.footerHeight);
  ctx.strokeStyle = INK.rule;
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  ctx.moveTo(left, h - layout.footerHeight + CARD.foot * 0.4);
  ctx.lineTo(w - CARD.pad, h - layout.footerHeight + CARD.foot * 0.4);
  ctx.stroke();

  ctx.font = font(CARD.foot, 400);
  ctx.fillStyle = INK.muted;
  ctx.fillText(
    ellipsize(ctx, footer(clipping), inner),
    left,
    h - CARD.pad * 0.5 - CARD.foot * 0.2,
  );

  ctx.restore();

  // Тонкая обводка поверх всего: край распечатки.
  ctx.strokeStyle = INK.edge;
  ctx.lineWidth = 0.12;
  roundRect(ctx, 0, 0, w, h, CARD.radius);
  ctx.stroke();
}

function subtitle(clipping: Clipping): string {
  const parts: string[] = [];
  if (clipping.author?.handle) parts.push(`@${clipping.author.handle}`);
  else if (clipping.title && clipping.adapter === 'x-post') parts.push(clipping.title);
  if (clipping.publishedAt) parts.push(dateOf(clipping.publishedAt));
  if (parts.length === 0) parts.push(clipping.attribution.sourceName);
  return parts.join(' · ');
}

function footer(clipping: Clipping): string {
  const where = clipping.attribution.sourceUrl || clipping.attribution.sourceName;
  return `${clipping.attribution.sourceName} · ${where.replace(/^https?:\/\//, '')}`;
}

export function dateOf(stamp: number): string {
  return new Date(stamp).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Потолок карточки при вставке — доля высоты страницы.
 *
 * Статья на сорок абзацев занимала бы всю страницу, и вырезка переставала бы
 * быть вырезкой: в конспект её кладут, чтобы рядом было что написать от руки.
 * Целиком текст никуда не девается — он в самой вырезке и попадёт в
 * скомпилированный том; на бумаге у неё роль карточки, а не главы.
 */
export const CARD_MAX_SHARE = 0.44;

/** Высота карточки при вставке: столько, сколько просит содержимое. */
export function cardHeight(
  ctx: CanvasRenderingContext2D,
  clipping: Clipping,
  width: number,
  options: CardContext = {},
): number {
  return layoutCard(ctx, clipping, width, options).height;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
