/**
 * Обрез — то, из чего читается «толщина» тома вблизи, и то, что с M6 красят.
 *
 * Рисуется процедурно: полосы разной светлоты вдоль оси стопки плюс лёгкий
 * дрейф, чтобы линии не выглядели машинными. Плотность полос привязана к
 * реальному числу листов через `repeat`, так что толстая книга и выглядит
 * плотнее набранной, а не просто выше.
 *
 * Обрез по природе одномерен: это стопка листов, и всё, что на нём есть,
 * меняется только вдоль неё. Отсюда холст шириной в шестнадцать пикселей — и
 * единственное исключение, мрамор: разводы идут поперёк, и им вторая координата
 * нужна по-настоящему. Мраморному обрезу поэтому достаётся широкий холст и
 * `repeat.x = 1`, остальным — узкий и растянутый.
 *
 * Окраска (SPEC §8) — не заливка поверх. Сплошная краска ложится на бумагу,
 * оставляя слоистость видимой, иначе получается не крашеный обрез, а
 * пластиковый торец; золочение вдобавок меняет отражение, и его параметры
 * материала отдаются наружу вместе с картой.
 */
import * as THREE from 'three';
import { PAPERS, type EdgeKind, type PaperTint } from '@/core/theme';

/** Сколько полос содержит сама картинка. Repeat потом растягивает их под число листов. */
const LINES = 512;
const HEIGHT = LINES * 2;
const NARROW = 16;
const WIDE = 256;

export interface EdgeLook {
  kind: EdgeKind;
  color: string;
  tint: PaperTint;
}

/**
 * Ключ кэша: у каждой раскраски свой холст, а книг с одинаковым обрезом много.
 *
 * Кэш ограничен, и это не микрооптимизация. Цвет среза берётся из палитры, то
 * есть меняется непрерывно, пока её тащат мышью: без вытеснения каждая
 * промежуточная краска оставляла бы в памяти холст на полмегабайта.
 */
const CACHE_LIMIT = 8;
const cache = new Map<string, THREE.CanvasTexture>();
const keyOf = (look: EdgeLook) => `${look.kind}|${look.color}|${look.tint}`;

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.replace('#', ''), 16) || 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function draw(look: EdgeLook): HTMLCanvasElement {
  const width = look.kind === 'marbled' ? WIDE : NARROW;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // Детерминированный шум: обрез должен выглядеть одинаково между перезапусками.
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  ctx.fillStyle = look.kind === 'gilded' ? '#c9a24a' : PAPERS[look.tint].edge;
  ctx.fillRect(0, 0, width, HEIGHT);

  const [r, g, b] = rgb(look.kind === 'gilded' ? '#e0c274' : PAPERS[look.tint].edge);

  for (let i = 0; i < LINES; i++) {
    const y = i * 2;
    // Часть листов лежит чуть глубже — отсюда неровность обреза у реальной книги.
    const shade = 0.72 + rand() * 0.28;
    ctx.fillStyle = `rgb(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade * 0.97)})`;
    ctx.fillRect(0, y, width, 1);

    ctx.fillStyle = `rgba(120,104,80,${0.1 + rand() * 0.18})`;
    ctx.fillRect(0, y + 1, width, 1);
  }

  if (look.kind === 'sprayed') paintSpray(ctx, width, look.color, rand);
  if (look.kind === 'marbled') paintMarble(ctx, width, look.color, rand);
  if (look.kind === 'gilded') paintGilt(ctx, width, rand);

  // Затемнение к краям: обрез слегка запылён по внешнему периметру.
  const grad = ctx.createLinearGradient(0, 0, width, 0);
  grad.addColorStop(0, 'rgba(90,74,52,0.30)');
  grad.addColorStop(0.5, 'rgba(90,74,52,0)');
  grad.addColorStop(1, 'rgba(90,74,52,0.30)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, HEIGHT);

  return canvas;
}

/**
 * Напыление.
 *
 * Краска ложится на торец стопки неровно: пигмент садится плотнее там, где
 * листы разошлись. Поэтому не сплошная заливка, а умножение с дрожащей
 * плотностью — слоистость обязана остаться видимой сквозь краску.
 */
function paintSpray(
  ctx: CanvasRenderingContext2D,
  width: number,
  color: string,
  rand: () => number,
) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.86;
  ctx.fillRect(0, 0, width, HEIGHT);
  ctx.restore();

  for (let i = 0; i < LINES; i++) {
    if (rand() > 0.3) continue;
    ctx.fillStyle = `rgba(255,255,255,${0.04 + rand() * 0.08})`;
    ctx.fillRect(0, i * 2, width, 1);
  }
}

