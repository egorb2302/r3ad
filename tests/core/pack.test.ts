// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildBundle } from '@/core/share/bundle';
import { volumesFromShelf } from '@/core/share/compact';
import { packBundle, packFileName, unpackBundle } from '@/core/share/pack';
import { DEFAULT_SCENE } from '@/core/theme';
import { DEFAULT_TYPOGRAPHY } from '@/core/typography';

/*
 * jsdom, а не node: JSZip читает Blob через FileReader, которого в node нет, —
 * а именно Blob и приезжает из `<input type="file">`.
 */
describe('файл .r3ad', () => {
  it('манифест едет в zip и возвращается тем же бандлом', async () => {
    const bundle = await buildBundle(
      {
        title: 'Shelf: The Long — Title!!',
        volumes: volumesFromShelf({
          title: 'x',
          scene: DEFAULT_SCENE,
          volumes: [{ kind: 'volume', title: 'One', author: 'A', chars: 90_000, theme: '' }],
        }),
        desk: null,
        journals: {},
        clippings: {},
        view: 'case',
        typography: DEFAULT_TYPOGRAPHY,
        scene: DEFAULT_SCENE,
      },
      'appearance',
    );

    const file = await packBundle(bundle);
    expect(file.type).toBe('application/zip');

    const { bundle: back, assets } = await unpackBundle(file);
    expect(back).toEqual(bundle);
    expect(assets.size).toBe(0);
    expect(packFileName(bundle)).toBe('shelf-the-long-title.r3ad');
  });

  it('без manifest.json это не наш файл', async () => {
    await expect(unpackBundle(new Blob(['not a zip']))).rejects.toThrow();
  });
});
