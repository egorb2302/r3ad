'use client';

/**
 * Маршрут книги: путь, поза на столе и место тома в мире.
 *
 * Отделено от `flight.ts` ради веса: тем состоянием распоряжается библиотека, а
 * она грузится всегда — и утаскивала бы за собой three даже в плоский режим.
 * Здесь же всё, чему без three не обойтись, и пользуются этим только те, кто
 * книгу рисует.
 */
import * as THREE from 'three';
import { COVER_W, GUTTER } from './geometry';
import { flight } from './flight';

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
