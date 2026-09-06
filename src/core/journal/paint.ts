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
import { paintCard } from '../clipping/card';
import type { Clipping } from '../clipping/types';
import { paintBackground } from './background';
import { strokePath } from './stroke';
import { FACES, TEXT_LEADING, wrapText } from './text';
import { blockLayer, PAGE_H, PAGE_W, type Block, type PageDoc, type Stroke } from './types';

/** Тон бумаги тот же, что у страниц тома (scene/geometry.ts): это одна бумага. */
export const JOURNAL_PAPER = '#efe6d4';

export interface PaintOptions {
  /** Битмап ассета по хэшу. Нет картинки — на её месте рисуется рамка ожидания. */
  image?: (hash: string) => CanvasImageSource | null;
  /** Размеры ассета: карточке вырезки они нужны до того, как она нарисована. */
  size?: (hash: string) => { width: number; height: number } | null;
  /**
   * Вырезка по идентификатору. Ядро не знает, где лежит реестр вырезок, — ровно
   * по той же причине, по которой не знает, где лежат картинки.
   */
  clipping?: (id: string) => Clipping | null;
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

/*
 * Гарнитуры, интерлиньяж и разбивка на строки переехали в ./text: ими
 * пользуется ещё и карточка вырезки, а импортировать её печать отсюда значило
 * бы замкнуть круг. Наружу они по-прежнему видны здесь.
 */
export { FACES, TEXT_LEADING, wrapText };

export function blockFont(block: Extract<Block, { type: 'text' }>): string {
  return `${block.style.weight} ${block.style.sizeMm}px ${FACES[block.style.family]}`;
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
  } else if (block.type === 'image') {
    paintImage(ctx, block, options);
  } else {
    /*
     * Вырезка ищется в реестре. Не нашлась — рисуем пустое место её размера, а
     * не пропускаем блок: страница обведена и подписана вокруг карточки, и
     * дыра честнее, чем съехавшая на её месте разлиновка.
     */
    const clipping = options.clipping?.(block.clippingId) ?? null;
    if (clipping) paintCard(ctx, clipping, rect, options);
    else {
      ctx.fillStyle = 'rgba(120,104,84,0.12)';
      ctx.fillRect(0, 0, rect.w, rect.h);
    }
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
