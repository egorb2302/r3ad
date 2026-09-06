/**
 * Разлиновка страницы.
 *
 * Процедурная, как и всё остальное: линейка, клетка, точки и нотный стан — это
 * шаг и цвет, а не пять картинок. Заодно разлиновка рисуется в тех же
 * миллиметрах, что и штрихи, поэтому клетка на текстуре 1024 px и клетка в
 * плоском режиме во весь экран — одна и та же клетка, а не две похожие.
 *
 * Цвет тонкий намеренно. Разлиновка нужна руке, а не глазу: она должна быть
 * видна, когда на неё смотрят, и исчезать, когда смотрят на конспект.
 */
import { PAGE_H, PAGE_W, type PageBackground } from './types';

/** Шаг линейки. Школьная широкая линейка — 8 мм, писчая бумага — 7. */
const RULE_MM = 7;
const GRID_MM = 5;
const DOT_MM = 5;

/** Поле слева, за которым линейка не рисуется, — и красная линия по нему. */
const MARGIN_MM = 20;
const TOP_MM = 16;
const BOTTOM_MM = 12;

const INK = 'rgba(64,96,134,0.3)';
const MARGIN_INK = 'rgba(168,74,62,0.34)';
const DOT_INK = 'rgba(64,96,134,0.42)';
const STAFF_INK = 'rgba(48,44,40,0.5)';

/** Толщина линии разлиновки в миллиметрах: волосная, но не исчезающая на текстуре. */
const HAIR = 0.12;

export function paintBackground(ctx: CanvasRenderingContext2D, kind: PageBackground) {
  if (kind === 'blank') return;

  ctx.save();
  ctx.lineWidth = HAIR;
  ctx.strokeStyle = INK;

  if (kind === 'ruled') {
    ctx.beginPath();
    for (let y = TOP_MM; y <= PAGE_H - BOTTOM_MM; y += RULE_MM) {
      ctx.moveTo(MARGIN_MM, y);
      ctx.lineTo(PAGE_W - 10, y);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = MARGIN_INK;
    ctx.moveTo(MARGIN_MM, TOP_MM - RULE_MM);
    ctx.lineTo(MARGIN_MM, PAGE_H - BOTTOM_MM + RULE_MM);
    ctx.stroke();
  }

  if (kind === 'grid') {
    ctx.beginPath();
    for (let x = GRID_MM; x < PAGE_W; x += GRID_MM) {
      ctx.moveTo(x, GRID_MM);
      ctx.lineTo(x, PAGE_H - GRID_MM);
    }
    for (let y = GRID_MM; y < PAGE_H; y += GRID_MM) {
      ctx.moveTo(GRID_MM, y);
      ctx.lineTo(PAGE_W - GRID_MM, y);
    }
    ctx.stroke();
  }

  if (kind === 'dots') {
    ctx.fillStyle = DOT_INK;
    for (let x = DOT_MM; x < PAGE_W; x += DOT_MM) {
      for (let y = DOT_MM; y < PAGE_H; y += DOT_MM) {
        ctx.beginPath();
        ctx.arc(x, y, 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (kind === 'staff') {
    // Стан: пять линеек с шагом 2 мм, между станами — место для нот и текста.
    ctx.strokeStyle = STAFF_INK;
    ctx.beginPath();
    for (let top = TOP_MM; top + 8 < PAGE_H - BOTTOM_MM; top += 20) {
      for (let i = 0; i < 5; i++) {
        const y = top + i * 2;
        ctx.moveTo(14, y);
        ctx.lineTo(PAGE_W - 14, y);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

export const BACKGROUNDS: { value: PageBackground; label: string }[] = [
  { value: 'ruled', label: 'Ruled' },
  { value: 'grid', label: 'Grid' },
  { value: 'dots', label: 'Dots' },
  { value: 'blank', label: 'Blank' },
  { value: 'staff', label: 'Staff' },
];
