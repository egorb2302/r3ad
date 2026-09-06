'use client';

/**
 * Слои страницы (SPEC §9.2, вопрос §21.11).
 *
 * Модель держала слои с M3 — порядок, видимость, замок были в документе и
 * ничем не управлялись. Заводить панель раньше было нечем: на странице лежали
 * два слоя, и оба всегда включены. К M6 раскладывать стало что — вырезка,
 * скриншот, обводка поверх них, — и первым же настоящим вопросом оказался не
 * «сколько слоёв», а «что выше»: обводка, положенная под карточку, пропадает,
 * и без панели вернуть её оттуда нечем, кроме как переложив всё заново.
 *
 * Слоёв по-прежнему два, и это не заготовка под десять. Страница тетради — не
 * макет: на ней есть предметы и есть то, чем по ним пишут, и третьей сущности
 * за три вехи не появилось. Панель поэтому показывает то, что есть, а не
 * дерево с кнопкой «добавить слой», которой нечего добавлять.
 *
 * Сверху вниз — от верхнего слоя к нижнему, как в любом редакторе. В документе
 * порядок обратный (снизу вверх, в порядке отрисовки), и переворот делается
 * здесь: рисование обязано читаться сверху вниз по коду, а панель — сверху вниз
 * по экрану.
 */
import type { Layer } from '@/core/journal/types';
import { useJournal } from '@/store/useJournal';
import { Panel } from '../primitives';
import { LayerIcon } from './icons';

const NAMES: Record<Layer['type'], string> = {
  strokes: 'Ink',
  blocks: 'Objects',
};

function countOf(layer: Layer): number {
  return layer.type === 'strokes' ? layer.strokes.length : layer.blocks.length;
}

export function LayersPanel() {
  const openId = useJournal((s) => s.openId);
  const docs = useJournal((s) => s.docs);
  const flatPage = useJournal((s) => s.flatPage);
  const setLayerFlags = useJournal((s) => s.setLayerFlags);
  const moveLayer = useJournal((s) => s.moveLayer);

  const journal = openId ? docs[openId] ?? null : null;
  const page = journal && flatPage !== null ? journal.pages[flatPage] ?? null : null;
  if (!page) return null;

  const top = [...page.layers].reverse();

  return (
    <Panel title="Layers">
      <div className="flex flex-col gap-0.5">
        {top.map((layer, index) => {
          const count = countOf(layer);
          return (
            <div
              key={layer.id}
              className={`flex items-center gap-1 rounded px-1 py-[3px] ${
                layer.visible ? 'bg-ink-850' : 'bg-ink-900'
              }`}
            >
              <span
                className={`flex-1 truncate text-[11px] ${
                  layer.visible ? 'text-ash-200' : 'text-ash-400 line-through'
                }`}
              >
                {NAMES[layer.type]}
              </span>
              <span className="tabular mr-1 text-[10px] text-ash-400">{count}</span>

              <IconButton
                label={layer.visible ? 'Hide layer' : 'Show layer'}
                active={!layer.visible}
                onClick={() => setLayerFlags(layer.id, { visible: !layer.visible })}
              >
                <LayerIcon mark={layer.visible ? 'eye' : 'blind'} />
              </IconButton>
              <IconButton
                label={layer.locked ? 'Unlock layer' : 'Lock layer'}
                active={layer.locked}
                onClick={() => setLayerFlags(layer.id, { locked: !layer.locked })}
              >
                <LayerIcon mark={layer.locked ? 'locked' : 'open'} />
              </IconButton>
              {/* Верхний слой поднимать некуда, нижний опускать: кнопка гаснет. */}
              <IconButton
                label={index === 0 ? 'Send down' : 'Bring up'}
                disabled={top.length < 2}
                onClick={() => moveLayer(layer.id, index === 0 ? -1 : 1)}
              >
                <LayerIcon mark="up" flip={index === 0} />
              </IconButton>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[10.5px] leading-snug text-ash-400">
        A locked layer lets the pointer through: nothing on it can be picked,
        drawn on or erased.
      </p>
    </Panel>
  );
}

function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-[18px] w-[18px] items-center justify-center rounded transition-colors ${
        disabled
          ? 'text-ink-700'
          : active
            ? 'bg-ink-700 text-brass-300'
            : 'text-ash-400 hover:bg-ink-800 hover:text-ash-200'
      }`}
    >
      {children}
    </button>
  );
}
