'use client';

/**
 * Порядок запуска, общий для воркспейса и публичной страницы снимка.
 *
 * Шрифты регистрируются в документе первыми — иначе композитор посчитает
 * разбивку запасной гарнитурой, а растр нарисует настоящей, и вёрстка разойдётся
 * с картинкой на странице. Затем проба растеризатора (§6.4), и только потом
 * что-либо считается.
 *
 * Хук общий не ради экономии двадцати строк, а потому что это тот порядок,
 * который нельзя случайно не соблюсти на второй странице: чужой снимок
 * открывают с телефона, где промах по шрифтам виден сразу и объяснить его
 * некому.
 */
import { useEffect, useState } from 'react';
import { ensureDocumentFonts, fontCssForText } from '@/core/rasterize/fonts';
import { probeRasterizer } from '@/core/rasterize/svgRasterizer';
import { useBook } from '@/store/useBook';

export type BootStage = 'fonts' | 'ready' | 'failed';

export function useBoot(options: { paginate?: boolean } = {}): BootStage {
  const [stage, setStage] = useState<BootStage>('fonts');
  const paginate = options.paginate ?? false;

  useEffect(() => {
    let alive = true;

    (async () => {
      const book = useBook.getState();
      try {
        await ensureDocumentFonts('body');
        if (!alive) return;

        const probeCss = await fontCssForText('Probe Ag', 'body');
        book.setProbe(await probeRasterizer(probeCss.css));
        if (!alive) return;

        setStage('ready');
        if (paginate) book.runPagination();
      } catch (err) {
        if (!alive) return;
        setStage('failed');
        book.setProbe({ ok: false, inkRatio: 0, note: `Fonts failed to load: ${String(err)}` });
      }
    })();

    return () => {
      alive = false;
    };
  }, [paginate]);

  return stage;
}
