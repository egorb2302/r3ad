'use client';

/**
 * Свет: четыре пресета и то, что за ними стоит.
 *
 * Пресет — не «набор красивых чисел», а описание помещения, и книга в нём
 * выглядит по-разному ровно потому, что по-разному выглядит в настоящем.
 * Настольная лампа даёт жёсткую тень и тёплый ключ сбоку; дневной свет —
 * рассеянный холодный сверху и почти никакой тени; вечер — низкий оранжевый
 * источник и провал в чёрное вокруг; студия — ровный нейтральный свет, при
 * котором виден материал, а не настроение.
 *
 * Два решения, которые здесь важно не «починить» обратно.
 *
 * **Ключ стоит слева-сверху во всех пресетах.** Тиснение на крышке и корешке
 * нарисовано парой «тень вниз-вправо, блик вверх-влево» (см. materials/cover),
 * и это единственная договорённость, которая делает рельеф рельефом. Переставь
 * ключ направо — и вдавленные буквы вывернутся наружу на всех книгах разом.
 *
 * **Экспозиция и яркость источников разведены.** Пресет задаёт светотень,
 * ползунок — общий уровень. Иначе «сделать посветлее» означало бы выжечь блики
 * и получить плоскую картинку вместо той же сцены при другой выдержке.
 *
 * Карт теней по-прежнему нет (см. Viewport): единственные нужные тени —
 * контактная под книгой и от поднятого листа, и обе дешевле рисуются иначе.
 * Сила контактной тени — тоже часть пресета, а ползунок её домножает.
 */
import { Environment, Lightformer } from '@react-three/drei';
import { useStore } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';
import type { ScenePreset, SceneTheme } from '@/core/theme';

interface Source {
  position: [number, number, number];
  intensity: number;
  color: string;
}

interface Former extends Source {
  scale: [number, number, number];
  form?: 'circle' | 'ring' | 'rect';
}

export interface LightRig {
  /** Цвет фона и тумана: у сцены нет неба, поэтому он один. */
  background: string;
  fog: [near: number, far: number];
  ambient: { intensity: number; color: string };
  key: Source;
  fill: Source;
  formers: Former[];
  /** Своя экспозиция пресета. Ползунок темы её домножает. */
  exposure: number;
  shadow: { opacity: number; blur: number; color: string };
}

export const RIGS: Record<ScenePreset, LightRig> = {
  /** Настольная лампа: то, с чего сцена начиналась на M0. */
  lamp: {
    background: '#14100d',
    fog: [150, 520],
    ambient: { intensity: 0.5, color: '#ffeedd' },
    key: { position: [-26, 40, 20], intensity: 2.1, color: '#ffd9a8' },
    fill: { position: [30, 24, -18], intensity: 0.45, color: '#8fb2d8' },
    formers: [
      { position: [-10, 12, 6], scale: [14, 14, 1], intensity: 2.4, color: '#ffe2bb' },
      { position: [12, 8, -8], scale: [10, 10, 1], intensity: 0.8, color: '#a9c6e8' },
      { position: [0, 16, 0], scale: [20, 20, 1], intensity: 0.5, color: '#ffffff', form: 'ring' },
    ],
    exposure: 1,
    shadow: { opacity: 1, blur: 2.4, color: '#000000' },
  },

  /** День: свет из окна. Тени мягкие и почти без цвета, зато видно бумагу. */
  daylight: {
    background: '#20262b',
    fog: [200, 640],
    ambient: { intensity: 0.9, color: '#dfe9f4' },
    key: { position: [-20, 52, 32], intensity: 2.2, color: '#fff6e8' },
    fill: { position: [34, 30, -10], intensity: 0.9, color: '#cfe0f2' },
    formers: [
      { position: [-8, 20, 10], scale: [22, 22, 1], intensity: 2.2, color: '#ffffff' },
      { position: [14, 10, -10], scale: [14, 14, 1], intensity: 1.1, color: '#cfe2f5' },
      { position: [0, 18, 0], scale: [26, 26, 1], intensity: 0.8, color: '#eef4ff', form: 'ring' },
    ],
    exposure: 1.05,
    shadow: { opacity: 0.62, blur: 3.4, color: '#1b2430' },
  },

  /**
   * Вечер: низкое солнце в окне и ничего больше.
   *
   * Туман подтянут вдвое ближе — не ради «атмосферности», а потому что в
   * тёмной комнате стеллаж в двух метрах действительно тонет, и полка, видная
   * насквозь при выключенном свете, читалась бы декорацией.
   */
  evening: {
    background: '#0c0908',
    fog: [90, 400],
    ambient: { intensity: 0.28, color: '#ffd2a4' },
    key: { position: [-34, 26, 16], intensity: 2.8, color: '#ff9a4a' },
    fill: { position: [22, 18, -20], intensity: 0.22, color: '#4a6a94' },
    formers: [
      { position: [-14, 8, 8], scale: [16, 10, 1], intensity: 3.2, color: '#ffb267' },
      { position: [10, 6, -8], scale: [8, 8, 1], intensity: 0.4, color: '#6f8fbf' },
      { position: [0, 14, 0], scale: [18, 18, 1], intensity: 0.22, color: '#ffd9b0', form: 'ring' },
    ],
    exposure: 0.92,
    shadow: { opacity: 1.25, blur: 2, color: '#000000' },
  },

  /** Студия: ровный нейтральный свет. Пресет для съёмки переплёта, а не настроения. */
  studio: {
    background: '#191a1c',
    fog: [240, 720],
    ambient: { intensity: 0.7, color: '#ffffff' },
    key: { position: [-22, 46, 26], intensity: 2, color: '#ffffff' },
    fill: { position: [28, 26, -14], intensity: 1.1, color: '#f2f4f8' },
    formers: [
      { position: [-10, 16, 8], scale: [18, 18, 1], intensity: 2.6, color: '#ffffff' },
      { position: [12, 12, -8], scale: [14, 14, 1], intensity: 1.4, color: '#ffffff' },
      { position: [0, 20, 0], scale: [24, 24, 1], intensity: 1, color: '#ffffff', form: 'ring' },
    ],
    exposure: 1,
    shadow: { opacity: 0.8, blur: 1.6, color: '#000000' },
  },
};

