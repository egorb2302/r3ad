/**
 * Фактура переплёта: ткань, кожа, картон, супер-обложка.
 *
 * Четыре материала — это четыре рисунка и четыре набора параметров отражения,
 * а не четыре картинки. Ассетов в проекте нет по решению §8, но дело не только
 * в весе: текстура кожи, снятая с фотографии, тянется вместе с книгой, а
 * процедурная считается в тех единицах, в которых книга и живёт, — в
 * миллиметрах. Поэтому зерно на тонкой брошюре и на томе в шестьсот страниц
 * одного размера, как и на бумажных.
 *
 * Отсюда же и подпись функций: масштаб приходит числом `perMm`, а не
 * подразумевается. Один и тот же рисунок печатается в трёх разных местах —
 * в клетке атласа корешков (там единица 0.1 мм), на крышке тома (там свои
 * пиксели) и в серой плитке под карту рельефа, — и ни одно из этих разрешений
 * не имеет права быть системой координат материала.
 *
 * Ядро про three.js не знает: здесь только 2D-контекст. Что из этих рисунков
 * станет картой цвета, а что картой рельефа, решает сцена.
 */
import type { CoverMaterial } from '../theme';

/** Детерминированный шум: одна и та же книга обязана выглядеть одинаково. */
export function noise(seed: number) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

export interface GrainOptions {
  material: CoverMaterial;
  w: number;
  h: number;
  /** Сколько единиц холста приходится на миллиметр переплёта. */
  perMm: number;
  seed: number;
  /** Общая сила рисунка. На корешке шириной в двадцать пикселей она меньше. */
  alpha?: number;
}

/**
 * Зерно поверх уже залитого цветом поля.
 *
 * Именно поверх, а не вместо: цвет крышки задаёт человек, и материал не имеет
 * права его подменять — он его только мнёт. Все штрихи здесь полупрозрачные
 * чёрные и белые, поэтому одна и та же фактура одинаково честно ложится и на
 * оксблад, и на песочный.
 */
export function paintGrain(ctx: CanvasRenderingContext2D, options: GrainOptions) {
  const { material, w, h, perMm, seed } = options;
  const alpha = options.alpha ?? 1;
  const rand = noise(seed);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  if (material === 'cloth') paintCloth(ctx, w, h, perMm, rand, alpha);
  else if (material === 'leather') paintLeather(ctx, w, h, perMm, rand, alpha);
  else if (material === 'board') paintBoard(ctx, w, h, perMm, rand, alpha);
  else paintJacket(ctx, w, h, perMm, rand, alpha);

  ctx.restore();
}

/**
 * Ткань: переплётное полотно, то есть буквально основа и уток.
 *
 * Две сетки нитей под прямым углом, каждая со своим дрожанием яркости. Шаг —
 * полмиллиметра: у бумвинила и коленкора он примерно такой, и на этом шаге
 * ткань ещё читается тканью, а не сеткой.
 */
function paintCloth(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  perMm: number,
  rand: () => number,
  alpha: number,
) {
  const step = Math.max(1, perMm * 0.5);
  const line = Math.max(0.5, step * 0.34);

  for (let x = 0; x < w; x += step) {
    ctx.fillStyle = `rgba(0,0,0,${(0.05 + rand() * 0.07) * alpha})`;
    ctx.fillRect(x, 0, line, h);
    ctx.fillStyle = `rgba(255,255,255,${(0.03 + rand() * 0.05) * alpha})`;
    ctx.fillRect(x + line, 0, line * 0.6, h);
  }

  for (let y = 0; y < h; y += step) {
    ctx.fillStyle = `rgba(0,0,0,${(0.04 + rand() * 0.06) * alpha})`;
    ctx.fillRect(0, y, w, line);
    ctx.fillStyle = `rgba(255,255,255,${(0.02 + rand() * 0.04) * alpha})`;
    ctx.fillRect(0, y + line, w, line * 0.6);
  }
}

/**
 * Кожа: мерея, то есть сетка неровных ячеек с тёмными складками между ними.
 *
 * Ячейки рисуются радиальным градиентом от светлого центра к тёмному краю —
 * так выглядит выпуклость, освещённая рассеянным светом. Правильнее было бы
 * считать Вороного, но разница видна только вплотную, а стоит она на два
 * порядка дороже.
 */
function paintLeather(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  perMm: number,
  rand: () => number,
  alpha: number,
) {
  const cell = Math.max(2, perMm * 1.1);
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = (col + rand() * 0.8 - 0.4) * cell;
      const cy = (row + rand() * 0.8 - 0.4) * cell;
      const r = cell * (0.45 + rand() * 0.3);

      const grad = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.1, cx, cy, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.1 * alpha})`);
      grad.addColorStop(0.6, 'rgba(255,255,255,0)');
      grad.addColorStop(1, `rgba(0,0,0,${(0.14 + rand() * 0.1) * alpha})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Крупные складки: кожа мнётся вдоль, а не пятнами.
  for (let i = 0; i < Math.max(3, h / (perMm * 12)); i++) {
    const y = rand() * h;
    ctx.strokeStyle = `rgba(0,0,0,${0.05 * alpha})`;
    ctx.lineWidth = perMm * 0.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.4, y + perMm * 2, w * 0.6, y - perMm * 2, w, y);
    ctx.stroke();
  }
}

