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
 *
 * **С M6 книга ещё и одета.** Тема (§8) приезжает сюда целиком, и из неё
 * выводится всё: материал крышек и их рельеф, тиснение на лице, тон и плотность
 * бумаги, окраска обреза, лента-закладка. Ни один из этих параметров не
 * подмешивается на месте — иначе том на столе и корешок на полке, который
 * рисуется из той же темы своим кодом, разошлись бы в первый же день.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { paletteOf, PAPERS, type BookTheme } from '@/core/theme';
import { coverGeometry, coverSurface } from './materials/cover';
import { edgeSurface, edgeTextureFor } from './materials/edgeTexture';
import { leafShadowTexture } from './materials/pageCurl';
import { flight } from './flight';
import { blankPage } from './blank';
import {
  blockThickness,
  COVER_H,
  COVER_T,
  COVER_W,
  GUTTER,
  TRIM_H,
  TRIM_W,
} from './geometry';

/**
 * Ширина тени у корешка.
 *
 * Раскрытая книга не лежит плоско: у жёлоба страницы уходят вниз, и по обе
 * стороны от корешка ложится мягкая тень. Без неё разворот читается двумя
 * листами бумаги, положенными рядом. Рисуется той же градиентной картой, что
 * тень поднятого листа, — это одна и та же тень, только неподвижная.
 */
const GUTTER_SHADE = 2.8;

interface HalfProps {
  side: 'left' | 'right';
  sheets: number;
  texture: THREE.Texture | null;
  theme: BookTheme;
  title: string;
  author: string;
}

