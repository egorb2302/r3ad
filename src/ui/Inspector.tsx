'use client';

/**
 * Правая панель — набор тома.
 *
 * Здесь же живёт главный показ M0: счётчик под ползунком кегля пересчитывается
 * вместе с толщиной модели, поэтому цифры и геометрия видны одним взглядом.
 */
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { linesPerPage } from '@/core/typography';
import { charsPerPage } from '@/core/library/volume';
import { CASE } from '@/scene/bookcase/caseGeometry';
import { SPINE_CAPACITY } from '@/scene/bookcase/spineInstances';
import { Notice, Panel, Row, Select, Slider, Stat, Toggle } from './primitives';
import { JournalInspector } from './journal/JournalInspector';
import { ClipPanel } from './clips/ClipPanel';

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

export function Inspector() {
  const doc = useBook((s) => s.doc);
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

  const shelved = useLibrary((s) => s.volumes);
  const desk = useLibrary((s) => s.desk);
  /*
   * На столе тетрадь — панели набора про том незачем показывать: текста, к
   * которому они относятся, здесь нет. Кегль и поля остаются: от них зависит
   * толщина корешков на полке, а полка на месте.
   */
  const writing = desk?.kind === 'journal';

  const margins = typography.margins;

  // Язык книги может быть 'en-GB' — в списке такого нет, показываем базовый.
  const langOption = LANGUAGES.find((l) => typography.lang.startsWith(l.value))?.value ?? 'en';

  return (
    <aside className="flex h-full w-[262px] shrink-0 flex-col overflow-y-auto border-l border-ink-800 bg-ink-900">
      {writing ? <JournalInspector /> : null}

      {writing ? null : (
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
      )}

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

      {writing ? null : (
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
      )}

      <ClipPanel />

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
    </aside>
  );
}

function profileLabel(p: 'mobile' | 'desktop' | 'zoom') {
  return p === 'mobile' ? '768' : p === 'desktop' ? '1024' : '1536';
}
