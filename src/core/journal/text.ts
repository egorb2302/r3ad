/**
 * Типографика на холсте: гарнитуры, интерлиньяж, разбивка на строки.
 *
 * Вынесено из paint.ts, потому что этим пользуются двое: текстовый блок и
 * карточка вырезки (core/clipping/card.ts). Импортируй карточка сам paint —
 * получился бы цикл, ведь печать страницы карточку и рисует.
 */

/** Гарнитуры блоков. Общие для холста и для поля ввода — иначе текст прыгает. */
export const FACES = {
  serif: 'Literata, Georgia, serif',
  sans: 'Inter, system-ui, sans-serif',
} as const;

/** Межстрочное расстояние текстового блока в долях кегля. */
export const TEXT_LEADING = 1.35;

/**
 * Разбивка текста на строки по ширине.
 *
 * Отдана наружу, потому что по ней же ставится поле ввода: строки в нём и на
 * холсте обязаны совпадать, иначе текст прыгает в момент, когда правку
 * заканчивают. Шрифт должен быть уже выставлен в контексте — мерить нечем,
 * пока неизвестно чем.
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

/** Строка, обрезанная по ширине с многоточием. Для одной строки, а не абзаца. */
export function ellipsize(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
}
