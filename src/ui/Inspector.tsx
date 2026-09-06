'use client';

/**
 * Правая панель — плитки настроек.
 *
 * До этого инспектор был одним полотном из десяти секций подряд, и до «Сцены»
 * приходилось проматывать «Источник», «Переплёт», «Бумагу», «Набор», «Поля» и
 * «Том». Теперь секция — квадратная плитка с иконкой, а её содержимое
 * открывается карточкой рядом, по одной за раз: настраивают обычно одну вещь,
 * а не все десять, и видеть при этом сцену важнее, чем видеть соседнюю секцию.
 *
 * Набор плиток зависит от того, что на столе, — как и раньше зависел набор
 * секций: у тетради своя статистика и кисти, у тома источник и объём; переплёт,
 * бумага, набор, сцена и полка общие. Плитка, которой сейчас не к чему
 * относиться (выделение без выделенного), не показывается вовсе — пустая
 * карточка хуже отсутствующей.
 *
 * Здесь же живёт главный показ M0: счётчик под ползунком кегля пересчитывается
 * вместе с толщиной модели, поэтому цифры и геометрия видны одним взглядом.
 */
import { useState, type ReactNode } from 'react';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { linesPerPage } from '@/core/typography';
import { charsPerPage } from '@/core/library/volume';
import { CASE } from '@/scene/bookcase/caseGeometry';
import { SPINE_CAPACITY } from '@/scene/bookcase/atlasGrid';
import { Notice, Panel, Row, Select, Slider, Stat, Toggle } from './primitives';
import {
  BrushSection,
  EraserSection,
  NotebookSection,
  PageSection,
  SelectionSection,
  useJournalContext,
} from './journal/JournalInspector';
import { LayersPanel } from './journal/LayersPanel';
import { ToolIcon } from './journal/icons';
import { ClipPanel } from './clips/ClipPanel';
import { SharePanel } from './share/SharePanel';
import { useShell } from '@/store/useShell';
import { BindingSection, PaperSection } from './theme/BindingPanel';
import { ScenePanel } from './theme/ScenePanel';
import { Icon } from './icons';

/**
 * Языки, для которых имеет смысл переключаться вручную.
 *
 * Список короткий намеренно: язык влияет на словарь переносов, а значит на
 * число страниц и толщину тома. Из EPUB он приезжает сам, руками его меняют
 * только для txt и markdown, где взять его неоткуда.
 */
const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'it', label: 'Italiano' },
] as const;

interface Tile {
  id: string;
  label: string;
  icon: ReactNode;
  body: ReactNode;
}

