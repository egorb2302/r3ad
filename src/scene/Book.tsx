'use client';

/**
 * Процедурный том.
 *
 * Ни одного внешнего меша: вся геометрия выводится из числа страниц, потому что
 * она обязана меняться вместе с ним. Толщина блоков — прямая функция разбивки
 * (SPEC §6.3), а не подобранная на глаз константа.
 *
 * Толщина половин задаётся снаружи двумя числами, а не «сколько всего листов и
 * на каком мы сейчас». Во время переворота лист не принадлежит ни левой стопке,
 * ни правой — он в воздухе, — и сумма половин на один меньше полной. Считать это
 * внутри книги значило бы протаскивать сюда состояние анимации.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { edgeTextureFor } from './materials/edgeTexture';
import {
  BLANK_PAGE,
  blockThickness,
  COVER_COLOR,
  COVER_H,
  COVER_T,
  COVER_W,
  GUTTER,
  PAPER,
  TRIM_H,
  TRIM_W,
} from './geometry';

interface HalfProps {
  side: 'left' | 'right';
  sheets: number;
  texture: THREE.Texture | null;
}

function Half({ side, sheets, texture }: HalfProps) {
  const dir = side === 'right' ? 1 : -1;
  const block = blockThickness(sheets);

  const edge = useMemo(() => edgeTextureFor(Math.max(1, sheets), TRIM_H), [sheets]);

  /**
   * Порядок материалов BoxGeometry: +x, -x, +y, -y, +z, -z.
   * Обрез виден с трёх сторон; со стороны корешка — сгиб, туда бумага.
   */
  const blockMaterials = useMemo(() => {
    const paper = new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.95 });
    const edged = new THREE.MeshStandardMaterial({ map: edge, roughness: 0.88 });
    const fore = side === 'right' ? [edged, paper] : [paper, edged];
    return [fore[0], fore[1], paper, paper, edged, edged];
  }, [edge, side]);

  const blockCenterX = dir * (GUTTER + TRIM_W / 2);
  const blockCenterY = COVER_T + block / 2;
  const pageY = COVER_T + block + 0.004;

  return (
    <group>
      {/* Переплётная крышка */}
      <mesh position={[dir * (GUTTER + COVER_W / 2), COVER_T / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[COVER_W, COVER_T, COVER_H]} />
        <meshPhysicalMaterial
          color={COVER_COLOR}
          roughness={0.82}
          sheen={0.6}
          sheenColor="#8b5a4a"
          sheenRoughness={0.7}
        />
      </mesh>

      {/* Блок: его высота и есть «сколько страниц» */}
      <mesh
        position={[blockCenterX, blockCenterY, 0]}
        material={blockMaterials}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[TRIM_W, block, TRIM_H]} />
      </mesh>

      {/* Верхняя страница стопки — единственная, у которой есть текстура текста */}
      <mesh position={[blockCenterX, pageY, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[TRIM_W, TRIM_H]} />
        <meshStandardMaterial map={texture ?? BLANK_PAGE} roughness={0.94} />
      </mesh>
    </group>
  );
}

export interface BookProps {
  leftSheets: number;
  rightSheets: number;
  leftPage: THREE.Texture | null;
  rightPage: THREE.Texture | null;
}

/**
 * Книга — чистая функция от пропсов, без обращений к стору.
 *
 * Не стилистика: R3F монтирует детей Canvas в собственный React-корень, и
 * подписка на внешний стор изнутри него не доходит до отрисовки, пока по сцене
 * не щёлкнут мышью — книга остаётся пустой при уже посчитанной вёрстке.
 * Состояние читается снаружи, во Viewport, и втекает сюда пропсами.
 */
export function Book({ leftSheets, rightSheets, leftPage, rightPage }: BookProps) {
  return (
    <group position={[0, 0, 0]}>
      <Half side="left" sheets={leftSheets} texture={leftPage} />
      <Half side="right" sheets={rightSheets} texture={rightPage} />

      {/* Корешок под жёлобом: соединяет крышки и прячет разрыв между блоками */}
      <mesh position={[0, COVER_T / 2, 0]} receiveShadow>
        <boxGeometry args={[GUTTER * 2 + 0.02, COVER_T, COVER_H]} />
        <meshPhysicalMaterial color="#4a2222" roughness={0.85} sheen={0.4} />
      </mesh>
    </group>
  );
}
