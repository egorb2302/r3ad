'use client';

/**
 * Сцена: свет, экспозиция, тени, порода дерева.
 *
 * Отдельный стор на четыре поля заведён не из любви к сторам. Тема книги живёт
 * в записи библиотеки — она свойство книги; тема сцены не принадлежит ни одной
 * книге и не принадлежит библиотеке: полка может быть пустой, а комната вокруг
 * неё всё равно освещена. Держать её в `useLibrary` значило бы будить всю полку
 * на каждое движение ползунка экспозиции.
 *
 * Сцена — часть снимка (§8: «расшаренная полка выглядит у получателя ровно так
 * же»), поэтому она едет в бандле и поднимается из базы вместе с полкой.
 */
import { create } from 'zustand';
import { DEFAULT_SCENE, type SceneTheme } from '@/core/theme';

interface ThemeState {
  scene: SceneTheme;
  setScene: (patch: Partial<SceneTheme>) => void;
  reset: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  scene: DEFAULT_SCENE,
  setScene: (patch) => set({ scene: { ...get().scene, ...patch } }),
  reset: () => set({ scene: DEFAULT_SCENE }),
}));

if (process.env.NODE_ENV !== 'production') {
  (globalThis as { __r3adTheme?: typeof useTheme }).__r3adTheme = useTheme;
}
