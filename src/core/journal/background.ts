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

/**
 * Шаг разлиновки по умолчанию. Школьная широкая линейка — 8 мм, писчая — 7.
 *
 * С M6 шаг настраивается (§8), и один на все виды разлиновки, а не три разных:
 * линейка в пять миллиметров и клетка в пять миллиметров — это один и тот же
 * размер, привычный руке, и разводить их значило бы просить человека дважды
 * ответить на один вопрос. Нотный стан из общего шага выпадает — у него пять
 * линеек внутри одной строки, — и там шаг задаёт расстояние между станами.
 */
export const RULE_MM = 7;
export const RULE_RANGE = { min: 3.5, max: 12 } as const;

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

export function paintBackground(
  ctx: CanvasRenderingContext2D,
  kind: PageBackground,
  stepMm: number = RULE_MM,
) {
  if (kind === 'blank') return;

  const step = Math.min(Math.max(stepMm, RULE_RANGE.min), RULE_RANGE.max);

  ctx.save();
  ctx.lineWidth = HAIR;
  ctx.strokeStyle = INK;

  if (kind === 'ruled') {
    ctx.beginPath();
    for (let y = TOP_MM; y <= PAGE_H - BOTTOM_MM; y += step) {
      ctx.moveTo(MARGIN_MM, y);
      ctx.lineTo(PAGE_W - 10, y);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = MARGIN_INK;
    ctx.moveTo(MARGIN_MM, TOP_MM - step);
    ctx.lineTo(MARGIN_MM, PAGE_H - BOTTOM_MM + step);
    ctx.stroke();
  }

  if (kind === 'grid') {
    ctx.beginPath();
    for (let x = step; x < PAGE_W; x += step) {
      ctx.moveTo(x, step);
      ctx.lineTo(x, PAGE_H - step);
    }
    for (let y = step; y < PAGE_H; y += step) {
      ctx.moveTo(step, y);
      ctx.lineTo(PAGE_W - step, y);
    }
    ctx.stroke();
  }

  if (kind === 'dots') {
    ctx.fillStyle = DOT_INK;
    for (let x = step; x < PAGE_W; x += step) {
      for (let y = step; y < PAGE_H; y += step) {
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
    // У стана шаг — это расстояние между станами: внутри него линейки свои.
    for (let top = TOP_MM; top + 8 < PAGE_H - BOTTOM_MM; top += step * 2.8) {
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
