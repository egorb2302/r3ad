'use client';

/**
 * Доступ к сцене из консоли в дев-сборке.
 *
 * Сцена живёт в отдельном React-корне, и снаружи до неё не дотянуться ни
 * DevTools, ни стором. А смотреть в неё приходится: бюджеты §16 — drawcall'ы,
 * треугольники, живые текстуры — иначе нечем проверить. Тот же приём, что и с
 * `__r3ad`: одна ссылка, только в разработке.
 *
 * В продакшен-сборке компонент вырождается: и эффект, и импорт вырезаются по
 * условию на NODE_ENV.
 */
import { useEffect } from 'react';
import { useStore } from '@react-three/fiber';

export function DevHandle() {
  const store = useStore();

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const handle = globalThis as { __r3adScene?: unknown };
    handle.__r3adScene = store;
    return () => {
      delete handle.__r3adScene;
    };
  }, [store]);

  return null;
}
