import { describe, expect, it } from 'vitest';
import {
  BINDINGS,
  DEFAULT_SCENE,
  PRESETS,
  WOODS,
  decodeScene,
  decodeTheme,
  encodeScene,
  encodeTheme,
  isDerived,
  legacyThemeFor,
  themeFor,
} from '@/core/theme';

describe('тема в ссылку', () => {
  it('каждый переплёт из каталога переживает кодирование', () => {
    const fallback = themeFor('fallback');
    for (const { name, theme } of BINDINGS) {
      const code = encodeTheme(theme);
      const back = decodeTheme(code, fallback);
      // Потёртость квантуется в девять шагов, поэтому сравниваем не объекты,
      // а повторное кодирование: оно обязано дать тот же код.
      expect(encodeTheme(back), name).toBe(code);
      expect(back.cover.material, name).toBe(theme.cover.material);
      expect(back.cover.color.toLowerCase(), name).toBe(theme.cover.color.toLowerCase());
      expect(back.paper.edge, name).toBe(theme.paper.edge);
      expect(back.paper.gsm, name).toBe(Math.round(theme.paper.gsm));
    }
  });

  it('обрезанный код возвращает запасную тему, а не мусор', () => {
    const fallback = themeFor('x');
    expect(decodeTheme('', fallback)).toBe(fallback);
    expect(decodeTheme('cgcp12', fallback)).toBe(fallback);
  });

  it('выводимая тема узнаётся, тема прошлой версии — нет', () => {
    expect(isDerived(themeFor('Ligature|r3'), 'Ligature|r3')).toBe(true);
    expect(isDerived(themeFor('Ligature|r3'), 'Other|r3')).toBe(false);
    expect(isDerived(legacyThemeFor('Ligature|r3'), 'Ligature|r3')).toBe(false);
  });
});

describe('сцена в ссылку', () => {
  it('четыре знака на всю полку — и все сочетания различимы', () => {
    for (const preset of PRESETS) {
      for (const wood of WOODS) {
        const scene = { preset: preset.value, wood: wood.value, exposure: 1, shadows: 5 / 9 };
        const code = encodeScene(scene);
        expect(code).toHaveLength(4);
        expect(decodeScene(code)).toEqual(scene);
      }
    }
  });

  it('пустой код — сцена по умолчанию', () => {
    expect(decodeScene('')).toEqual(DEFAULT_SCENE);
  });
});
