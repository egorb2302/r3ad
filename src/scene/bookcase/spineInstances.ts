'use client';

/**
 * Ресурсы инстансированного ряда: одна геометрия, один материал, два буфера.
 *
 * Живут в модуле, а не в компоненте, по той же причине, что и прогресс
 * переворота (см. scene/turn.ts): их содержимое переписывается в каждом кадре,
 * а правила React Compiler запрещают и трогать значения хуков, и читать ref во
 * время рендера. Ряд корешков в сцене ровно один — стеллаж один, — поэтому
 * модульный синглтон здесь не срезание угла, а честное описание того, что есть.
 *
 * Ёмкость взята из атласа: клеток в нём столько же, сколько инстансов в буфере.
 * Одно число задаёт оба предела, и разъехаться им негде.
 */
import * as THREE from 'three';
import { SPINE_CAPACITY } from './atlasGrid';
import { spineGeometry, spineMaterial } from './spineMesh';


export interface SpineResources {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Клетка атласа на инстанс: u0, v0, du, dv. */
  cells: THREE.InstancedBufferAttribute;
  /** Подсветка инстанса под курсором. */
  tints: THREE.InstancedBufferAttribute;
}

let shared: SpineResources | null = null;

export function spineResources(): SpineResources {
  if (shared) return shared;

  const geometry = spineGeometry();
  const cells = new THREE.InstancedBufferAttribute(new Float32Array(SPINE_CAPACITY * 4), 4);
  const tints = new THREE.InstancedBufferAttribute(new Float32Array(SPINE_CAPACITY), 1);
  cells.setUsage(THREE.DynamicDrawUsage);
  tints.setUsage(THREE.DynamicDrawUsage);

  geometry.setAttribute('aCell', cells);
  geometry.setAttribute('aTint', tints);

  shared = { geometry, material: spineMaterial(true), cells, tints };
  return shared;
}

interface SoloResources {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

let solo: SoloResources | null = null;

/**
 * Ресурсы одиночного тома — того, который сейчас летит.
 *
 * Тоже синглтон: в воздухе одновременно бывает ровно одна книга, а клетку
 * атласа одиночному мешу задаёт штатное преобразование карты, без врезки в
 * шейдер. Материал переиспользуется между полётами: пересоздавать его — значит
 * заново компилировать программу на каждое снятие книги с полки.
 */
export function soloSpineResources(): SoloResources {
  solo ??= { geometry: spineGeometry(), material: spineMaterial(false) };
  return solo;
}
