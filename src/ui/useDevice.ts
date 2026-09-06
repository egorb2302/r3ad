'use client';

/**
 * Снять замеры машины и держать их свежими.
 *
 * Всё, что здесь есть, — сбор чисел; решение из них выводит чистая функция в
 * ядре (`core/device`). Разделение не ритуальное: правило «что считать
 * телефоном» хочется однажды проверить без браузера, а `matchMedia` и пробный
 * WebGL-контекст без браузера не существуют.
 *
 * Проба WebGL2 делается один раз и в отдельном холсте, который тут же
 * выбрасывается. Спрашивать об этом сам вьюпорт нельзя: к моменту, когда он
 * смонтируется и не сможет создать контекст, человек уже смотрит на чёрный
 * прямоугольник, а нам надо было решить до того.
 */
import { useEffect } from 'react';
import { profileFor, type DeviceReading } from '@/core/device';
import { useShell } from '@/store/useShell';

let webgl2: boolean | null = null;

/**
 * Есть ли WebGL2.
 *
 * Контекст закрываем явно: браузеры держат небольшой потолок живых контекстов
 * на вкладку и вытесняют старые, а вытесненным окажется как раз тот, в котором
 * рисуется книга.
 */
function probeWebgl2(): boolean {
  if (webgl2 !== null) return webgl2;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    webgl2 = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return webgl2;
  } catch {
    webgl2 = false;
    return false;
  }
}

interface NavigatorWithHints extends Navigator {
  /** Не во всех браузерах, и в приватном режиме врёт в большую сторону. */
  deviceMemory?: number;
}

function read(): DeviceReading {
  const nav = navigator as NavigatorWithHints;
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    cores: nav.hardwareConcurrency ?? 0,
    memoryGb: nav.deviceMemory ?? 0,
    webgl2: probeWebgl2(),
  };
}

export function useDevice() {
  useEffect(() => {
    const shell = useShell.getState();

    /*
     * Адрес читается раньше замеров: `?mode=flat` — это выбор, и отменять его
     * тем, что машина потянула бы сцену, нельзя. Обратный порядок означал бы,
     * что ссылка «открой без 3D» работает только на слабых машинах.
     */
    if (new URLSearchParams(location.search).get('mode') === 'flat') {
      shell.setMode('plain', 'url');
    }

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    shell.setReduced(motion.matches);
    shell.adopt(profileFor(read()));

    /*
     * Замер с задержкой, а не на каждое событие: перетаскивание рамки браузера
     * шлёт resize десятками в секунду, а профиль от этого меняется раз.
     *
     * Таймером, а не кадром. Соблазн был взять requestAnimationFrame — он
     * ровно для такого и есть, — но в скрытой вкладке кадров не выдают вовсе, и
     * поворот телефона, случившийся при выключенном экране, остался бы
     * незамеченным до первого касания.
     */
    let timer = 0;
    const remeasure = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => useShell.getState().adopt(profileFor(read())), 120);
    };

    const onMotion = (e: MediaQueryListEvent) => useShell.getState().setReduced(e.matches);
    const pointer = window.matchMedia('(pointer: coarse)');

    window.addEventListener('resize', remeasure);
    pointer.addEventListener('change', remeasure);
    motion.addEventListener('change', onMotion);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', remeasure);
      pointer.removeEventListener('change', remeasure);
      motion.removeEventListener('change', onMotion);
    };
  }, []);
}
