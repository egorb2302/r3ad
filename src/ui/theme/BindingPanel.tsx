'use client';

/**
 * Конструктор переплёта — то, ради чего сделана M6.
 *
 * Правится книга, лежащая на столе, и только она. Не «выделенный том» и не
 * «том под курсором»: переплёт видно на той книге, которая перед глазами, а
 * подбирать вслепую цвет корешка, стоящего в ряду боком, — занятие, в котором
 * ползунок не помогает.
 *
 * Порядок панелей повторяет §12.2 — обложка, тиснение, срез, бумага — и стоит
 * выше набора: одевают книгу раньше, чем в неё вчитываются.
 */
import {
  BINDINGS,
  EDGES,
  FOILS,
  MATERIALS,
  TINTS,
  type BookTheme,
} from '@/core/theme';
import { PHYS, sheetsToThicknessMm } from '@/core/units';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { Panel, Row, Select, Slider, Stat, Swatch, Toggle } from '../primitives';

/** Цвет ленты по умолчанию, когда её включают впервые. */
const RIBBON = '#8d2f33';

export function BindingPanel() {
  const desk = useLibrary((s) => s.desk);
  const dress = useLibrary((s) => s.dress);
  const sheets = useBook((s) => s.sheets);

  if (!desk) return null;
  const theme = desk.theme;

  const patch = (next: Partial<BookTheme>) => dress(desk.id, { ...theme, ...next });
  const cover = (next: Partial<BookTheme['cover']>) => patch({ cover: { ...theme.cover, ...next } });
  const paper = (next: Partial<BookTheme['paper']>) => patch({ paper: { ...theme.paper, ...next } });

  const thickness = sheetsToThicknessMm(sheets, theme.paper.gsm) + PHYS.coverThicknessMm * 2;

  return (
    <>
      <Panel title="Binding">
        {/*
          Готовые переплёты в один щелчок. Ползунки остаются для тех, кто
          знает, чего хочет; всем остальным нужен ряд разных книг, а не
          четыре параметра, из которых надо собрать первую.
        */}
        <div className="mb-2.5 grid grid-cols-2 gap-1">
          {BINDINGS.map((binding) => (
            <button
              key={binding.name}
              type="button"
              onClick={() => dress(desk.id, binding.theme)}
              className="flex items-center gap-1.5 rounded bg-ink-800 px-1.5 py-1 text-left text-[10.5px] text-ash-300 transition-colors hover:bg-ink-700 hover:text-ash-100"
            >
              <span
                className="h-[11px] w-[11px] shrink-0 rounded-sm border border-black/40"
                style={{ backgroundColor: binding.theme.cover.color }}
              />
              <span className="truncate">{binding.name}</span>
            </button>
          ))}
        </div>

        <Row label="Material">
          <Select
            value={theme.cover.material}
            options={MATERIALS}
            onChange={(material) => cover({ material })}
          />
        </Row>
        <Row label="Colour">
          <Swatch value={theme.cover.color} onChange={(color) => cover({ color })} />
        </Row>
        <Row label="Stamping">
          <Select value={theme.cover.foil} options={FOILS} onChange={(foil) => cover({ foil })} />
        </Row>
        <Row label="Wear">
          <Slider
            value={Math.round(theme.cover.wear * 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(wear) => cover({ wear: wear / 100 })}
          />
        </Row>
        <Row label="Ribbon">
          <div className="flex items-center gap-2">
            <Toggle
              checked={theme.ribbon !== null}
              onChange={(on) => patch({ ribbon: on ? RIBBON : null })}
              label="marker"
            />
            {theme.ribbon ? (
              <Swatch value={theme.ribbon} onChange={(ribbon) => patch({ ribbon })} />
            ) : null}
          </div>
        </Row>
      </Panel>

      <Panel title="Paper">
        <Row label="Tint">
          <Select value={theme.paper.tint} options={TINTS} onChange={(tint) => paper({ tint })} />
        </Row>
        <Row label="Weight">
          <Slider
            value={theme.paper.gsm}
            min={50}
            max={140}
            step={5}
            suffix=" gsm"
            onChange={(gsm) => paper({ gsm })}
          />
        </Row>
        <Row label="Edges">
          <Select value={theme.paper.edge} options={EDGES} onChange={(edge) => paper({ edge })} />
        </Row>
        {/* У золочёного среза краска своя — сусальное золото, и выбирать там нечего. */}
        {theme.paper.edge === 'sprayed' || theme.paper.edge === 'marbled' ? (
          <Row label="Edge ink">
            <Swatch
              value={theme.paper.edgeColor}
              onChange={(edgeColor) => paper({ edgeColor })}
            />
          </Row>
        ) : null}
        <Stat
          label="Thickness"
          value={`${thickness.toFixed(1)} mm`}
          hint="Sheet count × paper weight plus two boards — heavier paper makes a thicker book, not a longer one"
        />
      </Panel>
    </>
  );
}
