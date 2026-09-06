'use client';

/**
 * Полёт книги между столом и полкой.
 *
 * Устроено так же, как переворот страницы (см. turn.ts): изменяемый объект,
 * который читает и пишет кадровый цикл, и ни одного числа этой анимации в
 * сторе. Причина та же — шестьдесят реконсиляций в секунду ради трёх float'ов
 * не нужны никому.
 *
 * Анимация двухтактная, и такты не смешиваются: сначала книга закрывается на
 * столе, потом летит. В обратную сторону — сначала долетает, потом
 * раскрывается. Смешать их означало бы показать раскрытую книгу, кувыркающуюся
 * в воздухе, — ровно то, чего с книгами не бывает.
 */
import * as THREE from 'three';
import { COVER_W, GUTTER } from './geometry';

export type FlightKind = 'shelve' | 'take';

export interface FlightMotion {
  active: boolean;
  kind: FlightKind;
  /** Закрытость книги: 0 — раскрыта на столе, 1 — закрыта. */
  close: number;
  /** Положение на пути: 0 — стол, 1 — полка. */
  path: number;
}

export const flight: FlightMotion = {
  active: false,
  kind: 'shelve',
  close: 0,
  path: 0,
};

/**
 * Где книга сейчас.
 *
 * Пишется тем, кто её рисует, читается камерой. Иначе полёт со стеллажа к столу
 * проходит мимо кадра: стол и полка разнесены на два метра, и ни один из двух
 * ракурсов не видит обоих концов пути.
 */
export const flightPosition = new THREE.Vector3();

/**
 * Насколько камере сейчас держаться за летящую книгу.
 *
 * Ноль на обоих концах пути и максимум посередине: у полки и у стола книга и так
 * в кадре, а вот между ними её надо вести. Так камера не дёргается в моменты
 * взлёта и посадки — там она смотрит туда, куда и должна по своему ракурсу.
 */
export function flightFocus(): number {
  if (!flight.active || flight.path <= 0 || flight.path >= 1) return 0;
  const p = flight.kind === 'shelve' ? flight.path : 1 - flight.path;
  return Math.sin(Math.PI * p) * 0.9;
}

/** Закрыть или раскрыть книгу. Крышка идёт медленнее полёта: это жест, а не бросок. */
const CLOSE_SECONDS = 0.52;

/** Полёт. Величина из SPEC §7.3. */
const FLY_SECONDS = 0.9;

export function startFlight(kind: FlightKind) {
  flight.active = true;
  flight.kind = kind;
  flight.close = kind === 'shelve' ? 0 : 1;
  flight.path = kind === 'shelve' ? 0 : 1;
}

export function stopFlight() {
  flight.active = false;
}

/** Шаг анимации. true — долетели и доигрались. */
export function stepFlight(dt: number): boolean {
  if (!flight.active) return false;
  const step = Math.min(dt, 1 / 30);

  if (flight.kind === 'shelve') {
    if (flight.close < 1) {
      flight.close = Math.min(1, flight.close + step / CLOSE_SECONDS);
      return false;
    }
    flight.path = Math.min(1, flight.path + step / FLY_SECONDS);
    return flight.path >= 1;
  }

  if (flight.path > 0) {
    flight.path = Math.max(0, flight.path - step / FLY_SECONDS);
    return false;
  }
  flight.close = Math.max(0, flight.close - step / CLOSE_SECONDS);
  return flight.close <= 0;
}

export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Микроотскок при посадке.
 *
 * Том не прилипает к полке: он осаживается и подбирается обратно. Полсантиметра
 * и полтора десятка кадров — ровно столько, чтобы движение читалось как вес, а
 * не как ошибка.
 */
export function landingBounce(path: number, kind: FlightKind): number {
  const landing = kind === 'shelve' ? path : 1 - path;
  if (landing < 0.86) return 0;
  const u = (landing - 0.86) / 0.14;
  return -Math.sin(u * Math.PI * 2) * 0.35 * (1 - u);
}

/**
 * Поза закрытого тома на столе.
 *
 * Книга лежит крышкой вверх, корешком влево, головкой от читателя — так, как её
 * кладут, а не так, как удобно считать. Координаты совпадают с тем, что рисует
 * раскрытая книга при закрытой крышке: полёт и чтение обязаны стыковаться без
 * рывка.
 */
export function deskPosition(thickness: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(GUTTER + COVER_W / 2, thickness / 2, 0);
}

/**
 * Поворот из собственных осей тома в позу «лежит на столе».
 *
 * Оси тома: x — толщина, y — от хвоста к головке, z — наружу из корешка. На
 * столе толщина смотрит вверх, головка — от читателя, корешок — влево.
 */
export const DESK_QUATERNION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
  ),
);

/** Высота дуги над прямой «стол — полка». */
const ARC_LIFT = 16;

/**
 * Путь книги.
 *
 * Кривая Catmull-Rom по четырём точкам: концы — стол и слот, между ними две
 * приподнятые. Прямая линия между полкой и столом прошла бы сквозь стеллаж и
 * читалась бы как телепортация; дуга вверх — то, как книгу и переносят.
 */
export function flightPath(from: THREE.Vector3, to: THREE.Vector3): THREE.CatmullRomCurve3 {
  const lift = new THREE.Vector3(0, ARC_LIFT, 0);
  const a = from.clone().lerp(to, 0.3).add(lift);
  const b = from.clone().lerp(to, 0.7).add(lift);
  return new THREE.CatmullRomCurve3([from.clone(), a, b, to.clone()], false, 'catmullrom', 0.5);
}

if (process.env.NODE_ENV !== 'production') {
  (globalThis as { __r3adFlight?: FlightMotion }).__r3adFlight = flight;
}