function Half({ side, sheets, texture, theme, title, author }: HalfProps) {
  const dir = side === 'right' ? 1 : -1;
  const paper = PAPERS[theme.paper.tint];
  const block = blockThickness(sheets, theme.paper.gsm);

  const look = useMemo(
    () => ({ kind: theme.paper.edge, color: theme.paper.edgeColor, tint: theme.paper.tint }),
    [theme.paper.edge, theme.paper.edgeColor, theme.paper.tint],
  );
  const edge = useMemo(() => edgeTextureFor(Math.max(1, sheets), TRIM_H, look), [look, sheets]);

  /**
   * Порядок материалов BoxGeometry: +x, -x, +y, -y, +z, -z.
   * Обрез виден с трёх сторон; со стороны корешка — сгиб, туда бумага.
   */
  const blockMaterials = useMemo(() => {
    const surface = edgeSurface(look);
    const sheet = new THREE.MeshStandardMaterial({ color: paper.block, roughness: 0.95 });
    const edged = new THREE.MeshStandardMaterial({ map: edge, ...surface });
    const fore = side === 'right' ? [edged, sheet] : [sheet, edged];
    return [fore[0], fore[1], sheet, sheet, edged, edged];
  }, [edge, look, paper.block, side]);

  /*
   * Крышка красится двумя материалами, а не одним.
   *
   * Снаружи у неё напечатанное лицо — тиснение, рамка, потёртость; изнутри и с
   * торцов тот же материал без печати. Один материал на все шесть граней
   * означал бы название, продублированное на каждом торце картона.
   *
   * Наружу у раскрытой книги смотрит грань −y: крышка лежит на столе, блок на
   * ней сверху. Видно её поэтому не всегда, а в тот момент, ради которого она и
   * рисуется, — когда книга закрывается и переворачивается на полку.
   */
  const cover = useMemo(() => coverGeometry(COVER_W, COVER_T, COVER_H), []);
  useEffect(() => () => cover.dispose(), [cover]);

  const coverMaterials = useMemo(() => {
    const art = coverSurface({ theme, title, author, side: side === 'right' ? 'front' : 'back' });
    const printed = new THREE.MeshPhysicalMaterial({
      map: art.map,
      bumpMap: art.bumpMap,
      bumpScale: art.bumpScale,
      roughness: art.roughness,
      sheen: art.sheen,
      sheenColor: new THREE.Color(theme.cover.color),
      sheenRoughness: 0.7,
      clearcoat: art.clearcoat,
      clearcoatRoughness: 0.35,
    });
    const plain = new THREE.MeshPhysicalMaterial({
      color: theme.cover.color,
      bumpMap: art.bumpMap,
      bumpScale: art.bumpScale,
      roughness: art.roughness,
      sheen: art.sheen,
      sheenColor: new THREE.Color(theme.cover.color),
      sheenRoughness: 0.7,
      clearcoat: art.clearcoat,
      clearcoatRoughness: 0.35,
    });

    return [plain, printed];
  }, [author, side, theme, title]);

  /*
   * Материалы и клон текстуры обреза пересоздаются при каждой смене толщины
   * стопки, то есть на каждом перевороте. Без явной уборки это утечка ровно в
   * том месте, где книгой пользуются дольше всего. Сами карты (крышка, зерно)
   * живут в своих кэшах и переживают материал — их не трогаем.
   */
  useEffect(
    () => () => {
      edge.dispose();
      for (const material of new Set(blockMaterials)) material.dispose();
    },
    [blockMaterials, edge],
  );

  useEffect(
    () => () => {
      for (const material of new Set(coverMaterials)) material.dispose();
    },
    [coverMaterials],
  );

  const blockCenterX = dir * (GUTTER + TRIM_W / 2);
  const blockCenterY = COVER_T + block / 2;
  const pageY = COVER_T + block + 0.004;

  return (
    <group>
      {/* Переплётная крышка */}
      <mesh
        position={[dir * (GUTTER + COVER_W / 2), COVER_T / 2, 0]}
        geometry={cover}
        material={coverMaterials}
        castShadow
        receiveShadow
      />

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
        <meshStandardMaterial map={texture ?? blankPage(theme.paper.tint)} roughness={0.94} />
      </mesh>

      {/* Тень у корешка: темнее к жёлобу, сходит на нет к полосе набора */}
      <mesh
        position={[dir * (GUTTER + GUTTER_SHADE / 2), pageY + 0.003, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[dir, 1, 1]}
        renderOrder={1}
      >
        <planeGeometry args={[GUTTER_SHADE, TRIM_H]} />
        <meshBasicMaterial
          map={leafShadowTexture()}
          color="#000000"
          transparent
          opacity={0.3}
          depthWrite={false}
        />
      </mesh>

      {side === 'right' && theme.ribbon ? (
        <Ribbon color={theme.ribbon} y={pageY} />
      ) : null}
    </group>
  );
}

/**
 * Лента-закладка.
 *
 * Две плоскости: лежащая на странице и свисающая за обрез. Ткань не гнётся, а
 * ломается под прямым углом, и это правильнее, чем кажется: настоящая ленточка
 * ложится на край блока именно сгибом, а не дугой. Дуга стоила бы кривой,
 * сегментов и своего шейдера — ради детали шириной в восемь миллиметров.
 */
function Ribbon({ color, y }: { color: string; y: number }) {
  const width = 0.8;
  // Длиннее страницы: лента и должна вылезать за передний обрез, иначе это не
  // закладка, а полоска на бумаге.
  const lying = TRIM_W + 1;
  const tail = 3.4;
  const z = TRIM_H * 0.16;
  const x = GUTTER + lying / 2;

  return (
    <group>
      <mesh position={[x, y + 0.004, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[lying, width]} />
        <meshStandardMaterial color={color} roughness={0.62} side={THREE.DoubleSide} />
      </mesh>
      {/* Хвост уходит за передний обрез и висит вдоль него. */}
      <mesh position={[GUTTER + lying, y - tail / 2, z]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[width, tail]} />
        <meshStandardMaterial color={color} roughness={0.62} side={THREE.DoubleSide} />
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
   * Внешность тома — та же, из которой напечатан корешок на полке. Книга,
   * вернувшаяся со стеллажа, обязана быть той же самой книгой, а не другой
   * такого же размера.
   */
  theme: BookTheme;
  title: string;
  author: string;
}

/**
 * Книга — чистая функция от пропсов, без обращений к стору.
 *
 * Не стилистика: R3F монтирует детей Canvas в собственный React-корень, и
 * подписка на внешний стор изнутри него не доходит до отрисовки, пока по сцене
 * не щёлкнут мышью — книга остаётся пустой при уже посчитанной вёрстке.
 * Состояние читается снаружи, во Viewport, и втекает сюда пропсами.
 */
export function Book({
  leftSheets,
  rightSheets,
  leftPage,
  rightPage,
  theme,
  title,
  author,
}: BookProps) {
  const root = useRef<THREE.Group>(null);
  const flip = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Mesh>(null);
  const gsm = theme.paper.gsm;
  const palette = paletteOf(theme);

  useFrame(() => {
    /*
     * Пока закрытый том летит на полку, его показывает FlyingVolume — коробка с
     * напечатанным корешком. Раскрытая книга в эти кадры не нужна, но и
     * размонтировать её нельзя: тогда по возвращении заново считались бы
     * текстуры разворота.
     */
    if (root.current) root.current.visible = !(flight.active && flight.path > 0);

    const close = flight.active ? flight.close : 0;

    const leftHeight = COVER_T + blockThickness(leftSheets, gsm);
    const rightHeight = COVER_T + blockThickness(rightSheets, gsm);

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
          <Half
            side="left"
            sheets={leftSheets}
            texture={leftPage}
            theme={theme}
            title={title}
            author={author}
          />
        </group>
      </group>

      <Half
        side="right"
        sheets={rightSheets}
        texture={rightPage}
        theme={theme}
        title={title}
        author={author}
      />

      {/* Корешок под жёлобом: соединяет крышки и прячет разрыв между блоками */}
      <mesh ref={spine} position={[0, COVER_T / 2, 0]} receiveShadow>
        <boxGeometry args={[GUTTER * 2 + 0.02, COVER_T, COVER_H]} />
        <meshPhysicalMaterial color={palette.panel} roughness={0.85} sheen={0.4} />
      </mesh>
    </group>
  );
}
