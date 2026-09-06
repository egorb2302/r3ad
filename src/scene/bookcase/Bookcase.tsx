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
 *
 * Кромки досок скруглены. Не ради «мягкости» самой по себе: острый край
 * коробки ловит свет одной линией в один пиксель, и на нём в любом ракурсе
 * видно, что это коробка. Скругление в четыре миллиметра даёт кромке блик
 * шириной в несколько пикселей — так выглядит доска с фаской, а не примитив.
 */
import { useEffect, useMemo } from 'react';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { WoodSpecies } from '@/core/theme';
import { woodTexture } from './wood';
import { CASE, CASE_HEIGHT, CASE_WIDTH, CASE_X, CASE_Y, CASE_Z } from './caseGeometry';

/** Радиус фаски на кромках. */
const EDGE = 0.4;

export function Bookcase({ species }: { species: WoodSpecies }) {
  const maps = useMemo(
    () => ({
      boardMap: woodTexture(CASE.innerWidth / 24, CASE.depth / 24, species),
      sideMap: woodTexture(CASE.depth / 24, CASE_HEIGHT / 24, species),
      backMap: woodTexture(CASE.innerWidth / 30, CASE_HEIGHT / 30, species),
    }),
    [species],
  );

  /*
   * Клоны текстур живут ровно столько, сколько порода: `repeat` хранится в
   * самой текстуре, поэтому у каждой доски он свой, и смена породы означает три
   * новых клона. Без уборки перебор четырёх пород ползунком оставлял бы их все.
   */
  useEffect(() => () => {
    for (const map of Object.values(maps)) map.dispose();
  }, [maps]);

  /*
   * Геометрии со скруглёнными кромками не объявляются разметкой: у R3F нет
   * готового тега на класс из examples. Две штуки на весь стеллаж — боковина
   * и доска, — и живут они столько же, сколько сам стеллаж.
   */
  const shapes = useMemo(
    () => ({
      side: new RoundedBoxGeometry(CASE.board, CASE_HEIGHT, CASE.depth, 2, EDGE),
      board: new RoundedBoxGeometry(CASE.innerWidth + EDGE, CASE.board, CASE.depth, 2, EDGE),
      plinth: new RoundedBoxGeometry(CASE_WIDTH, CASE.board / 2, 2, 2, EDGE),
    }),
    [],
  );
  useEffect(() => () => {
    for (const shape of Object.values(shapes)) shape.dispose();
  }, [shapes]);

  const { boardMap, sideMap, backMap } = maps;

  const sideX = CASE.innerWidth / 2 + CASE.board / 2;

  return (
    <group position={[CASE_X, CASE_Y, CASE_Z]}>
      {/* Боковины во всю высоту: полки опираются на них, а не наоборот */}
      {[-sideX, sideX].map((x) => (
        <mesh key={x} position={[x, CASE_HEIGHT / 2, 0]} geometry={shapes.side} castShadow receiveShadow>
          <meshStandardMaterial map={sideMap} roughness={0.8} metalness={0} />
        </mesh>
      ))}

      {/* Дно, полки и крышка — одна и та же доска на разной высоте */}
      {Array.from({ length: CASE.shelves + 1 }, (_, i) => (
        <mesh
          key={i}
          position={[0, i * (CASE.clearance + CASE.board) + CASE.board / 2, 0]}
          geometry={shapes.board}
          receiveShadow
        >
          <meshStandardMaterial map={boardMap} roughness={0.82} metalness={0} />
        </mesh>
      ))}

      {/* Задняя стенка: тонкая фанера, в тени, за книгами почти не видна */}
      <mesh position={[0, CASE_HEIGHT / 2, -CASE.depth / 2 + CASE.back / 2]} receiveShadow>
        <boxGeometry args={[CASE.innerWidth, CASE_HEIGHT, CASE.back]} />
        {/* Серым, а не тёплым: подкраска доски выдала бы берёзу за морёный дуб. */}
        <meshStandardMaterial map={backMap} color="#8f8f8f" roughness={0.92} metalness={0} />
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
      <mesh position={[0, CASE.board / 4, CASE.depth / 2 - 1]} geometry={shapes.plinth}>
        <meshStandardMaterial map={boardMap} color="#c9c9c9" roughness={0.9} />
      </mesh>
    </group>
  );
}
