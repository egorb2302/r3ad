import { describe, expect, it } from 'vitest';
import { profileFor, rasterKey, type DeviceReading } from '@/core/device';

const desktop: DeviceReading = {
  width: 1440,
  height: 900,
  dpr: 2,
  coarse: false,
  cores: 8,
  memoryGb: 16,
  webgl2: true,
};

describe('профиль устройства — правило, а не набор проверок по месту', () => {
  it('обычный десктоп получает полный профиль', () => {
    expect(profileFor(desktop)).toEqual({
      kind: 'desktop',
      scene: true,
      texture: 'desktop',
      liveTextures: 8,
      dpr: [1, 2],
      shadows: true,
      compact: false,
    });
  });

  it('телефон: узкая сторона меньше 560 при грубом указателе', () => {
    const phone = profileFor({ ...desktop, width: 390, height: 844, dpr: 3, coarse: true, cores: 6, memoryGb: 4 });
    expect(phone.kind).toBe('phone');
    expect(phone.texture).toBe('mobile');
    expect(phone.liveTextures).toBe(4);
    expect(phone.dpr).toEqual([1, 1.75]);
    expect(phone.shadows).toBe(false);
    expect(phone.compact).toBe(true);
  });

  it('сильный планшет тянет десктопные текстуры, слабый — нет', () => {
    const strong = profileFor({ ...desktop, width: 820, height: 1180, coarse: true });
    expect(strong.kind).toBe('tablet');
    expect(strong.texture).toBe('desktop');
    expect(strong.compact).toBe(true);

    const weak = profileFor({ ...desktop, width: 820, height: 1180, coarse: true, cores: 4, memoryGb: 4 });
    expect(weak.kind).toBe('tablet');
    expect(weak.texture).toBe('mobile');
    expect(weak.liveTextures).toBe(4);
  });

  it('ноутбук с четырьмя ядрами и малой памятью — десктоп, но профиль мобильный', () => {
    const laptop = profileFor({ ...desktop, cores: 4, memoryGb: 4 });
    expect(laptop.kind).toBe('desktop');
    expect(laptop.texture).toBe('mobile');
  });

  it('«браузер не сказал» — не признак слабости', () => {
    const quiet = profileFor({ ...desktop, width: 820, height: 1180, coarse: true, cores: 0, memoryGb: 0 });
    expect(quiet.texture).toBe('desktop');
  });

  it('без WebGL2 сцены нет, остальное на месте', () => {
    const plain = profileFor({ ...desktop, webgl2: false });
    expect(plain.scene).toBe(false);
    expect(plain.texture).toBe('desktop');
  });

  it('ключ растра меняется от текстур, а не от ширины окна', () => {
    const wide = profileFor(desktop);
    const narrow = profileFor({ ...desktop, width: 800 });
    expect(rasterKey(wide)).toBe(rasterKey(narrow));
    expect(rasterKey(wide)).not.toBe(rasterKey(profileFor({ ...desktop, cores: 2, memoryGb: 2 })));
  });
});