export function Inspector() {
  const desk = useLibrary((s) => s.desk);
  /*
   * На столе тетрадь — секции набора про том незачем показывать: текста, к
   * которому они относятся, здесь нет. Кегль и поля остаются: от них зависит
   * толщина корешков на полке, а полка на месте.
   */
  const writing = desk?.kind === 'journal';
  const journal = useJournalContext();

  // На узком экране инспектор лежит в одном ящике с навигатором (см. Navigator).
  const compact = useShell((s) => s.device.compact);

  const [open, setOpen] = useState<string | null>(null);

  const tiles: Tile[] = [];

  if (writing) {
    tiles.push({ id: 'notebook', label: 'Notebook', icon: <Icon name="notebook" />, body: <NotebookSection /> });
    if (journal.page) {
      tiles.push({ id: 'page', label: 'Page', icon: <Icon name="page" />, body: <PageSection /> });
      tiles.push({ id: 'layers', label: 'Layers', icon: <Icon name="layers" />, body: <LayersPanel /> });
    }
    if (journal.brush) {
      tiles.push({
        id: 'brush',
        label: journal.brush === 'marker' ? 'Marker' : 'Pen',
        icon: <ToolIcon tool={journal.brush === 'marker' ? 'marker' : 'pen'} />,
        body: <BrushSection />,
      });
    }
    if (journal.tool === 'eraser') {
      tiles.push({ id: 'eraser', label: 'Eraser', icon: <ToolIcon tool="eraser" />, body: <EraserSection /> });
    }
    if (journal.block) {
      tiles.push({ id: 'selection', label: 'Selection', icon: <Icon name="selection" />, body: <SelectionSection /> });
    }
  } else {
    tiles.push({ id: 'source', label: 'Source', icon: <Icon name="source" />, body: <SourceSection /> });
  }

  /*
   * Переплёт выше набора — так же, как в §12.2: книгу сперва одевают, а
   * потом в неё вчитываются. Обе плитки одинаково относятся и к тому, и к
   * тетради: тетрадь — это книга, просто пустая.
   */
  if (desk) {
    tiles.push({ id: 'binding', label: 'Binding', icon: <Icon name="binding" />, body: <BindingSection /> });
    tiles.push({ id: 'paper', label: 'Paper', icon: <Icon name="paper" />, body: <PaperSection /> });
  }

  tiles.push({ id: 'type', label: 'Type', icon: <Icon name="type" />, body: <TypeSection /> });
  tiles.push({ id: 'margins', label: 'Margins', icon: <Icon name="margins" />, body: <MarginsSection /> });
  if (!writing) {
    tiles.push({ id: 'volume', label: 'Volume', icon: <Icon name="volume" />, body: <VolumeSection /> });
  }
  tiles.push({ id: 'clippings', label: 'Clippings', icon: <ToolIcon tool="clip" />, body: <ClipPanel /> });
  tiles.push({ id: 'scene', label: 'Scene', icon: <Icon name="scene" />, body: <ScenePanel /> });
  tiles.push({ id: 'storage', label: 'Storage', icon: <Icon name="storage" />, body: <SharePanel /> });
  tiles.push({ id: 'shelf', label: 'Shelf', icon: <Icon name="bookcase" />, body: <ShelfSection /> });
  tiles.push({ id: 'raster', label: 'Raster', icon: <Icon name="raster" />, body: <RasterSection /> });

  // Плитка могла исчезнуть вместе с тем, к чему относилась: карточка закрывается сама.
  const active = tiles.find((tile) => tile.id === open) ?? null;

  /*
   * Esc закрывает карточку и не идёт дальше: этажом выше та же клавиша уводит
   * от стола к стеллажу, а человек, нажавший её над ползунком, хотел закрыть
   * ползунок.
   */
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    setOpen(null);
  };

  const grid = (
    <>
      <header className="flex items-center justify-between px-3 py-2">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.13em] text-ash-400">
          {writing ? 'Notebook' : 'Book'} · settings
        </h2>
        <span className="tabular text-[10px] text-ash-400/70">{tiles.length}</span>
      </header>
      {/*
        Две колонки, а не три: плитка в сто пикселей читается с иконкой и
        подписью, плитка в шестьдесят — только с иконкой, и подпись под ней
        приходилось разбирать. В узком ящике на телефоне ширины больше, и там
        три колонки дают те же сто пикселей.
      */}
      <div className={`grid gap-2 overflow-y-auto px-2.5 pb-2.5 ${compact ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {tiles.map((tile) => {
          const on = tile.id === open;
          return (
            <button
              key={tile.id}
              type="button"
              aria-pressed={on}
              aria-label={tile.label}
              onClick={() => setOpen(on ? null : tile.id)}
              className={`flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border transition-colors ${
                on
                  ? 'border-brass-700/60 bg-brass-500/15 text-brass-300'
                  : 'border-ink-800 bg-ink-850 text-ash-400 hover:border-ink-700 hover:bg-ink-800 hover:text-ash-100'
              }`}
            >
              <span className="flex h-6 w-6 items-center justify-center [&>svg]:h-[22px] [&>svg]:w-[22px]">
                {tile.icon}
              </span>
              <span className="text-[11px] leading-none">{tile.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );

  if (compact) {
    /*
     * На узком экране карточке некуда всплывать: она встаёт на место сетки, а
     * строка сверху ведёт обратно. Это тот же ящик, только на этаж глубже.
     */
    return (
      <div className="flex w-full flex-col border-t border-ink-800" onKeyDown={onKey}>
        {active ? (
          <>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-ash-400 transition-colors hover:text-ash-100"
            >
              <Icon name="back" size={13} />
              settings
            </button>
            {active.body}
          </>
        ) : (
          grid
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col" onKeyDown={onKey}>
      {grid}

      {active ? (
        <div
          role="dialog"
          aria-label={active.label}
          className="absolute right-[calc(100%+10px)] top-2 flex max-h-[calc(100%-16px)] w-[292px] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900/97 shadow-[0_18px_48px_rgba(0,0,0,0.55)] backdrop-blur"
        >
          <div className="flex shrink-0 items-center justify-between px-3 pt-1.5">
            <span className="text-[10px] text-ash-400/60">{active.label}</span>
            <button
              type="button"
              aria-label="Close"
              title="Close (Esc)"
              onClick={() => setOpen(null)}
              className="flex h-5 w-5 items-center justify-center rounded text-ash-400 transition-colors hover:bg-ink-800 hover:text-ash-100"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto">{active.body}</div>
        </div>
      ) : null}
    </div>
  );
}

/* ─── Секции тома ────────────────────────────────────────────────────────── */

function SourceSection() {
  const doc = useBook((s) => s.doc);
  const typography = useBook((s) => s.typography);
  const setTypography = useBook((s) => s.setTypography);

  // Язык книги может быть 'en-GB' — в списке такого нет, показываем базовый.
  const langOption = LANGUAGES.find((l) => typography.lang.startsWith(l.value))?.value ?? 'en';

  return (
    <Panel title="Source">
      <Stat label="Format" value={doc.format === 'synthetic' ? 'generated' : doc.format} />
      {doc.sourceBytes > 0 ? (
        <Stat label="File" value={`${(doc.sourceBytes / 1024 / 1024).toFixed(2)} MB`} />
      ) : null}
      <Stat label="Chapters" value={doc.chapters.length} />
      {doc.imageCount > 0 ? (
        <Stat
          label="Images"
          value={`${doc.imageCount} · ${(doc.imageBytes / 1024).toFixed(0)} KB`}
          hint="Inlined as data URIs — the rasterizer cannot fetch anything else"
        />
      ) : null}
      {/*
        Только для файлов. У синтетики время генерации меряется и на сервере,
        и в браузере, значения не совпадают — и React ругается на расхождение
        разметки при гидратации.
      */}
      {doc.sourceBytes > 0 ? (
        <Stat label="Parsed in" value={`${Math.round(doc.tookMs)} ms`} />
      ) : null}
      <Row label="Language">
        <Select
          value={langOption}
          options={LANGUAGES}
          onChange={(lang) => setTypography({ lang })}
        />
      </Row>
      {doc.warnings.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {doc.warnings.slice(0, 4).map((w, i) => (
            <Notice key={i} tone="warn">
              {w.message}
            </Notice>
          ))}
          {doc.warnings.length > 4 ? (
            <span className="text-[10.5px] text-ash-400">
              +{doc.warnings.length - 4} more parse warnings
            </span>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function TypeSection() {
  const typography = useBook((s) => s.typography);
  const setTypography = useBook((s) => s.setTypography);

  return (
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
  );
}

function MarginsSection() {
  const typography = useBook((s) => s.typography);
  const setTypography = useBook((s) => s.setTypography);
  const margins = typography.margins;

  return (
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
  );
}

function VolumeSection() {
  const metrics = useBook((s) => s.metrics);
  const pagination = useBook((s) => s.pagination);
  const status = useBook((s) => s.status);

  return (
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
  );
}

function ShelfSection() {
  const metrics = useBook((s) => s.metrics);
  const shelved = useLibrary((s) => s.volumes);
  const desk = useLibrary((s) => s.desk);

  return (
    <Panel title="Shelf">
      <Stat label="On the shelf" value={`${shelved.length} of ${SPINE_CAPACITY}`} />
      <Stat
        label="Shelves"
        value={CASE.shelves}
        hint={`${CASE.innerWidth} cm each — the row wraps to the next one when it fills up`}
      />
      <Stat
        label="On the desk"
        value={desk ? desk.title : '—'}
        hint="The open book is not on the shelf: it is here"
      />
      <Stat
        label="Estimate"
        value={`${charsPerPage(metrics)} chars / page`}
        hint="How thick an unread volume is guessed to be until it is actually composed"
      />
    </Panel>
  );
}

function RasterSection() {
  const metrics = useBook((s) => s.metrics);
  const profile = useBook((s) => s.profile);
  const lastRender = useBook((s) => s.lastRender);
  const liveTextures = useBook((s) => s.liveTextures);
  const probe = useBook((s) => s.probe);
  const setProfile = useBook((s) => s.setProfile);

  return (
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
        hint={
          lastRender
            ? `Budget — 40 ms per page.
build ${lastRender.timings.build.toFixed(1)} · decode ${lastRender.timings.decode.toFixed(1)} · blit ${lastRender.timings.blit.toFixed(1)} ms`
            : 'Budget — 40 ms per page'
        }
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
  );
}

function profileLabel(p: 'mobile' | 'desktop' | 'zoom') {
  return p === 'mobile' ? '768' : p === 'desktop' ? '1024' : '1536';
}