/**
 * Мрамор.
 *
 * Настоящий делают, вылавливая обрезом краску с поверхности клейстера, и
 * рисунок там — вытянутые прожилки, которые расчёсывают гребнем поперёк. Здесь
 * то же самое двумя проходами: широкие волны краски, потом гребёнка тонкими
 * жилами со сдвигом по синусу.
 */
function paintMarble(
  ctx: CanvasRenderingContext2D,
  width: number,
  color: string,
  rand: () => number,
) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';

  for (let i = 0; i < 26; i++) {
    const y = rand() * HEIGHT;
    const thick = HEIGHT * (0.01 + rand() * 0.05);
    ctx.globalAlpha = 0.2 + rand() * 0.45;
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= width; x += 8) {
      ctx.lineTo(x, y + Math.sin(x / (18 + rand() * 10)) * thick);
    }
    for (let x = width; x >= 0; x -= 8) {
      ctx.lineTo(x, y + thick + Math.sin(x / 14) * thick * 0.6);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Гребёнка: тонкие светлые жилы поперёк волн — след того самого гребня.
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 40; i++) {
    const y = rand() * HEIGHT;
    ctx.globalAlpha = 0.1 + rand() * 0.2;
    ctx.strokeStyle = '#f4ecdc';
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= width; x += 6) ctx.lineTo(x, y + Math.sin(x / 9 + i) * 6);
    ctx.stroke();
  }

  ctx.restore();
}

/** Золочение: сусаль сглаживает торец, и слоистость на нём почти пропадает. */
function paintGilt(ctx: CanvasRenderingContext2D, width: number, rand: () => number) {
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = '#cfa956';
  ctx.fillRect(0, 0, width, HEIGHT);
  ctx.restore();

  for (let i = 0; i < 90; i++) {
    const y = rand() * HEIGHT;
    ctx.fillStyle = `rgba(255,240,200,${0.1 + rand() * 0.25})`;
    ctx.fillRect(0, y, width, 1 + rand() * 2);
  }
}

function base(look: EdgeLook): THREE.CanvasTexture {
  const key = keyOf(look);
  const known = cache.get(key);
  if (known) return known;

  const tex = new THREE.CanvasTexture(draw(look));
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  if (cache.size >= CACHE_LIMIT) {
    const [oldest, texture] = cache.entries().next().value!;
    texture.dispose();
    cache.delete(oldest);
  }

  cache.set(key, tex);
  return tex;
}

/**
 * Копия текстуры под конкретное число листов.
 *
 * Клон нужен потому, что repeat живёт в текстуре, а блоков в сцене два и
 * толщина у них разная.
 */
export function edgeTextureFor(sheets: number, acrossCm: number, look: EdgeLook): THREE.Texture {
  const tex = base(look).clone();
  tex.needsUpdate = true;
  // По оси стопки — столько полос, сколько листов. По другой оси тянем слегка,
  // а мрамор не тянем вовсе: у него там рисунок, а не растянутая полоса.
  tex.repeat.set(look.kind === 'marbled' ? 1 : Math.max(1, acrossCm / 2), Math.max(1, sheets / LINES));
  return tex;
}

/**
 * Как обрез отражает свет.
 *
 * Единственный параметр внешности, который нельзя нарисовать: золочёный обрез
 * отличается от крашеного не цветом, а тем, что он металл. Нарисованное золото
 * без металличности выглядит жёлтой бумагой.
 */
export function edgeSurface(look: EdgeLook): { roughness: number; metalness: number } {
  /*
   * Металличность у золочения неполная. Чистый металл берёт цвет только из
   * отражений, а сцена освещена картой в пару лампочек — при вечернем пресете
   * такой обрез уходил в чёрный, вместо того чтобы блестеть. Половина
   * металличности оставляет ему собственную краску, а блик остаётся.
   */
  if (look.kind === 'gilded') return { roughness: 0.3, metalness: 0.5 };
  if (look.kind === 'sprayed') return { roughness: 0.7, metalness: 0.04 };
  return { roughness: 0.88, metalness: 0 };
}
