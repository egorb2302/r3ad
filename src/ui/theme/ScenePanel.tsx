'use client';

/**
 * Сцена: свет, экспозиция, тени, дерево.
 *
 * Порода одна на стеллаж и стол: это одна комната и одна мебель, а стол под
 * светлым лаком той же породы (см. scene/bookcase/wood) — не отдельный выбор.
 *
 * Панель короткая намеренно. Свет — это то, что настраивают один раз и больше
 * не трогают, и десять ползунков здесь означали бы десять способов испортить
 * кадр. Пресет выбирает светотень целиком (см. scene/lighting), а руками
 * остаётся ровно то, что зависит от экрана и вкуса: общий уровень и глубина
 * теней.
 */
import { PRESETS, WOODS } from '@/core/theme';
import { useTheme } from '@/store/useTheme';
import { Panel, Row, Select, Slider } from '../primitives';

export function ScenePanel() {
  const scene = useTheme((s) => s.scene);
  const setScene = useTheme((s) => s.setScene);

  return (
    <Panel title="Scene">
      <Row label="Light">
        <Select value={scene.preset} options={PRESETS} onChange={(preset) => setScene({ preset })} />
      </Row>
      <Row label="Exposure">
        <Slider
          value={Number(scene.exposure.toFixed(2))}
          min={0.6}
          max={1.4}
          step={0.05}
          onChange={(exposure) => setScene({ exposure })}
        />
      </Row>
      <Row label="Shadows">
        <Slider
          value={Number(scene.shadows.toFixed(2))}
          min={0}
          max={1}
          step={0.05}
          onChange={(shadows) => setScene({ shadows })}
        />
      </Row>
      <Row label="Wood">
        <Select value={scene.wood} options={WOODS} onChange={(wood) => setScene({ wood })} />
      </Row>
      <p className="mt-2 text-[10.5px] leading-snug text-ash-400">
        Depth of field is not here: it costs a full-screen pass, and the thing it
        would buy — separating the book from the shelf — the fog already does.
      </p>
    </Panel>
  );
}
