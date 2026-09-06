'use client';

/**
 * Корпус стеллажа.
 *
 * Семь досок и задняя стенка — ничего больше. Стеллаж намеренно скучный: он
 * рамка для книг, и любая резьба на нём отняла бы внимание у того единственного,
 * ради чего сцена и существует, — у ряда корешков.
 *
 * Полки строятся циклом от числа полок, а не расставлены руками: число полок и
 * их шаг заявлены настройкой (SPEC §8), и разойдись здесь арифметика с той, по
 * которой считается расстановка, книги встали бы сквозь доски.
 */
import { useMemo } from 'react';
import { woodTexture } from './wood';
import { CASE, CASE_HEIGHT, CASE_WIDTH, CASE_Z } from './caseGeometry';

export function Bookcase() {
  const { boardMap, sideMap, backMap } = useMemo(
    () => ({
      boardMap: woodTexture(CASE.innerWidth / 24, CASE.depth / 24),
      sideMap: woodTexture(CASE.depth / 24, CASE_HEIGHT / 24),
      backMap: woodTexture(CASE.innerWidth / 30, CASE_HEIGHT / 30),
    }),
    [],
  );

  const sideX = CASE.innerWidth / 2 + CASE.board / 2;

  return (
    <group position={[0, 0, CASE_Z]}>
      {/* Боковины во всю высоту: полки опираются на них, а не наоборот */}
      {[-sideX, sideX].map((x) => (
        <mesh key={x} position={[x, CASE_HEIGHT / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[CASE.board, CASE_HEIGHT, CASE.depth]} />
          <meshStandardMaterial map={sideMap} roughness={0.84} metalness={0} />
        </mesh>
      ))}

      {/* Дно, полки и крышка — одна и та же доска на разной высоте */}
      {Array.from({ length: CASE.shelves + 1 }, (_, i) => (
        <mesh
          key={i}
          position={[0, i * (CASE.clearance + CASE.board) + CASE.board / 2, 0]}
          receiveShadow
        >
          <boxGeometry args={[CASE.innerWidth, CASE.board, CASE.depth]} />
          <meshStandardMaterial map={boardMap} roughness={0.86} metalness={0} />
        </mesh>
      ))}

      {/* Задняя стенка: тонкая фанера, в тени, за книгами почти не видна */}
      <mesh position={[0, CASE_HEIGHT / 2, -CASE.depth / 2 + CASE.back / 2]} receiveShadow>
        <boxGeometry args={[CASE.innerWidth, CASE_HEIGHT, CASE.back]} />
        <meshStandardMaterial map={backMap} color="#7a5c42" roughness={0.92} metalness={0} />
      </mesh>

      {/*
        Тёмная плоскость чуть впереди задней стенки. Карт теней в сцене нет
        (см. Viewport), а нутро стеллажа обязано быть глубже фасада — иначе
        полка читается как рисунок на стене. Дешевле всего это подмешать
        прямо в цвет.
      */}
      <mesh position={[0, CASE_HEIGHT / 2, -CASE.depth / 2 + CASE.back + 0.05]}>
        <planeGeometry args={[CASE.innerWidth, CASE_HEIGHT]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.3} depthWrite={false} />
      </mesh>

      {/* Цоколь: стеллаж не висит в воздухе */}
      <mesh position={[0, CASE.board / 4, CASE.depth / 2 - 1]}>
        <boxGeometry args={[CASE_WIDTH, CASE.board / 2, 2]} />
        <meshStandardMaterial map={boardMap} color="#8a6b4e" roughness={0.9} />
      </mesh>
    </group>
  );
}
