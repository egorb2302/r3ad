'use client';

/**
 * Комната вокруг стола.
 *
 * До этого книга лежала на бесконечной тёмной плоскости, а стеллаж стоял на
 * ней же — то есть на столе. Теперь ноль сцены по-прежнему столешница (вся
 * геометрия книги считается от него с M0), но стол стоит на полу, стеллаж —
 * на полу за столом, а вокруг стены, окно, ковёр, растения и мелочи на столе.
 *
 * Сцена — про книгу, и комната обязана оставаться фоном. Отсюда ограничения:
 * ничего не движется, ничего не ловит указатель, и всё вместе стоит четыре
 * вызова отрисовки — матовое, глянцевое, светящееся и дерево (см. decor).
 * Растения и предметы — простые скруглённые формы в пастели: их задача не
 * притягивать взгляд, а давать книге место, где она лежит.
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { SceneTheme } from '@/core/theme';
import { RIGS } from '../lighting';
import { woodTexture } from '../bookcase/wood';
import { FLOOR_Y } from '../bookcase/caseGeometry';
import { buildRoom, DESK, plankTexture, WALL_X, WALL_Z } from './decor';

export function Room({ scene }: { scene: SceneTheme }) {
  const palette = RIGS[scene.preset].room;

  const shapes = useMemo(() => buildRoom(palette), [palette]);
  useEffect(() => () => shapes.dispose(), [shapes]);

  /*
   * Три материала на всю комнату. Вершинные цвета — единственный источник
   * окраски: сменить пресет значит собрать геометрию заново, а не перекрасить
   * материал, и это правильно — вместе с краской стен меняется и свет в окне.
   */
  const materials = useMemo(
    () => ({
      matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
      glossy: new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.38,
        metalness: 0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.4,
      }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    }),
    [],
  );
  useEffect(() => () => {
    for (const material of Object.values(materials)) material.dispose();
  }, [materials]);

  // Стол — из той же породы, что и стеллаж, но под светлым лаком (см. wood.ts).
  const wood = useMemo(() => woodTexture(DESK.w / 16, DESK.d / 16, scene.wood, true), [scene.wood]);
  useEffect(() => () => wood.dispose(), [wood]);

  const floor = plankTexture(palette.floor);

  return (
    <group>
      {/* Пол: доски под всем, до стен */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 20]} receiveShadow>
        <planeGeometry args={[WALL_X * 2 + 40, -WALL_Z + 300]} />
        <meshStandardMaterial map={floor} roughness={0.9} metalness={0} />
      </mesh>

      <mesh geometry={shapes.wood} receiveShadow>
        <meshStandardMaterial map={wood} roughness={0.62} metalness={0} />
      </mesh>

      <mesh geometry={shapes.matte} material={materials.matte} receiveShadow />
      <mesh geometry={shapes.glossy} material={materials.glossy} />
      <mesh geometry={shapes.glow} material={materials.glow} />
    </group>
  );
}
