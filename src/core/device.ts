/**
 * Профиль устройства: во что обойдётся сцена и что от неё оставить.
 *
 * Функция чистая и принимает уже снятые замеры, а не лезет в `navigator` сама.
 * Причина обычная для ядра (§5), но здесь у неё есть и вторая сторона: замеры
 * приходят из трёх разных мест — размер окна из ResizeObserver, грубость
 * указателя из matchMedia, наличие WebGL2 из пробного контекста, — и правило,
 * которое из них выводится, стоит держать одним куском. Иначе «телефон» в одном
 * файле означает узкий экран, а в другом — палец вместо мыши.
 *
 * Мы не определяем модель телефона и не смотрим на user-agent. Всё, что нужно
 * знать про устройство, видно по тому, чем на нём показывают и чем по нему
 * тыкают: разрешение, плотность пикселей, ядра, память и грубость указателя.
 */
import type { TextureProfile } from './typography';

export interface DeviceReading {
  /** Размер вьюпорта в CSS-пикселях. */
  width: number;
  height: number;
  /** Плотность экрана. На телефонах доходит до 3 и стоит ровно квадрат этого числа. */
  dpr: number;
  /** Грубый указатель: палец, а не мышь. */
  coarse: boolean;
  /** Ядра и память, если браузер о них рассказывает. Ноль — «не сказал». */
  cores: number;
  memoryGb: number;
  /** Есть ли на чём рисовать сцену. */
  webgl2: boolean;
}

export type DeviceKind = 'phone' | 'tablet' | 'desktop';

export interface DeviceProfile {
  kind: DeviceKind;
  /** Можно ли вообще показывать 3D. Нет — остаётся плоский режим (§17). */
  scene: boolean;
  /** Разрешение растра страницы (§6.5). */
  texture: TextureProfile;
  /** Потолок живых текстур. Он же потолок VRAM: страница с мипами это 4–8 МБ. */
  liveTextures: number;
  /** Диапазон DPR холста. Верх — то, что срежется первым при просадке. */
  dpr: [number, number];
  /** Контактная тень под книгой — отдельный проход 512×512. */
  shadows: boolean;
  /** Панелям не хватает места рядом с вьюпортом: они наезжают на него. */
  compact: boolean;
}

/** Ниже этой ширины окна панели не помещаются рядом со сценой. */
export const COMPACT_WIDTH = 900;

/**
 * Слабое железо — не то же самое, что маленький экран.
 *
 * Ноутбук с четырьмя ядрами и встроенной графикой тянет ровно столько же,
 * сколько планшет, и профиль ему нужен тот же. Поэтому «мобильный профиль»
 * решается не размером окна, а тем, что о машине известно: два признака из
 * трёх — грубый указатель, мало ядер, мало памяти.
 */
function underpowered(reading: DeviceReading): boolean {
  let signs = 0;
  if (reading.coarse) signs += 1;
  if (reading.cores > 0 && reading.cores <= 4) signs += 1;
  if (reading.memoryGb > 0 && reading.memoryGb <= 4) signs += 1;
  return signs >= 2;
}

export function profileFor(reading: DeviceReading): DeviceProfile {
  const short = Math.min(reading.width, reading.height);
  const kind: DeviceKind = !reading.coarse
    ? 'desktop'
    : short < 560
      ? 'phone'
      : 'tablet';

  const light = kind === 'phone' || underpowered(reading);

  return {
    kind,
    scene: reading.webgl2,
    texture: light ? 'mobile' : 'desktop',
    /*
     * Четыре против восьми — это разворот и один сосед вместо разворота и двух
     * соседей с каждой стороны (§6.5). Листать от этого не медленнее: за раз
     * видно четыре страницы, и запас нужен только на предпечать вперёд.
     */
    liveTextures: light ? 4 : 8,
    /*
     * Верхний DPR на телефоне срезан до 1.75 при родных 3. Стоимость кадра
     * растёт квадратом: 3 против 1.75 — это втрое больше пикселей на тот же
     * экран, и платить их пришлось бы из тридцати кадров бюджета §16.
     */
    dpr: kind === 'phone' ? [1, 1.75] : [1, 2],
    shadows: !light,
    compact: reading.width < COMPACT_WIDTH,
  };
}

/** Профиль до первого замера: обычный десктоп со сценой. */
export const DEFAULT_PROFILE: DeviceProfile = {
  kind: 'desktop',
  scene: true,
  texture: 'desktop',
  liveTextures: 8,
  dpr: [1, 2],
  shadows: true,
  compact: false,
};

/**
 * Что из профиля касается растра страницы.
 *
 * Отдельная функция ради сравнения: перерисовывать книгу надо, когда сменилось
 * разрешение или потолок кэша, а не когда окно стало на пиксель уже.
 */
export const rasterKey = (p: DeviceProfile) => `${p.texture}/${p.liveTextures}`;