/**
 * Картон: не ткань и не кожа, а спрессованная макулатура.
 *
 * Отсюда и рисунок — короткие волокна вперемешку с крапом, без направления и
 * без блеска. Материал бедного издания, и выглядеть он обязан именно так.
 */
function paintBoard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  perMm: number,
  rand: () => number,
  alpha: number,
) {
  const flecks = Math.round((w * h) / Math.max(4, perMm * perMm * 0.9));

  for (let i = 0; i < flecks; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const long = perMm * (0.3 + rand() * 0.9);
    const dark = rand() < 0.55;

    ctx.strokeStyle = dark
      ? `rgba(0,0,0,${(0.05 + rand() * 0.1) * alpha})`
      : `rgba(255,255,255,${(0.04 + rand() * 0.08) * alpha})`;
    ctx.lineWidth = Math.max(0.4, perMm * 0.16);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + long * (rand() - 0.5) * 2, y + long * (rand() - 0.5) * 2);
    ctx.stroke();
  }
}

/**
 * Супер-обложка: печатная бумага, то есть почти ничего.
 *
 * Гладкая, с еле заметным следом каландра вдоль листа. Материал узнаётся не
 * рисунком, а отражением — у обложки под лаком roughness вдвое ниже тканевой,
 * и это уже забота сцены.
 */
function paintJacket(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  perMm: number,
  rand: () => number,
  alpha: number,
) {
  const step = Math.max(1, perMm * 1.6);
  for (let y = 0; y < h; y += step) {
    ctx.fillStyle = `rgba(255,255,255,${(0.01 + rand() * 0.025) * alpha})`;
    ctx.fillRect(0, y, w, step * 0.5);
  }
}

/**
 * Потёртость.
 *
 * Книга изнашивается не равномерно, а по углам и кантам — по тому, чем её
 * ставят на полку и достают с неё. Поэтому здесь не «шум с силой wear», а
 * протёртые кромки и вытертые углы: именно они отличают том из букинистики от
 * тома из типографии, а общее посветление дало бы просто выгоревшую краску.
 */
export function paintWear(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  wear: number,
  seed: number,
) {
  if (wear <= 0.001) return;
  const rand = noise(seed);
  const edge = Math.min(w, h) * 0.06;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  /*
   * Канты: краска сходит первой там, где переплёт трётся о соседей. Градиент
   * задаётся от самой кромки внутрь — по паре точек, а не флагом «вдоль или
   * поперёк»: направлений четыре, и вывести их из размеров прямоугольника
   * нельзя, у верхней и нижней полосы они одинаковые.
   */
  const sides: [x: number, y: number, w: number, h: number, tx: number, ty: number][] = [
    [0, 0, w, edge, 0, edge],
    [0, h - edge, w, edge, 0, -edge],
    [0, 0, edge, h, edge, 0],
    [w - edge, 0, edge, h, -edge, 0],
  ];
  for (const [x, y, sw, sh, tx, ty] of sides) {
    const fromX = tx < 0 ? x + sw : x;
    const fromY = ty < 0 ? y + sh : y;
    const grad = ctx.createLinearGradient(fromX, fromY, fromX + tx, fromY + ty);
    grad.addColorStop(0, `rgba(226,214,192,${0.28 * wear})`);
    grad.addColorStop(1, 'rgba(226,214,192,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, sw, sh);
  }

  // Углы: там переплёт не трётся, а сбивается до картона.
  for (const [cx, cy] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]) {
    const r = edge * (1.4 + rand() * 1.2);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(214,198,170,${0.5 * wear})`);
    grad.addColorStop(1, 'rgba(214,198,170,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Пятна и залоснённости на поле — редкие, иначе крышка выглядит грязной, а не ношеной.
  const spots = Math.round(wear * 7);
  for (let i = 0; i < spots; i++) {
    const cx = rand() * w;
    const cy = rand() * h;
    const r = Math.min(w, h) * (0.04 + rand() * 0.1);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(40,30,20,${0.05 + rand() * 0.06 * wear})`);
    grad.addColorStop(1, 'rgba(40,30,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/** Насколько материал блестит. Пресеты отражения — та часть материала, которой нет рисунка. */
export const SHEEN: Record<CoverMaterial, { roughness: number; sheen: number; clearcoat: number }> =
  {
    cloth: { roughness: 0.86, sheen: 0.6, clearcoat: 0 },
    leather: { roughness: 0.58, sheen: 0.24, clearcoat: 0.16 },
    board: { roughness: 0.95, sheen: 0.1, clearcoat: 0 },
    jacket: { roughness: 0.34, sheen: 0, clearcoat: 0.55 },
  };
