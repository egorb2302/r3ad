'use client';

/**
 * Дерево стеллажа.
 *
 * Процедурное по той же причине, что и всё остальное в проекте: ассетов нет, а
 * доска обязана выглядеть доской. Рисунок — продольные волокна с редкими
 * тёмными прожилками и мягкими «катедралами» там, где пила прошла через
 * годовое кольцо. Никакого шума общего назначения: у случайных пятен нет
 * направления, а у дерева оно есть, и именно по нему доска и опознаётся.
 */
import * as THREE from 'three';

const SIZE = 512;

let cached: THREE.CanvasTexture | null = null;

function draw(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  let seed = 90210;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  ctx.fillStyle = '#6a4a30';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Волокна вдоль доски.
  for (let i = 0; i < 420; i++) {
    const y = rand() * SIZE;
    const dark = rand() < 0.5;
    ctx.strokeStyle = dark
      ? `rgba(48,30,18,${0.05 + rand() * 0.16})`
      : `rgba(178,138,96,${0.03 + rand() * 0.1})`;
    ctx.lineWidth = 0.6 + rand() * 2.2;

    ctx.beginPath();
    ctx.moveTo(0, y);
    // Лёгкий увод: волокно не идёт по линейке.
    const bend = (rand() - 0.5) * 14;
    ctx.bezierCurveTo(SIZE * 0.33, y + bend, SIZE * 0.66, y - bend, SIZE, y + bend * 0.4);
    ctx.stroke();
  }

  // Катедралы — вложенные дуги на месте среза кольца.
  for (let i = 0; i < 5; i++) {
    const cx = rand() * SIZE;
    const cy = rand() * SIZE;
    const height = 26 + rand() * 60;
    for (let k = 0; k < 7; k++) {
      ctx.strokeStyle = `rgba(44,27,15,${0.16 - k * 0.02})`;
      ctx.lineWidth = 1 + rand();
      ctx.beginPath();
      ctx.ellipse(cx, cy, 10 + k * 9, height + k * 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  return canvas;
}

function base(): THREE.CanvasTexture {
  if (cached) return cached;
  const texture = new THREE.CanvasTexture(draw());
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cached = texture;
  return texture;
}

/**
 * Копия рисунка под конкретную доску.
 *
 * Клон нужен из-за repeat: он живёт в текстуре, а досок в стеллаже семь и они
 * разной длины. Без клона у всех был бы масштаб последней.
 */
export function woodTexture(repeatX: number, repeatY: number): THREE.Texture {
  const texture = base().clone();
  texture.needsUpdate = true;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}
