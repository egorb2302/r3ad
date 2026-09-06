'use client';

/**
 * Инспектор тетради: страница, инструмент, выделение, объём.
 *
 * Порядок панелей повторяет порядок вопросов, которые возникают у пишущего:
 * чем пишу, на чём пишу, что выбрано, сколько всего написано. Инспектор тома
 * при раскрытой тетради не показывается — набор и поля относятся к тексту,
 * которого здесь нет.
 */
import { assetSize } from '@/core/journal/assets';
import { BACKGROUNDS } from '@/core/journal/background';
import { journalExtent, journalStats } from '@/core/journal/journal';
import { blockLayer, type Block } from '@/core/journal/types';
import { BRUSH_OF, useJournal } from '@/store/useJournal';
import { Panel, Row, Select, Slider, Stat, Toggle } from '../primitives';

/** Чернила: тёмные и насыщенные, чтобы читались на кремовой бумаге. */
const INKS = ['#1b2b3f', '#6d1f1f', '#1f4d2c', '#2f2f33', '#4a2f7a'];
/** Маркеры: светлые, потому что кладутся умножением поверх текста. */
const MARKERS = ['#f0c93f', '#8fd6a8', '#93bdf2', '#f2a0c4', '#c8ec6a'];

export function JournalInspector() {
  const openId = useJournal((s) => s.openId);
  const docs = useJournal((s) => s.docs);
  const flatPage = useJournal((s) => s.flatPage);
  const tool = useJournal((s) => s.tool);
  const brushes = useJournal((s) => s.brushes);
  const eraser = useJournal((s) => s.eraser);
  const selection = useJournal((s) => s.selection);
  const setBrush = useJournal((s) => s.setBrush);
  const setEraser = useJournal((s) => s.setEraser);
  const setBackground = useJournal((s) => s.setBackground);
  const addLeaf = useJournal((s) => s.addLeaf);
  const apply = useJournal((s) => s.apply);
  const deleteSelection = useJournal((s) => s.deleteSelection);

  const journal = openId ? docs[openId] ?? null : null;
  if (!journal) return null;

  const extent = journalExtent(journal);
  const stats = journalStats(journal);
  const assetBytes = stats.images.reduce((sum, hash) => sum + assetSize(hash), 0);

  const page = flatPage !== null ? journal.pages[flatPage] ?? null : null;
  const brush = BRUSH_OF[tool];
  const settings = brush ? brushes[brush] : null;
  const swatches = brush === 'marker' ? MARKERS : INKS;

  const block: Block | null =
    page && selection ? blockLayer(page).blocks.find((b) => b.id === selection) ?? null : null;

  const update = (next: Block) => {
    if (!page || !block) return;
    apply({ type: 'block:update', page: page.id, id: block.id, from: block, to: next });
  };

  return (
    <>
      <Panel title="Notebook">
        <Stat label="Pages" value={extent.pages} />
        <Stat
          label="Thickness"
          value={`${extent.thicknessMm.toFixed(1)} mm`}
          hint="Leaf count × 0.10 mm plus two boards — the same formula as a volume"
        />
        <Stat label="Strokes" value={stats.strokes} />
        <Stat
          label="Points"
          value={stats.points}
          hint="Every point carries pressure and time: the notes can be replayed later"
        />
        <Stat label="Blocks" value={stats.blocks} />
        {stats.images.length > 0 ? (
          <Stat
            label="Images"
            value={`${stats.images.length} · ${(assetBytes / 1024).toFixed(0)} KB`}
            hint="Stored by sha256 — the same screenshot pasted twice is kept once"
          />
        ) : null}
        <button
          type="button"
          onClick={addLeaf}
          className="mt-2 h-[22px] w-full rounded bg-ink-800 text-[11px] text-ash-300 transition-colors hover:bg-ink-700 hover:text-ash-100"
        >
          Add a leaf
        </button>
      </Panel>

      {page ? (
        <Panel title="Page">
          <Row label="Ruling">
            <Select
              value={page.background}
              options={BACKGROUNDS}
              onChange={(background) => setBackground(background)}
            />
          </Row>
          <Stat label="Number" value={`${(flatPage ?? 0) + 1} of ${extent.pages}`} />
        </Panel>
      ) : null}

      {settings && brush ? (
        <Panel title={brush === 'marker' ? 'Marker' : 'Pen'}>
          <Row label="Ink">
            <div className="flex gap-1.5">
              {swatches.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setBrush({ color })}
                  aria-label={color}
                  className={`h-[18px] w-[18px] rounded-sm border transition-transform ${
                    settings.color === color
                      ? 'border-ash-200 scale-110'
                      : 'border-ink-700 hover:border-ink-600'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </Row>
          <Row label="Width">
            <Slider
              value={settings.width}
              min={brush === 'marker' ? 2 : 0.2}
              max={brush === 'marker' ? 14 : 3}
              step={brush === 'marker' ? 0.5 : 0.1}
              suffix=" mm"
              onChange={(width) => setBrush({ width })}
            />
          </Row>
          <Row label="Opacity">
            <Slider
              value={settings.opacity}
              min={0.1}
              max={1}
              step={0.02}
              onChange={(opacity) => setBrush({ opacity })}
            />
          </Row>
        </Panel>
      ) : null}

      {tool === 'eraser' ? (
        <Panel title="Eraser">
          <Row label="Radius">
            <Slider value={eraser} min={1} max={12} step={0.5} suffix=" mm" onChange={setEraser} />
          </Row>
          <p className="mt-1 text-[10.5px] leading-snug text-ash-400">
            Erases whole strokes, not pixels — the page stays vector.
          </p>
        </Panel>
      ) : null}

      {block ? (
        <Panel title="Selection">
          <Stat label="Kind" value={block.type} />
          <Row label="Rotation">
            <Slider
              value={Math.round((block.rot * 180) / Math.PI)}
              min={-30}
              max={30}
              step={1}
              suffix="°"
              onChange={(deg) => update({ ...block, rot: (deg * Math.PI) / 180 })}
            />
          </Row>
          {block.type === 'image' ? (
            <Row label="Frame">
              <Toggle
                checked={block.frame === 'polaroid'}
                onChange={(on) => update({ ...block, frame: on ? 'polaroid' : 'none' })}
                label="polaroid"
              />
            </Row>
          ) : (
            <>
              <Row label="Size">
                <Slider
                  value={block.style.sizeMm}
                  min={2}
                  max={14}
                  step={0.5}
                  suffix=" mm"
                  onChange={(sizeMm) =>
                    update({ ...block, style: { ...block.style, sizeMm } })
                  }
                />
              </Row>
              <Row label="Face">
                <div className="flex gap-1.5">
                  <Toggle
                    checked={block.style.family === 'serif'}
                    onChange={() => update({ ...block, style: { ...block.style, family: 'serif' } })}
                    label="serif"
                  />
                  <Toggle
                    checked={block.style.family === 'sans'}
                    onChange={() => update({ ...block, style: { ...block.style, family: 'sans' } })}
                    label="sans"
                  />
                </div>
              </Row>
            </>
          )}
          <button
            type="button"
            onClick={deleteSelection}
            className="mt-2 h-[22px] w-full rounded bg-ink-800 text-[11px] text-red-300/80 transition-colors hover:bg-red-950/50 hover:text-red-300"
          >
            Delete
          </button>
        </Panel>
      ) : null}
    </>
  );
}
