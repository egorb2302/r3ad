import { describe, expect, it } from 'vitest';
import { BUNDLE_FORMAT, BUNDLE_VERSION, buildBundle, parseBundle } from '@/core/share/bundle';
import {
  COMPACT_MAX,
  decodeShelf,
  encodeShelf,
  packShelf,
  shelfFromVolumes,
  unpackShelf,
  volumesFromShelf,
  type CompactShelf,
} from '@/core/share/compact';
import {
  fromBase64Url,
  isSealed,
  needsPassphrase,
  newLock,
  openLock,
  sealBytes,
  sealJson,
  toBase64Url,
  unsealBytes,
  unsealJson,
} from '@/core/share/lock';
import { SHIPPED, shippedLibrary } from '@/core/library/shipped';
import { BINDINGS, DEFAULT_SCENE, decodeScene, encodeScene, encodeTheme } from '@/core/theme';
import { DEFAULT_TYPOGRAPHY } from '@/core/typography';

// Свет и тени едут в адрес одной цифрой, и сцена по умолчанию (0.55) в неё не
// попадает целиком — берём то, что переживает кодирование.
const SCENE = decodeScene(encodeScene(DEFAULT_SCENE));

const shelf = (n: number): CompactShelf => ({
  title: 'Test shelf',
  scene: SCENE,
  volumes: Array.from({ length: n }, (_, i) => ({
    kind: i % 5 === 0 ? ('journal' as const) : ('volume' as const),
    title: `Volume ${i + 1}`,
    author: `Author ${i % 7}`,
    chars: 60_000 + i * 9_000,
    theme: '',
  })),
});

describe('полка в адресе', () => {
  it('кодируется и читается обратно', () => {
    const s = shelf(6);
    expect(decodeShelf(encodeShelf(s))).toEqual(s);
  });

  it('разделители из названий вычищаются, а не ломают таблицу', () => {
    const s: CompactShelf = {
      ...shelf(1),
      title: 'A\x1eB',
      volumes: [{ ...shelf(1).volumes[0], title: 'X\x1fY' }],
    };
    const back = decodeShelf(encodeShelf(s));
    expect(back.title).toBe('A B');
    expect(back.volumes).toHaveLength(1);
    expect(back.volumes[0].title).toBe('X Y');
  });

  it('сорок томов сжимаются под потолок адресной строки', async () => {
    const s = shelf(40);
    const payload = await packShelf(s);
    expect(payload[0]).toBe('z');
    expect(payload.length).toBeLessThanOrEqual(COMPACT_MAX);
    expect(await unpackShelf(payload)).toEqual(s);
  });

  it('несжатая ссылка читается тем же кодом', async () => {
    const s = shelf(3);
    const raw = 'p' + toBase64Url(new TextEncoder().encode(encodeShelf(s)));
    expect(await unpackShelf(raw)).toEqual(s);
  });

  it('записи библиотеки ходят туда и обратно, тема пишется только у переодетых', () => {
    const volumes = volumesFromShelf(shelf(5));
    expect(volumes.every((v) => v.format === 'synthetic' && v.source.kind === 'synthetic')).toBe(true);

    const again = shelfFromVolumes('Test shelf', volumes, DEFAULT_SCENE);
    expect(again.volumes.every((v) => v.theme === '')).toBe(true);
    expect(again.volumes.map((v) => [v.title, v.author, v.chars])).toEqual(
      shelf(5).volumes.map((v) => [v.title, v.author, v.chars]),
    );

    const dressed = { ...volumes[0], theme: BINDINGS[0].theme };
    expect(shelfFromVolumes('x', [dressed], DEFAULT_SCENE).volumes[0].theme).not.toBe('');
  });
});

describe('книги из комплекта в адресе', () => {
  it('едут именем файла и поднимаются настоящими, под своими идентификаторами', () => {
    const records = shippedLibrary();
    const s = shelfFromVolumes('Shelf', records, SCENE);
    // Тема каталожная — в адресе ей делать нечего, а файл — есть.
    expect(s.volumes.every((v) => v.file && v.theme === '')).toBe(true);

    const back = decodeShelf(encodeShelf(s));
    expect(back).toEqual(s);

    const again = volumesFromShelf(back);
    expect(again.map((v) => v.id)).toEqual(records.map((r) => r.id));
    expect(again.every((v) => v.source.kind === 'shipped' && v.format === 'epub')).toBe(true);
    expect(again.map((v) => v.charCount)).toEqual(SHIPPED.map((b) => b.chars));
  });

  it('переодетая книга из комплекта везёт тему, и она переживает адрес', () => {
    const [record] = shippedLibrary();
    const dressed = { ...record, theme: BINDINGS[0].theme };
    const s = shelfFromVolumes('x', [dressed], DEFAULT_SCENE);
    expect(s.volumes[0].theme).not.toBe('');

    const [again] = volumesFromShelf(decodeShelf(encodeShelf(s)));
    expect(again.source).toEqual(record.source);
    expect(encodeTheme(again.theme)).toBe(encodeTheme(BINDINGS[0].theme));
  });

  it('файла больше нет в комплекте — том становится синтетикой той же толщины', () => {
    const s = decodeShelf(
      encodeShelf({
        title: 'x',
        scene: SCENE,
        volumes: [
          { kind: 'volume', title: 'Gone', author: 'A. Nobody', chars: 12_345, theme: '', file: 'gone.epub' },
        ],
      }),
    );
    expect(s.volumes[0].file).toBe('gone.epub');

    const [v] = volumesFromShelf(s);
    expect(v.source.kind).toBe('synthetic');
    expect(v.format).toBe('synthetic');
    expect(v.charCount).toBe(12_345);
  });

  it('старая строка без шестой колонки читается как прежде', () => {
    const s = decodeShelf(['x\x1f', 'v\x1fOld\x1fA\x1f1000\x1f'].join('\x1e'));
    expect(s.volumes[0]).toEqual({ kind: 'volume', title: 'Old', author: 'A', chars: 1000, theme: '' });
    expect('file' in s.volumes[0]).toBe(false);
  });
});

