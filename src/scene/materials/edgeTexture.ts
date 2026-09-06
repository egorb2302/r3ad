/**
 * Текстура обреза — то, из чего читается «толщина» тома вблизи.
 *
 * Рисуется процедурно: полосы разной светлоты вдоль оси стопки плюс лёгкий
 * дрейф, чтобы линии не выглядели машинными. Плотность полос привязана к
 * реальному числу листов через repeat, так что толстая книга и выглядит
 * плотнее набранной, а не просто выше.
 */
import * as THREE from 'three';

/** Сколько полос содержит сама картинка. Repeat потом растягивает их под число листов. */
const LINES = 512;
const HEIGHT = LINES * 2;
const WIDTH = 16;

let cached: THREE.CanvasTexture | null = null;

function draw(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#e8dfcd';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Детерминированный шум: обрез должен выглядеть одинаково между перезапусками.
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < LINES; i++) {
    const y = i * 2;
    // Часть листов лежит чуть глубже — отсюда неровность обреза у реальной книги.
    const shade = 0.72 + rand() * 0.28;
    const v = Math.round(200 * shade);
    ctx.fillStyle = `rgb(${v + 24},${v + 12},${Math.round(v * 0.92)})`;
    ctx.fillRect(0, y, WIDTH, 1);

    ctx.fillStyle = `rgba(120,104,80,${0.10 + rand() * 0.18})`;
    ctx.fillRect(0, y + 1, WIDTH, 1);
  }

  // Затемнение к краям: обрез слегка запылён по внешнему периметру.
  const grad = ctx.createLinearGradient(0, 0, WIDTH, 0);
  grad.addColorStop(0, 'rgba(90,74,52,0.30)');
  grad.addColorStop(0.5, 'rgba(90,74,52,0)');
  grad.addColorStop(1, 'rgba(90,74,52,0.30)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  return canvas;
}

export function edgeTexture(): THREE.CanvasTexture {
  if (cached) return cached;
  const tex = new THREE.CanvasTexture(draw());
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  cached = tex;
  return tex;
}

/**
 * Копия текстуры под конкретное число листов.
 * Клон нужен потому, что repeat живёт в текстуре, а блоков в сцене два и
 * толщина у них разная.
 */
export function edgeTextureFor(sheets: number, acrossCm: number): THREE.Texture {
  const tex = edgeTexture().clone();
  tex.needsUpdate = true;
  // По оси стопки — столько полос, сколько листов. По другой оси тянем слегка.
  tex.repeat.set(Math.max(1, acrossCm / 2), Math.max(1, sheets / LINES));
  return tex;
}
