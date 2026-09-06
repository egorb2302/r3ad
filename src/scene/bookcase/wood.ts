'use client';

/**
 * Дерево стеллажа: четыре породы.
 *
 * Процедурное по той же причине, что и всё остальное в проекте: ассетов нет, а
 * доска обязана выглядеть доской. Рисунок — продольные волокна с редкими
 * тёмными прожилками и мягкими «катедралами» там, где пила прошла через
 * годовое кольцо. Никакого шума общего назначения: у случайных пятен нет
 * направления, а у дерева оно есть, и именно по нему доска и опознаётся.
 *
 * Порода (SPEC §8) — это не «цвет доски». Дуб отличается от берёзы не только
 * тоном, но и контрастом волокна: у светлых пород рисунок мягче, у чёрных он
 * почти не читается, и покрасить одну текстуру в четыре цвета значило бы
 * выдать берёзу за морёный дуб. Поэтому у каждой породы свой холст, и рисунок
 * на нём считается со своим разбросом.
 */
import * as THREE from 'three';
import type { WoodSpecies } from '@/core/theme';

const SIZE = 512;

interface Timber {
  ground: string;
  /** Тёмная прожилка и светлое волокно: между ними и лежит весь характер породы. */
  dark: [number, number, number];
  light: [number, number, number];
  /** Сила рисунка. У чёрного дерева волокно почти не видно — оно и в жизни такое. */
  contrast: number;
}

const TIMBER: Record<WoodSpecies, Timber> = {
  oak: { ground: '#9a7548', dark: [92, 64, 34], light: [214, 184, 138], contrast: 1 },
  walnut: { ground: '#6a4a30', dark: [48, 30, 18], light: [178, 138, 96], contrast: 1 },
  birch: { ground: '#c4a476', dark: [150, 118, 80], light: [236, 218, 186], contrast: 0.7 },
  ebony: { ground: '#2c2724', dark: [12, 10, 9], light: [86, 78, 68], contrast: 0.55 },
};

const cached = new Map<string, THREE.CanvasTexture>();

/**
 * Мягкая отделка: та же порода, но светлее и с приглушённым волокном.
 *
 * Для столешницы. Доска стеллажа стоит в двух метрах и ей нужен рисунок,
 * чтобы читаться деревом; столешница занимает половину кадра прямо под
 * книгой, и контрастное волокно на ней спорит с текстом. Светлый лак с
 * едва заметным рисунком — то, как выглядит стол, за которым читают, а не
 * доска, из которой он сделан.
 */
function soften(timber: Timber): Timber {
  const ground = new THREE.Color(timber.ground).lerp(new THREE.Color('#fff4e6'), 0.42);
  return { ...timber, ground: `#${ground.getHexString()}`, contrast: timber.contrast * 0.42 };
}

function draw(species: WoodSpecies, soft: boolean): HTMLCanvasElement {
  const timber = soft ? soften(TIMBER[species]) : TIMBER[species];
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  let seed = 90210;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  ctx.fillStyle = timber.ground;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const ink = (channel: [number, number, number], alpha: number) =>
    `rgba(${channel[0]},${channel[1]},${channel[2]},${alpha * timber.contrast})`;

  // Волокна вдоль доски.
  for (let i = 0; i < 420; i++) {
    const y = rand() * SIZE;
    const dark = rand() < 0.5;
    ctx.strokeStyle = dark
      ? ink(timber.dark, 0.05 + rand() * 0.16)
      : ink(timber.light, 0.03 + rand() * 0.1);
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
      ctx.strokeStyle = ink(timber.dark, 0.16 - k * 0.02);
      ctx.lineWidth = 1 + rand();
      ctx.beginPath();
      ctx.ellipse(cx, cy, 10 + k * 9, height + k * 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  return canvas;
}

function base(species: WoodSpecies, soft: boolean): THREE.CanvasTexture {
  const key = soft ? `${species}/soft` : species;
  const known = cached.get(key);
  if (known) return known;

  const texture = new THREE.CanvasTexture(draw(species, soft));
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cached.set(key, texture);
  return texture;
}

/**
 * Копия рисунка под конкретную доску.
 *
 * Клон нужен из-за repeat: он живёт в текстуре, а досок в стеллаже семь и они
 * разной длины. Без клона у всех был бы масштаб последней.
 */
export function woodTexture(
  repeatX: number,
  repeatY: number,
  species: WoodSpecies,
  soft = false,
): THREE.Texture {
  const texture = base(species, soft).clone();
  texture.needsUpdate = true;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}
