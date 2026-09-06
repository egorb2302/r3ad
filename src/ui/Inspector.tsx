'use client';

/**
 * Правая панель — набор тома.
 *
 * Здесь же живёт главный показ M0: счётчик под ползунком кегля пересчитывается
 * вместе с толщиной модели, поэтому цифры и геометрия видны одним взглядом.
 */
import { useBook } from '@/store/useBook';
import { linesPerPage } from '@/core/typography';
import { Panel, Row, Slider, Stat, Toggle } from './primitives';

export function Inspector() {
  const typography = useBook((s) => s.typography);
  const metrics = useBook((s) => s.metrics);
  const profile = useBook((s) => s.profile);
  const pagination = useBook((s) => s.pagination);
  const status = useBook((s) => s.status);
  const lastRender = useBook((s) => s.lastRender);
  const liveTextures = useBook((s) => s.liveTextures);
  const probe = useBook((s) => s.probe);
  const setTypography = useBook((s) => s.setTypography);
  const setProfile = useBook((s) => s.setProfile);

  const margins = typography.margins;

  return (
    <aside className="flex h-full w-[262px] shrink-0 flex-col overflow-y-auto border-l border-ink-800 bg-ink-900">
      <Panel title="Type">
        <Row label="Size">
          <Slider
            value={typography.sizePt}
            min={7}
            max={18}
            step={0.25}
            suffix=" pt"
            onChange={(sizePt) => setTypography({ sizePt })}
          />
        </Row>
        <Row label="Leading">
          <Slider
            value={typography.leading}
            min={1.05}
            max={2}
            step={0.05}
            onChange={(leading) => setTypography({ leading })}
          />
        </Row>
        <Row label="Indent">
          <Slider
            value={typography.indentEm}
            min={0}
            max={3}
            step={0.1}
            suffix=" em"
            onChange={(indentEm) => setTypography({ indentEm })}
          />
        </Row>
        <Row label="Setting">
          <div className="flex gap-1.5">
            <Toggle
              checked={typography.hyphens}
              onChange={(hyphens) => setTypography({ hyphens })}
              label="hyphens"
            />
            <Toggle
              checked={typography.justify}
              onChange={(justify) => setTypography({ justify })}
              label="justify"
            />
          </div>
        </Row>
      </Panel>

      <Panel title="Margins">
        <Row label="Top">
          <Slider
            value={margins.topMm}
            min={6}
            max={32}
            step={1}
            suffix=" mm"
            onChange={(topMm) => setTypography({ margins: { ...margins, topMm } })}
          />
        </Row>
        <Row label="Bottom">
          <Slider
            value={margins.bottomMm}
            min={6}
            max={36}
            step={1}
            suffix=" mm"
            onChange={(bottomMm) => setTypography({ margins: { ...margins, bottomMm } })}
          />
        </Row>
        <Row label="Inner">
          <Slider
            value={margins.innerMm}
            min={6}
            max={34}
            step={1}
            suffix=" mm"
            onChange={(innerMm) => setTypography({ margins: { ...margins, innerMm } })}
          />
        </Row>
        <Row label="Outer">
          <Slider
            value={margins.outerMm}
            min={4}
            max={34}
            step={1}
            suffix=" mm"
            onChange={(outerMm) => setTypography({ margins: { ...margins, outerMm } })}
          />
        </Row>
      </Panel>

      <Panel title="Volume">
        <Stat
          label="Pages"
          value={pagination ? pagination.pageCount : status === 'paginating' ? '…' : '—'}
        />
        <Stat label="Sheets" value={pagination ? pagination.sheetCount : '—'} />
        <Stat
          label="Thickness"
          value={pagination ? `${pagination.thicknessMm.toFixed(1)} mm` : '—'}
          hint="Sheet count × 0.10 mm — the thickness of 80 gsm offset paper"
        />
        <Stat label="Lines per page" value={linesPerPage(metrics)} />
        <Stat
          label="Text block"
          value={`${metrics.boxWidthPx}×${metrics.boxHeightPx}`}
          hint="Size of the text block in texture pixels"
        />
        <Stat label="Composition" value={pagination ? `${Math.round(pagination.tookMs)} ms` : '—'} />
      </Panel>

      <Panel title="Rasterization">
        <Row label="Profile">
          <div className="flex gap-1.5">
            {(['mobile', 'desktop', 'zoom'] as const).map((p) => (
              <Toggle
                key={p}
                checked={profile === p}
                onChange={() => setProfile(p)}
                label={profileLabel(p)}
              />
            ))}
          </div>
        </Row>
        <Stat label="Texture" value={`${metrics.pageWidthPx}×${metrics.pageHeightPx}`} />
        <Stat label="Resolution" value={`${Math.round(metrics.dpi)} dpi`} />
        <Stat
          label="Page"
          value={lastRender ? `${lastRender.ms.toFixed(0)} ms` : '—'}
          hint="Budget — 40 ms per page"
        />
        <Stat label="SVG size" value={lastRender ? `${lastRender.svgKb.toFixed(0)} KB` : '—'} />
        <Stat
          label="Fonts embedded"
          value={lastRender ? `${lastRender.fontKb.toFixed(0)} KB` : '—'}
          hint={lastRender?.fontFiles.join('\n')}
        />
        <Stat label="Live textures" value={`${liveTextures} / 8`} />
        {probe ? (
          <p
            className={`mt-2 rounded border px-2 py-1.5 text-[10.5px] leading-snug ${
              probe.ok
                ? 'border-ink-700 bg-ink-850 text-ash-400'
                : 'border-red-900/70 bg-red-950/40 text-red-300'
            }`}
          >
            {probe.note}
          </p>
        ) : null}
      </Panel>
    </aside>
  );
}

function profileLabel(p: 'mobile' | 'desktop' | 'zoom') {
  return p === 'mobile' ? '768' : p === 'desktop' ? '1024' : '1536';
}
