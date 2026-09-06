'use client';

/**
 * Каркас воркспейса: навигатор слева, вьюпорт в центре, инспектор справа.
 *
 * Здесь же порядок запуска: сначала шрифты регистрируются в документе (иначе
 * композитор посчитает разбивку запасной гарнитурой и растр разойдётся с
 * вёрсткой), затем проба растеризатора, и только потом первая пагинация.
 */
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Navigator } from './Navigator';
import { Inspector } from './Inspector';
import { Topbar, Toolbar } from './Chrome';
import { useBook } from '@/store/useBook';
import { ensureDocumentFonts, fontCssForText } from '@/core/rasterize/fonts';
import { probeRasterizer } from '@/core/rasterize/svgRasterizer';

// three.js не переживает серверный рендер — грузим вьюпорт только в браузере.
const Viewport = dynamic(() => import('@/scene/Viewport').then((m) => m.Viewport), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-ink-950" />,
});

export function Workspace() {
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [boot, setBoot] = useState<'fonts' | 'ready' | 'failed'>('fonts');

  const runPagination = useBook((s) => s.runPagination);
  const setProbe = useBook((s) => s.setProbe);
  const status = useBook((s) => s.status);
  const error = useBook((s) => s.error);
  const progress = useBook((s) => s.progress);
  const turn = useBook((s) => s.turn);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        await ensureDocumentFonts('body');
        if (!alive) return;

        const probeCss = await fontCssForText('Probe Ag', 'body');
        setProbe(await probeRasterizer(probeCss.css));
        if (!alive) return;

        setBoot('ready');
        runPagination();
      } catch (err) {
        if (!alive) return;
        setBoot('failed');
        setProbe({ ok: false, inkRatio: 0, note: `Fonts failed to load: ${String(err)}` });
      }
    })();

    return () => {
      alive = false;
    };
  }, [runPagination, setProbe]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight') turn(1);
      else if (e.key === 'ArrowLeft') turn(-1);
      else if (e.key === '\\' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setPanelsHidden((v) => !v);
      }
    },
    [turn],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  return (
    <div className="flex h-dvh w-full flex-col bg-ink-950">
      <Topbar panelsHidden={panelsHidden} onTogglePanels={() => setPanelsHidden((v) => !v)} />

      <div className="flex min-h-0 flex-1">
        {!panelsHidden && <Navigator />}

        <main className="relative min-w-0 flex-1">
          {boot === 'ready' ? <Viewport /> : <div className="h-full w-full bg-ink-950" />}

          {!panelsHidden && <Toolbar />}

          {(boot !== 'ready' || status === 'paginating' || status === 'error') && (
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
              <div className="rounded-md border border-ink-700 bg-ink-900/92 px-3 py-1.5 text-[11px] text-ash-300 backdrop-blur">
                {boot === 'fonts' && 'Loading fonts and probing the rasterizer…'}
                {boot === 'failed' && 'Fonts failed to load — run node scripts/fetch-fonts.mjs'}
                {boot === 'ready' && status === 'paginating' && (
                  <span className="tabular">
                    Composing chapter {progress.done} of {progress.total}…
                  </span>
                )}
                {boot === 'ready' && status === 'error' && (
                  <span className="text-red-300">Composition error: {error}</span>
                )}
              </div>
            </div>
          )}
        </main>

        {!panelsHidden && <Inspector />}
      </div>
    </div>
  );
}
