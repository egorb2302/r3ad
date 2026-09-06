'use client';

/**
 * Поза тома на полке.
 *
 * Вынесена отдельно, потому что позу считают двое: инстансированный ряд и
 * летящая книга. Ряд ставит по ней сорок матриц, полёт — начало и конец пути.
 * Разойдись у них хоть один поворот, книга при посадке дёргалась бы на месте,
 * а это ровно тот кадр, ради которого веха и делается.
 *
 * Три поворота накладываются в таком порядке: завал последнего в ряду, наклон
 * выбранного тома наружу и выдвижение под курсором. Порядок не произвольный —
 * это порядок, в котором они происходят с настоящей книгой: сначала она стоит
 * (или заваливается), потом её наклоняют, потом тянут.
 */
import * as THREE from 'three';
import type { Placement } from '@/core/library/shelfLayout';
import {
  SHELF_BOOK_Z,
  SHELF_LEFT,
  shelfSurfaceY,
  VOLUME_DEPTH,
  VOLUME_HEIGHT,
} from './caseGeometry';

/** Насколько том выезжает из ряда под курсором. */
export const HOVER_OUT = 1.1;

/** Угол наклона выбранного тома наружу. Дальше он уже выпадает из ряда. */
export const ARM_ANGLE = 0.34;

/** Насколько выбранный том дополнительно вытянут: наклон без вытяжки не читается. */
export const ARM_OUT = 1.8;

const scratch = {
  pivot: new THREE.Vector3(),
  rotation: new THREE.Quaternion(),
};

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Повернуть точку вокруг оси, проходящей через pivot. */
function rotateAround(
  point: THREE.Vector3,
  pivot: THREE.Vector3,
  rotation: THREE.Quaternion,
): void {
  point.sub(pivot).applyQuaternion(rotation).add(pivot);
}

/**
 * Мировая поза тома.
 *
 * `hover` — выдвижение под курсором, `arm` — наклон наружу перед тем, как книгу
 * вытащат. Оба в долях: анимация живёт снаружи, здесь только геометрия.
 */
export function composeShelfPose(
  placement: Placement,
  hover: number,
  arm: number,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
): void {
  const surfaceY = shelfSurfaceY(placement.shelf);

  position.set(
    SHELF_LEFT + placement.x,
    surfaceY + VOLUME_HEIGHT / 2,
    SHELF_BOOK_Z + hover * HOVER_OUT + arm * ARM_OUT,
  );
  quaternion.identity();

  /*
   * Завал: книга опирается нижним углом со стороны свободного места и
   * заваливается туда верхом. Ось поворота проходит через этот угол, иначе том
   * уехал бы сквозь соседа.
   */
  if (placement.tilt > 0) {
    scratch.rotation.setFromAxisAngle(Z_AXIS, -placement.tilt);
    scratch.pivot.set(position.x + placement.thickness / 2, surfaceY, position.z);
    rotateAround(position, scratch.pivot, scratch.rotation);
    quaternion.premultiply(scratch.rotation);
  }

  // Наклон наружу — вокруг нижней передней кромки: так книгу и вынимают с полки.
  if (arm > 0) {
    scratch.rotation.setFromAxisAngle(X_AXIS, arm * ARM_ANGLE);
    scratch.pivot.set(position.x, surfaceY, SHELF_BOOK_Z + VOLUME_DEPTH / 2);
    rotateAround(position, scratch.pivot, scratch.rotation);
    quaternion.premultiply(scratch.rotation);
  }
}

/** Масштаб единичной коробки под габариты тома. */
export function volumeScale(thickness: number, scale: THREE.Vector3): THREE.Vector3 {
  return scale.set(thickness, VOLUME_HEIGHT, VOLUME_DEPTH);
}
