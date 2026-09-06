/**
 * Геометрия штриха: из точек с нажимом — в контур с переменной толщиной.
 *
 * Наивный путь — `lineTo` по точкам с `lineWidth` — даёт линию постоянной
 * толщины, то есть выбрасывает нажим, ради которого стилус и берут в руки.
 * Рисовать каждый отрезок отдельной толщиной тоже нельзя: у маркера
 * прозрачность, и перекрывающиеся отрезки темнеют вдвое на каждом стыке.
 *
 * Поэтому штрих собирается в один замкнутый контур — левая кромка вперёд,
 * круглый колпачок, правая кромка назад, второй колпачок — и заливается одной
 * операцией. Одна заливка означает и честную прозрачность, и отсутствие швов.
 *
 * Сглаживание — Catmull-Rom (SPEC §9.2): кривая проходит через сами точки, а не
 * мимо них, поэтому линия совпадает с тем, где вели стилусом.
 */
import type { BrushKind, Rect, Stroke, StrokePoint } from './types';

/** Ближе этого новая точка не записывается: дрожь руки не информация. */
export const MIN_STEP_MM = 0.12;

/** Во сколько долей миллиметра дробится сегмент при сглаживании. */
const SAMPLE_MM = 0.35;
const MAX_SUBDIV = 12;

/** Сегментов в круглом колпачке. Восьми хватает: колпачок меньше миллиметра. */
const CAP_STEPS = 8;

interface Sample {
  x: number;
  y: number;
  /** Полутолщина в этой точке. */
  r: number;
}

/**
 * Как перо отзывается на нажим.
 *
 * Перо ведёт себя как перо: от волосной линии до полной толщины. Карандаш мягче
 * по диапазону, но темнеет прозрачностью — этим и отличается. Маркер почти не
 * реагирует: у него войлочный клин, и нажим меняет разве что след на бумаге.
 */
export function halfWidth(brush: BrushKind, width: number, pressure: number): number {
  const p = Math.min(Math.max(pressure, 0), 1);
  const base = width / 2;
  if (brush === 'marker') return base * (0.86 + 0.14 * p);
  if (brush === 'pencil') return base * (0.5 + 0.5 * p);
  return base * (0.32 + 0.68 * p);
}

/** Catmull-Rom по одной координате. */
function spline(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  );
}

/**
 * Точки штриха, сглаженные и с посчитанной толщиной.
 *
 * Шаг дробления берётся от длины сегмента: быстрое движение стилуса даёт точки
 * в сантиметре друг от друга, медленное — в десятой доле миллиметра, и
 * постоянное число подразбиений в первом случае даёт углы, а во втором тратит
 * работу впустую.
 */
export function sampleStroke(stroke: Stroke): Sample[] {
  const pts = stroke.points;
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    const [x, y, p] = pts[0];
    return [{ x, y, r: halfWidth(stroke.brush, stroke.width, p) }];
  }

  const at = (i: number): StrokePoint => pts[Math.min(Math.max(i, 0), pts.length - 1)];
  const out: Sample[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);

    const span = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.min(MAX_SUBDIV, Math.max(1, Math.round(span / SAMPLE_MM)));

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const pressure = p1[2] + (p2[2] - p1[2]) * t;
      out.push({
        x: spline(p0[0], p1[0], p2[0], p3[0], t),
        y: spline(p0[1], p1[1], p2[1], p3[1], t),
        r: halfWidth(stroke.brush, stroke.width, pressure),
      });
    }
  }

  const last = pts[pts.length - 1];
  out.push({ x: last[0], y: last[1], r: halfWidth(stroke.brush, stroke.width, last[2]) });
  return out;
}

/** Полукруглый колпачок: от нормали к противоположной, через направление движения. */
function cap(out: number[], x: number, y: number, r: number, from: number) {
  for (let k = 0; k <= CAP_STEPS; k++) {
    const a = from - (Math.PI * k) / CAP_STEPS;
    out.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
}

/**
 * Контур штриха — плоский массив координат замкнутого многоугольника.
 *
 * Кромки строятся по нормали к касательной, а касательная считается центральной
 * разностью: по соседям, а не по предыдущей точке. Односторонняя разность на
 * повороте разворачивает нормаль скачком, и на кривой появляется зазубрина.
 */
export function strokeOutline(stroke: Stroke): number[] {
  const pts = sampleStroke(stroke);
  if (pts.length === 0) return [];

  if (pts.length === 1) {
    const out: number[] = [];
    cap(out, pts[0].x, pts[0].y, pts[0].r, Math.PI / 2);
    cap(out, pts[0].x, pts[0].y, pts[0].r, -Math.PI / 2);
    return out;
  }

  const normals: { nx: number; ny: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    normals.push({ nx: -dy / len, ny: dx / len });
  }

  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i].x + normals[i].nx * pts[i].r, pts[i].y + normals[i].ny * pts[i].r);
  }

  const end = pts[pts.length - 1];
  const endNormal = normals[normals.length - 1];
  cap(out, end.x, end.y, end.r, Math.atan2(endNormal.ny, endNormal.nx));

  for (let i = pts.length - 1; i >= 0; i--) {
    out.push(pts[i].x - normals[i].nx * pts[i].r, pts[i].y - normals[i].ny * pts[i].r);
  }

  const start = pts[0];
  const startNormal = normals[0];
  cap(out, start.x, start.y, start.r, Math.atan2(startNormal.ny, startNormal.nx) + Math.PI);

  return out;
}

/** Готовый к заливке контур. Path2D кэшируется вызывающим: он переживает кадры. */
export function strokePath(stroke: Stroke): Path2D {
  const outline = strokeOutline(stroke);
  const path = new Path2D();
  if (outline.length < 6) return path;

  path.moveTo(outline[0], outline[1]);
  for (let i = 2; i < outline.length; i += 2) path.lineTo(outline[i], outline[i + 1]);
  path.closePath();
  return path;
}

export function strokeBounds(stroke: Stroke): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y, p] of stroke.points) {
    const r = halfWidth(stroke.brush, stroke.width, p);
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  }

  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Расстояние от точки до отрезка. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Попал ли ластик в штрих.
 *
 * Ластик работает по штрихам, а не по пикселям (SPEC §9.3): стирается то, что
 * рисовали, целиком. Растровый ластик на векторном документе означал бы либо
 * растеризацию всего слоя, либо разрезание штрихов на куски — и то и другое
 * ломает главное свойство документа, из-за которого он и вектор.
 */
export function hitStroke(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const pts = stroke.points;
  if (pts.length === 0) return false;

  const box = strokeBounds(stroke);
  if (
    x < box.x - radius ||
    x > box.x + box.w + radius ||
    y < box.y - radius ||
    y > box.y + box.h + radius
  ) {
    return false;
  }

  const reach = radius + stroke.width / 2;
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= reach;

  for (let i = 0; i < pts.length - 1; i++) {
    if (distanceToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= reach) {
      return true;
    }
  }
  return false;
}
