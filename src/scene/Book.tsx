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
 *
 * Всё содержательное книга получает пропсами и ниоткуда больше. Единственное
 * исключение — закрывание крышки: это анимация, она живёт в кадре (см.
 * scene/flight.ts) и применяется прямо к матрицам, как и прогресс переворота.
 * Гнать её через React значило бы тридцать реконсиляций за полсекунды ради
 * одного угла.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SpinePalette } from '@/core/library/palette';
import { edgeTextureFor } from './materials/edgeTexture';
import { flight } from './flight';
import {
  BLANK_PAGE,
  blockThickness,
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
  palette: SpinePalette;
}

function Half({ side, sheets, texture, palette }: HalfProps) {
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

  /*
   * Материалы и клон текстуры обреза пересоздаются при каждой смене толщины
   * стопки, то есть на каждом перевороте. Без явной уборки это утечка ровно в
   * том месте, где книгой пользуются дольше всего.
   */
  useEffect(
    () => () => {
      edge.dispose();
      for (const material of new Set(blockMaterials)) material.dispose();
    },
    [blockMaterials, edge],
  );

  const blockCenterX = dir * (GUTTER + TRIM_W / 2);
  const blockCenterY = COVER_T + block / 2;
  const pageY = COVER_T + block + 0.004;

  return (
    <group>
      {/* Переплётная крышка */}
      <mesh position={[dir * (GUTTER + COVER_W / 2), COVER_T / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[COVER_W, COVER_T, COVER_H]} />
        <meshPhysicalMaterial
          color={palette.cloth}
          roughness={0.82}
          sheen={0.6}
          sheenColor={palette.head}
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
  /**
   * Цвета переплёта — те же, что у корешка на полке. Книга, вернувшаяся со
   * стеллажа, обязана быть той же самой книгой, а не другой такого же размера.
   */
  palette: SpinePalette;
}

/**
 * Книга — чистая функция от пропсов, без обращений к стору.
 *
 * Не стилистика: R3F монтирует детей Canvas в собственный React-корень, и
 * подписка на внешний стор изнутри него не доходит до отрисовки, пока по сцене
 * не щёлкнут мышью — книга остаётся пустой при уже посчитанной вёрстке.
 * Состояние читается снаружи, во Viewport, и втекает сюда пропсами.
 */
export function Book({ leftSheets, rightSheets, leftPage, rightPage, palette }: BookProps) {
  const root = useRef<THREE.Group>(null);
  const flip = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Mesh>(null);

  useFrame(() => {
    /*
     * Пока закрытый том летит на полку, его показывает FlyingVolume — коробка с
     * напечатанным корешком. Раскрытая книга в эти кадры не нужна, но и
     * размонтировать её нельзя: тогда по возвращении заново считались бы
     * текстуры разворота.
     */
    if (root.current) root.current.visible = !(flight.active && flight.path > 0);

    const close = flight.active ? flight.close : 0;

    const leftHeight = COVER_T + blockThickness(leftSheets);
    const rightHeight = COVER_T + blockThickness(rightSheets);

    /*
     * Ось, вокруг которой переворачивается левая половина.
     *
     * Она не на столе, а посередине между высотами половин: поворот на π
     * отражает точку относительно оси, и левая стопка обязана после отражения
     * лечь ровно на правую, а не уйти под стол. Отсюда (hL + hR) / 2.
     */
    const pivot = (close * (leftHeight + rightHeight)) / 2;

    if (flip.current && inner.current) {
      flip.current.position.y = pivot;
      flip.current.rotation.z = close * Math.PI;
      inner.current.position.y = -pivot;
    }

    // У закрытой книги корешок во всю толщину тома, у раскрытой — в крышку.
    if (spine.current) {
      const height = COVER_T + close * (leftHeight + rightHeight - COVER_T);
      spine.current.scale.y = height / COVER_T;
      spine.current.position.y = height / 2;
    }
  });

  return (
    <group ref={root}>
      <group ref={flip}>
        <group ref={inner}>
          <Half side="left" sheets={leftSheets} texture={leftPage} palette={palette} />
        </group>
      </group>

      <Half side="right" sheets={rightSheets} texture={rightPage} palette={palette} />

      {/* Корешок под жёлобом: соединяет крышки и прячет разрыв между блоками */}
      <mesh ref={spine} position={[0, COVER_T / 2, 0]} receiveShadow>
        <boxGeometry args={[GUTTER * 2 + 0.02, COVER_T, COVER_H]} />
        <meshPhysicalMaterial color={palette.panel} roughness={0.85} sheen={0.4} />
      </mesh>
    </group>
  );
}