describe('замок', () => {
  it('ключ из фрагмента открывает конверт, соли в нём нет', async () => {
    const lock = await newLock();
    expect(lock.fragmentKey).toBeTruthy();

    const value = { hello: 'world', n: [1, 2, 3] };
    const sealed = await sealJson(lock, value);
    expect(isSealed(sealed)).toBe(true);
    expect(needsPassphrase(sealed)).toBe(false);

    const key = await openLock(sealed, lock.fragmentKey!);
    expect(await unsealJson(key, sealed)).toEqual(value);
  });

  it('фраза выводит ключ, и чужая фраза не подходит', async () => {
    const lock = await newLock('correct horse');
    expect(lock.fragmentKey).toBeNull();

    const sealed = await sealJson(lock, { secret: 1 });
    expect(needsPassphrase(sealed)).toBe(true);
    expect(await unsealJson(await openLock(sealed, 'correct horse'), sealed)).toEqual({ secret: 1 });
    await expect(unsealJson(await openLock(sealed, 'wrong'), sealed)).rejects.toThrow();
  }, 30_000);

  it('байты ассета: iv впереди, шифротекст следом', async () => {
    const lock = await newLock();
    const bytes = crypto.getRandomValues(new Uint8Array(1000));
    const sealed = await sealBytes(lock, bytes);
    // 12 байт iv и 16 байт тега GCM.
    expect(sealed.length).toBe(bytes.length + 12 + 16);
    expect(await unsealBytes(lock.key, sealed)).toEqual(bytes);
  });

  it('base64url — без «+», «/» и хвоста из «=», при любой длине', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 31]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 250) & 255);
      const text = toBase64Url(bytes);
      expect(text).not.toMatch(/[+/=]/);
      expect(fromBase64Url(text)).toEqual(bytes);
    }
  });
});

describe('бандл', () => {
  const input = () => ({
    title: 'Shelf',
    volumes: volumesFromShelf(shelf(3)),
    desk: null,
    journals: {},
    clippings: {},
    view: 'desk' as const,
    typography: DEFAULT_TYPOGRAPHY,
    scene: DEFAULT_SCENE,
  });

  it('собирается и переживает JSON без потерь', async () => {
    const bundle = await buildBundle(input(), 'appearance');
    expect(bundle.format).toBe(BUNDLE_FORMAT);
    expect(bundle.version).toBe(BUNDLE_VERSION);
    expect(bundle.volumes).toHaveLength(3);
    expect(bundle.assets).toEqual([]);
    expect(parseBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });

  it('книга из комплекта едет с текстом даже в снимок «только внешний вид»', async () => {
    const shipped = shippedLibrary().slice(0, 2);
    const bundle = await buildBundle({ ...input(), volumes: shipped }, 'appearance');
    expect(bundle.volumes.map((v) => v.source)).toEqual(
      shipped.map((v) => ({ kind: 'shipped', file: (v.source as { file: string }).file })),
    );
    expect(bundle.assets).toEqual([]);
    expect(parseBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });

  it('том на столе и в ряду одновременно — в снимке один раз', async () => {
    const base = input();
    const bundle = await buildBundle({ ...base, desk: base.volumes[0] }, 'appearance');
    expect(bundle.volumes.map((v) => v.id)).toEqual(base.volumes.map((v) => v.id));
    expect(bundle.desk).toBe(base.volumes[0].id);
  });

  it('чужой файл не притворяется бандлом', () => {
    expect(() => parseBundle(null)).toThrow(/not an r3ad bundle/);
    expect(() => parseBundle({ format: 'zip' })).toThrow(/not an r3ad bundle/);
    expect(() => parseBundle({ format: BUNDLE_FORMAT, version: 99, volumes: [] })).toThrow(/newer/);
    expect(() => parseBundle({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION })).toThrow(/no shelf/);
  });

  it('пропущенные поля получают значения по умолчанию', () => {
    const bundle = parseBundle({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, volumes: [] });
    expect(bundle).toMatchObject({
      title: 'A shelf',
      scope: 'appearance',
      view: 'desk',
      desk: null,
      journals: [],
      clippings: [],
      assets: [],
      scene: DEFAULT_SCENE,
    });
  });

  it('том первой версии одевается из палитры корешка', () => {
    const bundle = parseBundle({
      format: BUNDLE_FORMAT,
      version: 1,
      volumes: [
        {
          id: 'v1',
          kind: 'volume',
          title: 'Old',
          author: 'Author',
          format: 'synthetic',
          language: 'en',
          charCount: 1000,
          pages: null,
          pagesKey: null,
          addedAt: 0,
          palette: { cloth: '#123456' },
          source: { kind: 'synthetic', options: {} },
        },
      ],
    });
    expect(bundle.version).toBe(BUNDLE_VERSION);
    expect(bundle.volumes[0].theme.cover.color).toBe('#123456');
    expect('palette' in bundle.volumes[0]).toBe(false);
  });
});
