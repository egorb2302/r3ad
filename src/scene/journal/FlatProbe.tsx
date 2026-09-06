'use client';

/**
 * Проекция страницы на экран.
 *
 * Каждый кадр берёт четыре угла верхней страницы стопки, переводит их в пиксели
 * вьюпорта и публикует габаритный прямоугольник. Пока камера наклоняется, углы
 * дают трапецию — но холст в это время ещё проявляется, и разница в пару
 * пикселей на полупрозрачном слое не видна.
 *
 * Компонент ничего не рисует. Он живёт внутри Canvas ровно ради доступа к
 * камере: снаружи, из панелей, до неё не дотянуться.
 */
import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { publishFlatRect } from './flatFrame';

const corner = new THREE.Vector3();

export interface FlatProbeProps {
  /** Центр страницы на столе и её высота над ним. */
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
}

export function FlatProbe({ x, y, width, height, active }: FlatProbeProps) {
  useEffect(() => {
    if (!active) publishFlatRect(null);
    return () => publishFlatRect(null);
  }, [active]);

  useFrame((state) => {
    if (!active) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const dx of [-width / 2, width / 2]) {
      for (const dz of [-height / 2, height / 2]) {
        corner.set(x + dx, y, dz).project(state.camera);
        const sx = (corner.x * 0.5 + 0.5) * state.size.width;
        const sy = (-corner.y * 0.5 + 0.5) * state.size.height;
        minX = Math.min(minX, sx);
        minY = Math.min(minY, sy);
        maxX = Math.max(maxX, sx);
        maxY = Math.max(maxY, sy);
      }
    }

    publishFlatRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  });

  return null;
}
