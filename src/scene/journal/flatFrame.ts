'use client';

/**
 * Где страница лежит на экране.
 *
 * Плоский режим — это обычный 2D-холст поверх сцены (SPEC §9.1), и он обязан
 * встать ровно на ту страницу, к которой наклонилась камера. Считать его место
 * из угла обзора и дистанции значило бы держать вторую копию камерной
 * математики; вместо этого сцена проецирует четыре угла страницы и публикует
 * получившийся прямоугольник наружу.
 *
 * Наружу — потому что холст живёт в другом React-корне: сцена смонтирована
 * внутри Canvas, панели снаружи. Обычный стор здесь был бы избыточен —
 * прямоугольник меняется только на времени наклона и никого, кроме одного
 * компонента, не интересует.
 */
export interface FlatRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Есть ли вообще страница под пером. */
  ready: boolean;
}

const EMPTY: FlatRect = { x: 0, y: 0, w: 0, h: 0, ready: false };

let snapshot: FlatRect = EMPTY;
const listeners = new Set<() => void>();

/** Меньше этого сдвиг не публикуется: подписчик — React, будить его на полпикселя незачем. */
const EPSILON = 0.4;

export function publishFlatRect(next: Omit<FlatRect, 'ready'> | null) {
  if (!next) {
    if (!snapshot.ready) return;
    snapshot = EMPTY;
    for (const listener of listeners) listener();
    return;
  }

  if (
    snapshot.ready &&
    Math.abs(snapshot.x - next.x) < EPSILON &&
    Math.abs(snapshot.y - next.y) < EPSILON &&
    Math.abs(snapshot.w - next.w) < EPSILON &&
    Math.abs(snapshot.h - next.h) < EPSILON
  ) {
    return;
  }

  snapshot = { ...next, ready: true };
  for (const listener of listeners) listener();
}

export function subscribeFlatRect(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function flatRect(): FlatRect {
  return snapshot;
}

/** На сервере страницы под пером нет — там нет и камеры. */
export function serverFlatRect(): FlatRect {
  return EMPTY;
}
