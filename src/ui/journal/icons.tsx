'use client';

/**
 * Символы инструментов.
 *
 * Нарисованы под проект, а не взяты из набора (SPEC §12.4). Причина не в
 * снобизме: иконочные шрифты и наборы тянут за собой либо сетевой файл, либо
 * пару десятков килобайт путей, а здесь нужно семь фигур по двадцать байт.
 * Заодно перо выглядит пером, а не «ручкой из материал-дизайна».
 *
 * Все — 16×16, обводкой в 1.3 единицы, чтобы вес совпадал с текстом панелей.
 */
import type { Tool } from '@/store/useJournal';

const shapes: Record<Tool, string> = {
  // Курсор-стрелка выделения.
  select: 'M4 2.6 L11.6 9.2 L8.2 9.6 L10 13.4 L8.4 14.1 L6.7 10.3 L4 12.6 Z',
  // Перьевая ручка: корпус и расщеплённое перо.
  pen: 'M11.6 2.2 L13.8 4.4 L6.6 11.6 L3.4 12.6 L4.4 9.4 Z M4.4 9.4 L6.6 11.6 M9.6 4.2 L11.8 6.4',
  // Маркер: скошенный клин на широком корпусе.
  marker: 'M10.4 2.4 L13.6 5.6 L7.4 11.8 L3.2 13 L4.4 8.8 Z M3.2 13 L6.2 10 M2.2 14.6 H13.8',
  // Ластик: брусок под наклоном и след, который он оставляет.
  eraser: 'M6.6 3.2 L12.8 9.4 L9.4 12.8 L3.2 6.6 Z M5 8.2 L9.8 13 M2.4 14.4 H13.6',
  text: 'M3.2 3.4 H12.8 M8 3.4 V13 M6 13 H10',
  // Картинка: рамка, горизонт и солнце.
  image: 'M2.6 3.6 H13.4 V12.4 H2.6 Z M2.6 10 L6 6.8 L9 9.6 L11 8 L13.4 10.2 M10.6 5.8 h0.01',
  // Вырезка: ножницы — два лезвия крест-накрест и два кольца.
  clip:
    'M11.8 2.6 L6.4 10.2 M4.2 2.6 L9.6 10.2 M2.7 12.4 a1.55 1.55 0 1 0 3.1 0 a1.55 1.55 0 1 0 -3.1 0 M10.2 12.4 a1.55 1.55 0 1 0 3.1 0 a1.55 1.55 0 1 0 -3.1 0',
};

export function ToolIcon({ tool }: { tool: Tool }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d={shapes[tool]}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Стрелки отмены — тоже свои, чтобы не смешивать со стрелками листания. */
export function UndoIcon({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path
        d="M6 4.4 L2.8 7.2 L6 10 M2.8 7.2 H9.4 A3.6 3.6 0 0 1 9.4 14.4 H7"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Символы панели слоёв: глаз, замок и стрелка.
 *
 * Нарисованы здесь же и той же обводкой в 1.3 — иначе строка слоя вышла бы
 * тяжелее строки инструмента, стоящей от неё в двух сантиметрах.
 */
const marks = {
  eye: 'M1.6 8 C4 4.4 12 4.4 14.4 8 C12 11.6 4 11.6 1.6 8 Z M8 6.2 a1.8 1.8 0 1 0 0 3.6 a1.8 1.8 0 1 0 0 -3.6',
  blind: 'M1.6 8 C4 4.4 12 4.4 14.4 8 C13.4 9.5 11.8 10.6 10 11.1 M2.6 13.4 L13.4 2.6',
  locked: 'M4 7.4 H12 V13.4 H4 Z M5.8 7.4 V5.2 a2.2 2.2 0 0 1 4.4 0 V7.4',
  open: 'M4 7.4 H12 V13.4 H4 Z M5.8 7.4 V5.2 a2.2 2.2 0 0 1 4.4 0',
  up: 'M8 12.4 V3.8 M4.4 7.4 L8 3.8 L11.6 7.4',
} as const;

export type LayerMark = keyof typeof marks;

export function LayerIcon({ mark, flip }: { mark: LayerMark; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      style={flip ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path
        d={marks[mark]}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