/**
 * Контактная тень при этой сцене.
 *
 * Пресет задаёт характер — под лампой тень жёсткая и чёрная, днём мягкая и
 * синеватая, — а ползунок только силу. Поэтому размытие и цвет приходят из
 * пресета нетронутыми, а домножается одна непрозрачность: «прибавить теней» не
 * должно означать «сменить источник света».
 */
export function shadowLook(scene: SceneTheme): { opacity: number; blur: number; color: string } {
  const { shadow } = RIGS[scene.preset];
  return {
    opacity: Math.min(1, shadow.opacity * scene.shadows),
    blur: shadow.blur,
    color: shadow.color,
  };
}

/**
 * Экспозиция тонмаппинга.
 *
 * Пишется в рендерер эффектом, а не пропсом: `toneMappingExposure` — свойство
 * самого рендерера, у R3F его декларативного аналога нет. Ставится один раз на
 * смену темы, поэтому в кадровый цикл это не попадает.
 *
 * Рендерер достаётся из стора, а не хуком `useThree`: значение, вернувшееся из
 * хука, править нельзя — так же, как в Spines, где из стора берутся контролы
 * камеры.
 */
function Exposure({ value }: { value: number }) {
  const store = useStore();

  useEffect(() => {
    store.getState().gl.toneMappingExposure = value;
  }, [store, value]);

  return null;
}

/**
 * Весь свет сцены.
 *
 * Environment под собственной границей Suspense: он подвешивается, пока
 * собирает карту окружения, и без границы вместе с ним подвисает вся сцена —
 * включая книгу и хук, который заказывает текстуры страниц. Карта считается на
 * месте из Lightformer'ов, а не грузится HDRI-файлом: важно и для оффлайна, и
 * чтобы первый кадр не ждал мегабайтную карту.
 */
export function Lighting({ scene }: { scene: SceneTheme }) {
  const rig = RIGS[scene.preset];

  return (
    <>
      <color attach="background" args={[rig.background]} />
      {/*
        Туман растянут до стеллажа: он стоит в двух метрах от стола, и короткая
        дальность съедала бы полку целиком, стоило камере отъехать.
      */}
      <fog attach="fog" args={[rig.background, rig.fog[0], rig.fog[1]]} />

      <Exposure value={rig.exposure * scene.exposure} />

      <ambientLight intensity={rig.ambient.intensity} color={rig.ambient.color} />
      {/* Ключ всегда слева-сверху: на этом держится рельеф тиснения. */}
      <directionalLight
        position={rig.key.position}
        intensity={rig.key.intensity}
        color={rig.key.color}
      />
      {/* Заполняющий — чтобы тени не проваливались в чёрное. */}
      <directionalLight
        position={rig.fill.position}
        intensity={rig.fill.intensity}
        color={rig.fill.color}
      />

      <Suspense fallback={null}>
        <Environment key={scene.preset} resolution={256}>
          {rig.formers.map((former, i) => (
            <Lightformer
              key={i}
              form={former.form}
              intensity={former.intensity}
              position={former.position}
              scale={former.scale}
              color={former.color}
            />
          ))}
        </Environment>
      </Suspense>
    </>
  );
}
