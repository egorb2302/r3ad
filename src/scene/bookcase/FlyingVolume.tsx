'use client';

/**
 * Летящий том.
 *
 * Закрытая книга — это коробка с напечатанным корешком, ровно такая же, как
 * сорок стоящих в ряду: та же геометрия, тот же атлас, та же клетка. Поэтому в
 * момент посадки на полку подмены не видно — том просто перестаёт быть
 * отдельным мешем и становится инстансом.
 *
 * На столе подмена другая: закрытая коробка сменяется раскрытой книгой. Обе в
 * этот кадр закрыты, одного размера, в одном месте и одного цвета — крышки
 * раскрытой книги красятся тем же переплётным тоном, что и корешок, — так что
 * стык приходится на кадр, в котором обе выглядят одинаково. Честнее было бы
 * раскрывать саму коробку, но это уже не коробка, а вторая модель книги.
 *
 * **Крышки с M6 печатаются.** Полёт — единственный кадр, где закрытую книгу
 * видно с лица: на полке от неё остаётся корешок, на столе она раскрыта. Ради
 * этих девятисот миллисекунд том и получает те же карты крышки, что книга на
 * столе, — иначе тиснение, ради которого затевалась вся кастомизация, не было
 * бы видно нигде.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Placement } from '@/core/library/shelfLayout';
import type { VolumeRecord } from '@/core/library/volume';
import { coverSurface } from '../materials/cover';
import { VOLUME_DEPTH, VOLUME_HEIGHT } from './caseGeometry';
import { composeShelfPose } from './pose';
import { spineAtlas } from './spineAtlas';
import { soloSpineResources } from './spineInstances';
import { easeInOutCubic, flight, landingBounce, stepFlight } from '../flight';
import {
  DESK_QUATERNION,
  deskPosition,
  flightPath,
  flightPosition,
} from '../route';

export interface FlyingVolumeProps {
  volume: VolumeRecord;
  /** Толщина закрытого тома при текущем наборе. */
  thickness: number;
  /** Слот, из которого том вылетает или в который садится. */
  placement: Placement;
  /** Анимация доиграла. */
  onArrived: () => void;
}

export function FlyingVolume({ volume, thickness, placement, onArrived }: FlyingVolumeProps) {
  const mesh = useRef<THREE.Mesh>(null);

  // Путь и обе позы считаются один раз на полёт: они не меняются, пока книга
  // в воздухе, а пересчитывать кривую в кадре означало бы дрожание траектории.
  const route = useMemo(() => {
    const desk = deskPosition(thickness, new THREE.Vector3());
    const shelf = new THREE.Vector3();
    const shelfQuaternion = new THREE.Quaternion();
    composeShelfPose(placement, 0, 0, shelf, shelfQuaternion);

    return { curve: flightPath(desk, shelf), shelfQuaternion, point: new THREE.Vector3() };
  }, [placement, thickness]);

  /*
   * Материалы граней: две крышки печатаются, остальные четыре берут атлас.
   * Порядок BoxGeometry — +x, −x, +y, −y, +z, −z, и по развёртке (spineMesh)
   * крышки лежат на ±x, а корешок на +z.
   */
  const materials = useMemo(() => {
    const solo = soloSpineResources().material;
    const faces = (['front', 'back'] as const).map((side) => {
      const art = coverSurface({ theme: volume.theme, title: volume.title, author: volume.author, side });
      return new THREE.MeshStandardMaterial({
        map: art.map,
        bumpMap: art.bumpMap,
        bumpScale: art.bumpScale,
        roughness: art.roughness,
      });
    });
    return [faces[0], faces[1], solo, solo, solo, solo];
  }, [volume]);

  useEffect(
    () => () => {
      for (const material of materials.slice(0, 2)) material.dispose();
    },
    [materials],
  );

  // Клетка атласа задаётся сдвигом карты: у одиночного меша врезки в шейдер нет.
  useEffect(() => {
    const cell = spineAtlas().cellFor(volume, thickness);
    const map = soloSpineResources().material.map;
    if (!map) return;
    map.offset.set(cell.u0, cell.v0);
    map.repeat.set(cell.du, cell.dv);
    map.needsUpdate = true;
  }, [thickness, volume]);

  useFrame((state, delta) => {
    const node = mesh.current;
    if (!node) return;

    // Полёт идёт в кадре, а кадры выдаются по требованию (см. Viewport).
    state.invalidate();

    const done = stepFlight(delta);

    // Пока книга закрывается или раскрывается на столе, показывать нечего:
    // в эти такты на столе работает раскрытая книга.
    node.visible = flight.path > 0;

    if (node.visible) {
      const p = easeInOutCubic(flight.path);
      route.curve.getPoint(p, route.point);
      node.position.copy(route.point);
      node.position.y += landingBounce(flight.path, flight.kind);
      node.quaternion.slerpQuaternions(DESK_QUATERNION, route.shelfQuaternion, p);
      node.scale.set(thickness, VOLUME_HEIGHT, VOLUME_DEPTH);
      // Камере нужно знать, где книга: иначе она провожает пустой воздух.
      flightPosition.copy(node.position);
    }

    if (done) onArrived();
  });

  return (
    <mesh ref={mesh} material={materials} castShadow receiveShadow>
      <primitive object={soloSpineResources().geometry} attach="geometry" />
    </mesh>
  );
}
