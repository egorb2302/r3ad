'use client';

/**
 * Процедурный том.
 *
 * Ни одного внешнего меша: вся геометрия выводится из числа страниц, потому что
 * она обязана меняться вместе с ним. Толщина блоков — прямая функция разбивки
 * (SPEC §6.3), а не подобранная на глаз константа.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { mm, PHYS, splitBlock } from '@/core/units';
import { edgeTextureFor } from './materials/edgeTexture';

const TRIM_W = mm(PHYS.trimWidthMm);
const TRIM_H = mm(PHYS.trimHeightMm);
const COVER_T = mm(PHYS.coverThicknessMm);
const SQUARE = mm(PHYS.coverSquareMm);
const GUTTER = mm(PHYS.hingeMm) / 2;

const COVER_W = TRIM_W + SQUARE;
const COVER_H = TRIM_H + SQUARE * 2;

/** Блок нулевой толщины вырождается в плоскость — в начале и в конце книги. */
const MIN_BLOCK = 0.004;

const PAPER = '#efe6d4';
const COVER_COLOR = '#5c2b2b';

/**
 * Заглушка под текстуру страницы.
 *
 * Материал с самого начала собирается с картой, даже когда страница ещё не
 * отрисована: если map появляется позже, three пересобирает шейдер, и первый
 * кадр после подстановки текстуры даёт заметную задержку. Один кремовый пиксель
 * стоит ничего и снимает вопрос.
 */
const BLANK_PAGE = (() => {
  const rgba = new THREE.Color(PAPER).convertLinearToSRGB();
  const texture = new THREE.DataTexture(
    new Uint8Array([Math.round(rgba.r * 255), Math.round(rgba.g * 255), Math.round(rgba.b * 255), 255]),
    1,
    1,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
})();

interface HalfProps {
  side: 'left' | 'right';
  thickness: number;
  sheets: number;
  texture: THREE.Texture | null;
}

function Half({ side, thickness, sheets, texture }: HalfProps) {
  const dir = side === 'right' ? 1 : -1;
  const block = Math.max(thickness, MIN_BLOCK);

  const edge = useMemo(() => edgeTextureFor(sheets, TRIM_H), [sheets]);

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
  /** Всего листов в томе — задаёт толщину блока. */
  sheets: number;
  /** На каком листе открыт — делит блок на прочитанное и непрочитанное. */
  currentSheet: number;
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
export function Book({ sheets, currentSheet, leftPage, rightPage }: BookProps) {
  const split = splitBlock(sheets, currentSheet);

  return (
    <group position={[0, 0, 0]}>
      <Half
        side="left"
        thickness={mm(split.leftMm)}
        sheets={Math.max(1, currentSheet)}
        texture={leftPage}
      />
      <Half
        side="right"
        thickness={mm(split.rightMm)}
        sheets={Math.max(1, sheets - currentSheet)}
        texture={rightPage}
      />

      {/* Корешок под жёлобом: соединяет крышки и прячет разрыв между блоками */}
      <mesh position={[0, COVER_T / 2, 0]} receiveShadow>
        <boxGeometry args={[GUTTER * 2 + 0.02, COVER_T, COVER_H]} />
        <meshPhysicalMaterial color="#4a2222" roughness={0.85} sheen={0.4} />
      </mesh>
    </group>
  );
}
