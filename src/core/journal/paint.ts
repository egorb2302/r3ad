/**
 * Печать страницы тетради на холст.
 *
 * Один и тот же код рисует и текстуру страницы в 3D, и полотно плоского режима:
 * иначе конспект «уезжал бы в 3D» немного другим, чем его рисовали, и это
 * замечалось бы ровно на том кадре, ради которого вся веха и делается. Холст
 * приходит уже в миллиметрах страницы — масштаб задаёт вызывающий, потому что
 * только он знает, во сколько пикселей печатает.
 *
 * Ядро не знает, где лежат картинки: ассеты приезжают колбэком. Хранилище
 * блобов — вопрос среды (OPFS, память, снапшот), а не документа.
 */
import { paintBackground } from './background';
import { strokePath } from './stroke';
import { blockLayer, PAGE_H, PAGE_W, type Block, type PageDoc, type Stroke } from './types';

/** Тон бумаги тот же, что у страниц тома (scene/geometry.ts): это одна бумага. */
export const JOURNAL_PAPER = '#efe6d4';

export interface PaintOptions {
  /** Битмап ассета по хэшу. Нет картинки — на её месте рисуется рамка ожидания. */
  image?: (hash: string) => CanvasImageSource | null;
  /**
   * Что не печатать: правящийся текстовый блок (его показывает поле ввода) и
   * штрихи под ластиком, которых ещё нет в документе, но уже нет на бумаге.
   */
  hide?: ReadonlySet<string> | null;
  /** Печатать ли бумагу и разлиновку. Живой слой поверх готовой страницы — нет. */
  paper?: boolean;
}

export function paintPage(
  ctx: CanvasRenderingContext2D,
  page: PageDoc,
  options: PaintOptions = {},
) {
  if (options.paper !== false) {
    ctx.fillStyle = JOURNAL_PAPER;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    paintBackground(ctx, page.background);
  }

  /*
   * Порядок слоёв: блоки внизу, штрихи наверху. Так работает конспект — сначала
   * на страницу попадает скриншот, потом его обводят, — а не наоборот.
   */
  for (const layer of page.layers) {
    if (!layer.visible) continue;
    if (layer.type === 'strokes') {
      for (const stroke of layer.strokes) {
        if (!options.hide?.has(stroke.id)) paintStroke(ctx, stroke);
      }
    } else {
      for (const block of layer.blocks) paintBlock(ctx, block, options);
    }
  }
}

export function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.points.length === 0) return;

  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  /*
   * Маркер — умножение, как и положено полупрозрачной краске: под ним видно и
   * разлиновку, и текст, а пересечение двух его штрихов темнеет один раз, а не
   * на каждом сегменте (штрих заливается одним контуром, см. stroke.ts).
   */
  if (stroke.brush === 'marker') ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = stroke.color;
  ctx.fill(strokePath(stroke));
  ctx.restore();
}

/** Гарнитуры блоков. Общие для холста и для поля ввода — иначе текст прыгает. */
export const FACES = {
  serif: 'Literata, Georgia, serif',
  sans: 'Inter, system-ui, sans-serif',
} as const;

export function blockFont(block: Extract<Block, { type: 'text' }>): string {
  return `${block.style.weight} ${block.style.sizeMm}px ${FACES[block.style.family]}`;
}

/** Межстрочное расстояние текстового блока в долях кегля. */
export const TEXT_LEADING = 1.35;

/**
 * Разбивка текста блока на строки.
 *
 * Отдана наружу, потому что по ней же ставится поле ввода: строки в нём и на
 * холсте обязаны совпадать, иначе текст прыгает в момент, когда правку
 * заканчивают.
 */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = `${line} ${words[i]}`;
      if (ctx.measureText(next).width <= width) line = next;
      else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  }

  return lines;
}

/** Один блок отдельно от страницы: им же рисуется блок, который сейчас тащат. */
export function paintBlock(
  ctx: CanvasRenderingContext2D,
  block: Block,
  options: PaintOptions = {},
) {
  if (options.hide?.has(block.id)) return;

  const { rect, rot } = block;
  ctx.save();
  // Поворот вокруг центра блока: за угол его и крутят.
  ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.rotate(rot);
  ctx.translate(-rect.w / 2, -rect.h / 2);

  if (block.type === 'text') {
    ctx.fillStyle = block.style.color;
    ctx.font = blockFont(block);
    ctx.textBaseline = 'alphabetic';

    const step = block.style.sizeMm * TEXT_LEADING;
    let y = step * 0.82;
    for (const line of wrapText(ctx, block.text, rect.w)) {
      ctx.fillText(line, 0, y);
      y += step;
    }
  } else {
    paintImage(ctx, block, options);
  }

  ctx.restore();
}

/** Поля полароидной рамки: сверху и с боков поровну, снизу — под подпись. */
const POLAROID = { side: 2.6, bottom: 8 };

function paintImage(
  ctx: CanvasRenderingContext2D,
  block: Extract<Block, { type: 'image' }>,
  options: PaintOptions,
) {
  const { w, h } = block.rect;
  const framed = block.frame === 'polaroid';
  const inner = framed
    ? { x: POLAROID.side, y: POLAROID.side, w: w - POLAROID.side * 2, h: h - POLAROID.side - POLAROID.bottom }
    : { x: 0, y: 0, w, h };

  // Тень: картинка лежит на бумаге, а не напечатана на ней.
  ctx.save();
  ctx.shadowColor = 'rgba(28,20,12,0.4)';
  ctx.shadowBlur = 2.2;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = framed ? '#f7f3ea' : 'rgba(0,0,0,0.001)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const image = options.image?.(block.assetHash) ?? null;
  if (image) {
    ctx.drawImage(image, inner.x, inner.y, inner.w, inner.h);
  } else {
    // Ассет ещё не декодирован — место под картинку занято, но не выдумано.
    ctx.fillStyle = 'rgba(120,104,84,0.18)';
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
  }

  ctx.strokeStyle = 'rgba(40,30,20,0.22)';
  ctx.lineWidth = 0.15;
  ctx.strokeRect(inner.x, inner.y, inner.w, inner.h);
}

/**
 * Блок под точкой — для инструмента выбора.
 *
 * Точку вносим в систему координат блока обратным поворотом, а не проверяем
 * повёрнутый прямоугольник: так же, как его рисуют, только наоборот. Идём с
 * конца — верхний блок перехватывает щелчок у нижнего.
 */
export function blockAt(page: PageDoc, x: number, y: number): Block | null {
  const blocks = blockLayer(page).blocks;

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const cx = block.rect.x + block.rect.w / 2;
    const cy = block.rect.y + block.rect.h / 2;
    const cos = Math.cos(-block.rot);
    const sin = Math.sin(-block.rot);
    const lx = (x - cx) * cos - (y - cy) * sin + block.rect.w / 2;
    const ly = (x - cx) * sin + (y - cy) * cos + block.rect.h / 2;

    if (lx >= 0 && ly >= 0 && lx <= block.rect.w && ly <= block.rect.h) return block;
  }
  return null;
}

export { PAGE_H, PAGE_W };
