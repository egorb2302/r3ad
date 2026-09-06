'use client';

/**
 * Вьюпорт: сцена, свет, камера, ввод.
 *
 * Три решения по итогам M0, которые здесь важно не «починить» обратно:
 *
 * — Состояние читается здесь, снаружи Canvas, и уходит внутрь пропсами. R3F
 *   монтирует детей в отдельный React-корень; подписываться на стор изнутри
 *   него ненадёжно, и сцена как чистая функция от пропсов всё равно лучше —
 *   ту же книгу потом покажет стеллаж.
 *
 * — frameloop оставлен непрерывным. Режим demand в этой связке R3F 9 / React 19
 *   не доводит работу своего корня до коммита, пока по сцене не щёлкнут мышью:
 *   вёрстка уже посчитана, текстуры готовы, а книга не появляется. Ради чего
 *   demand и затевался — конкуренция за главный поток — снято в другом месте,
 *   заменой rAF на setTimeout при разбивке (см. core/paginate). Вернуться к
 *   demand стоит на M7, когда будет чем проверить регрессию.
 *
 * — Никаких карт теней. Единственные тени, которые тут действительно нужны, —
 *   контактная под книгой и от поднятого листа; обе дешевле рисуются иначе.
 *
 * Свет собирается из Lightformer'ов, а не из HDRI-файла: окружение считается на
 * месте, без сетевой загрузки — важно и для оффлайна, и чтобы первый кадр не
 * ждал мегабайтную карту.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Book } from './Book';
import { Leaf } from './Leaf';
import { blockThickness, COVER_H, COVER_T, COVER_W, GUTTER, TRIM_H, TRIM_W } from './geometry';
import { MAX_SPEED, motion, planTurn, releaseTarget, resetMotion, type TurnPlan } from './turn';
import { flight } from './flight';
import { Bookcase } from './bookcase/Bookcase';
import { Spines } from './bookcase/Spines';
import { FlyingVolume } from './bookcase/FlyingVolume';
import { CASE, VOLUME_HEIGHT } from './bookcase/caseGeometry';
import { SPINE_CAPACITY } from './bookcase/spineInstances';
import { CameraRig } from './camera/CameraRig';
import { FlatProbe } from './journal/FlatProbe';
import { useJournalTextures } from './journal/useJournalTextures';
import { DevHandle } from './DevHandle';
import { Lighting, shadowLook } from './lighting';
import { layoutShelves } from '@/core/library/shelfLayout';
import { themeFor } from '@/core/theme';
import { volumeExtent } from '@/core/library/volume';
import { typographyKey } from '@/core/paginate/paginate';
import { lastSpread, mm } from '@/core/units';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { useTheme } from '@/store/useTheme';
import { spreadOf, useJournal } from '@/store/useJournal';
import { usePageTextures } from './usePageTextures';

/** Ближе этого к корешку хват за страницу не считается: рычага там нет. */
const MIN_GRIP = GUTTER + TRIM_W / 4;

function Desk() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
      <planeGeometry args={[300, 300]} />
      <meshStandardMaterial color="#241e19" roughness={0.95} metalness={0} />
    </mesh>
  );
}

/** Внешность книги, у которой ещё нет записи в библиотеке: между сменой тома и полётом. */
const FALLBACK_THEME = themeFor('r3ad');

export function Viewport() {
  const deskSheets = useBook((s) => s.sheets);
  const deskPages = useBook((s) => s.pages);
  const metrics = useBook((s) => s.metrics);
  const typography = useBook((s) => s.typography);
  const currentSheet = useBook((s) => s.currentSheet);
  const turn = useBook((s) => s.turn);
  const turnRequest = useBook((s) => s.turnRequest);
  const setTurn = useBook((s) => s.setTurn);
  const endTurn = useBook((s) => s.endTurn);

  const view = useLibrary((s) => s.view);
  const volumes = useLibrary((s) => s.volumes);
  const desk = useLibrary((s) => s.desk);
  const hovered = useLibrary((s) => s.hovered);
  const armed = useLibrary((s) => s.armed);
  const flying = useLibrary((s) => s.flight);
  const hover = useLibrary((s) => s.hover);
  const select = useLibrary((s) => s.select);
  const reorder = useLibrary((s) => s.reorder);
  const arrived = useLibrary((s) => s.arrived);

  const flatPage = useJournal((s) => s.flatPage);
  const scene = useTheme((s) => s.scene);
  const shadow = shadowLook(scene);

  /*
   * Одетая книга — та, что на столе, а во время полёта та, что летит: стол в
   * эти секунды уже пуст, а показывать надо всё ещё её бумагу и её переплёт.
   * Читается до текстур: тон бумаги запечён в растр страницы.
   */
  const dressed = desk ?? volumes.find((v) => v.id === flying?.id) ?? null;
  const theme = dressed?.theme ?? FALLBACK_THEME;

  /*
   * Два источника текстур разворота — том и тетрадь. Оба хука зовутся всегда:
   * бездействующий не печатает ничего, а условный вызов хука невозможен. Кто
   * из них показывается, решает то, что лежит на столе.
   */
  const printed = usePageTextures(theme.paper.tint);
  const written = useJournalTextures(theme.paper.tint);
  const journalOnDesk = desk?.kind === 'journal';
  const pages = journalOnDesk ? written : printed;

  /*
   * Расстановка — чистая функция от порядка книг и набора, поэтому считается
   * здесь, а не в сторе: полке незачем знать, что где-то есть сцена, а сцене
   * незачем хранить то, что выводится.
   */
  const typeKey = useMemo(() => typographyKey(metrics, typography), [metrics, typography]);
  const byId = useMemo(() => new Map(volumes.map((v) => [v.id, v])), [volumes]);

  const layout = useMemo(
    () =>
      layoutShelves(
        volumes,
        metrics,
        typeKey,
        { shelves: CASE.shelves, innerWidth: CASE.innerWidth, capacity: SPINE_CAPACITY },
        VOLUME_HEIGHT,
      ),
    [metrics, typeKey, volumes],
  );

  const flyingVolume = flying ? byId.get(flying.id) ?? desk : null;
  const flyingPlacement = flying ? layout.byId.get(flying.id) ?? null : null;

  const sheets = deskSheets;
  const pageCount = deskPages;

  /** Номер страницы или null, если за пределами книги. */
  const page = useCallback(
    (index: number) => (index >= 0 && index < pageCount ? index : null),
    [pageCount],
  );

  /*
   * Что видно на экране. Во время переворота половины книги описываются нижним
   * листом пары: слева лежат a листов, справа — все остальные минус тот, что в
   * воздухе, а неподвижные страницы это уже 2a−1 и 2a+2, потому что лист,
   * закрывавший правую, поднялся.
   */
  const spread = turn
    ? {
        leftSheets: turn.a,
        rightSheets: Math.max(0, sheets - turn.a - 1),
        leftPage: page(2 * turn.a - 1),
        rightPage: page(2 * turn.a + 2),
        front: page(2 * turn.a),
        back: page(2 * turn.a + 1),
      }
    : {
        leftSheets: currentSheet,
        rightSheets: Math.max(0, sheets - currentSheet),
        leftPage: page(2 * currentSheet - 1),
        rightPage: page(2 * currentSheet),
        front: null,
        back: null,
      };

  const { request } = pages;
  useEffect(() => {
    /*
     * В плоском режиме страницу закрывает холст, и печатать её ещё и в текстуру
     * на каждый штрих значит платить дважды за то, чего не видно. Текстура
     * догоняет документ один раз — когда от тетради поднимаются.
     */
    if (flatPage !== null) return;

    const base = turn ? turn.a : currentSheet;
    return request(
      [spread.leftPage, spread.rightPage, spread.front, spread.back],
      // Соседние развороты готовим в простое: листание не должно ждать растр.
      [page(2 * base + 1), page(2 * base + 2), page(2 * base - 2), page(2 * base - 3)],
    );
  }, [
    request,
    page,
    turn,
    currentSheet,
    flatPage,
    spread.leftPage,
    spread.rightPage,
    spread.front,
    spread.back,
  ]);

  const startTurn = useCallback(
    (dir: 1 | -1, dragging: boolean): TurnPlan | null => {
      // Пока книга закрывается и летит, листать нечего.
      if (flight.active) return null;
      const state = useBook.getState();
      const plan = planTurn(state.currentSheet, lastSpread(state.pages), dir);
      if (!plan) return null;

      /*
       * Позу листа выставляем до того, как о перевороте узнает React: к моменту
       * монтирования Leaf прогресс уже на своём краю, и первый кадр не мигает.
       * Перетаскиваемый лист остаётся без цели — её задаст палец, когда его
       * отпустят; всем остальным цель нужна сразу, иначе пружине некуда ехать.
       */
      resetMotion(plan.from, dragging ? plan.from : plan.commitAt, dragging);
      setTurn(plan);
      return plan;
    },
    [setTurn],
  );

  // Заявки от клавиатуры и тулбара приходят через стор — оттуда до сцены иначе
  // не дотянуться, она живёт в другом React-корне.
  useEffect(() => {
    if (!turnRequest) return;
    startTurn(turnRequest.dir, false);
  }, [turnRequest, startTurn]);

  const onSettled = useCallback((target: number) => endTurn(target), [endTurn]);

  /*
   * Где лежит страница под пером. Высота — верх соответствующей стопки: камера
   * должна лечь над той бумагой, которая сейчас сверху, а не над столом.
   */
  const side = flatPage !== null ? spreadOf(flatPage).side : 'right';
  const flatFocus =
    flatPage !== null && journalOnDesk
      ? {
          x: side === 'right' ? GUTTER + TRIM_W / 2 : -(GUTTER + TRIM_W / 2),
          y:
            COVER_T +
            blockThickness(
              side === 'right' ? spread.rightSheets : spread.leftSheets,
              theme.paper.gsm,
            ) +
            0.004,
        }
      : null;

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ position: [0, 42, 50], fov: 30, near: 0.5, far: 500 }}
    >
      {/* Свет, фон и туман — пресетом (см. scene/lighting). */}
      <Lighting scene={scene} />

      <Desk />
      <Bookcase species={scene.wood} />

      <Spines
        volumes={byId}
        placements={layout.order}
        hovered={hovered}
        armed={armed}
        hidden={flying?.id ?? null}
        onHover={hover}
        onSelect={select}
        onReorder={reorder}
      />

      {flying && flyingVolume && flyingPlacement ? (
        <FlyingVolume
          key={flying.id}
          volume={flyingVolume}
          thickness={mm(volumeExtent(flyingVolume, metrics, typeKey).thicknessMm)}
          placement={flyingPlacement}
          onArrived={arrived}
        />
      ) : null}

      {/* Пустой стол — это пустой стол: книга уехала на полку, и её тут нет */}
      {desk || flying ? (
        <Book
          leftSheets={spread.leftSheets}
          rightSheets={spread.rightSheets}
          leftPage={pages.get(spread.leftPage)}
          rightPage={pages.get(spread.rightPage)}
          theme={theme}
          title={dressed?.title ?? ''}
          author={dressed?.author ?? ''}
        />
      ) : null}

      {turn ? (
        <Leaf
          key={`${turn.a}-${turn.from}`}
          front={pages.get(spread.front)}
          back={pages.get(spread.back)}
          leftSheets={spread.leftSheets}
          rightSheets={spread.rightSheets}
          tint={theme.paper.tint}
          gsm={theme.paper.gsm}
          onSettled={onSettled}
        />
      ) : null}

      <TurnInput onStart={startTurn} />
      <CameraRig view={view} flat={flatFocus} />
      <FlatProbe
        x={flatFocus?.x ?? 0}
        y={flatFocus?.y ?? 0}
        width={TRIM_W}
        height={TRIM_H}
        active={flatFocus !== null}
      />
      <DevHandle />

      {/* Единственная тень в сцене: контактная под книгой. Её задаёт тема. */}
      <ContactShadows
        position={[0, 0.003, 0]}
        opacity={shadow.opacity}
        scale={80}
        blur={shadow.blur}
        far={8}
        resolution={512}
        color={shadow.color}
      />

      {/* Пределы приближения и цель ведёт CameraRig: у стола и у полки они разные */}
      <OrbitControls
        makeDefault
        enablePan={false}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI / 2.2}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}

interface TurnInputProps {
  onStart: (dir: 1 | -1, dragging: boolean) => TurnPlan | null;
}

/**
 * Перетаскивание страницы за угол.
 *
 * Это тот самый признак, по которому проект отличается от роликов с
 * перелистыванием: `t` берётся из положения курсора, а не из таймера, поэтому
 * страница слушается пальца, включая остановку на середине и возврат.
 *
 * Движение слушается на окне, а не на самом меше. R3F доставляет pointermove
 * только пока указатель над объектом, а перетаскивание страницы почти всегда
 * уводит курсор с неё — и на полпути лист бы замирал. Пересечение с плоскостью
 * книги считаем сами: один Raycaster против математической плоскости дешевле
 * любого меша-перехватчика.
 */
function TurnInput({ onStart }: TurnInputProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -(COVER_T + 0.2)), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  const drag = useRef<{
    /** Расстояние от корешка до точки, за которую взяли лист. */
    grip: number;
    from: number;
    commitAt: number;
    time: number;
    moved: boolean;
  } | null>(null);

  /**
   * Прогресс переворота по положению курсора.
   *
   * Считаем не по внешнему краю листа, а по той точке, за которую его взяли:
   * она лежит на расстоянии grip от корешка и при повороте на θ оказывается в
   * x = grip·cos θ. Отсюда θ = acos(x / grip).
   *
   * Разница не теоретическая. Если мерить по внешнему краю, лист, взятый за
   * середину, доходит от силы до двух третей переворота, сколько его ни тяни, —
   * до края страницы курсору просто не хватает хода. При счёте по точке захвата
   * лист слушается пальца одинаково, где его ни возьми, и никуда не прыгает в
   * момент нажатия: в этой точке θ по построению равно текущему.
   */
  const progressAt = useCallback(
    (x: number, grip: number) => Math.acos(THREE.MathUtils.clamp(x / grip, -1, 1)) / Math.PI,
    [],
  );

  /** Точка на плоскости книги под курсором, либо null — курсор мимо. */
  const pointerToBook = useCallback(
    (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
    },
    [camera, gl, hit, ndc, plane, raycaster],
  );

  useEffect(() => {
    const canvas = gl.domElement;

    const onMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;

      const point = pointerToBook(event.clientX, event.clientY);
      if (!point) return;

      const next = progressAt(point.x, state.grip);
      if (Math.abs(next - state.from) > 0.015) state.moved = true;

      const now = performance.now();
      const dt = Math.max((now - state.time) / 1000, 1 / 240);

      motion.velocity = THREE.MathUtils.clamp((next - motion.t) / dt, -MAX_SPEED, MAX_SPEED);
      motion.t = next;
      state.time = now;
    };

    const onUp = () => {
      const state = drag.current;
      drag.current = null;
      if (controls) controls.enabled = true;
      if (!state) return;

      motion.dragging = false;
      // Щелчок без протяжки — тоже листание: не заставлять же тащить каждую страницу.
      motion.target = state.moved ? releaseTarget(motion) : state.commitAt;
    };

    const onDown = (event: PointerEvent) => {
      // Пока лист в воздухе, за следующий не берёмся.
      if (event.button !== 0 || drag.current || useBook.getState().turn) return;

      const point = pointerToBook(event.clientX, event.clientY);
      /*
       * Мимо книги — значит, человек вращает камеру, а не берёт страницу.
       * Границей служит переплёт, а не наборная полоса: кант обложки выступает
       * за блок на три миллиметра, и попадание в него читается как «взял книгу»,
       * а не как «промахнулся».
       */
      if (!point) return;
      if (Math.abs(point.x) > GUTTER + COVER_W || Math.abs(point.z) > COVER_H / 2) return;

      const plan = onStart(point.x >= 0 ? 1 : -1, true);
      if (!plan) return;

      drag.current = {
        // У самого корешка лист почти не двигается, и хват там вырождается:
        // деление на крошечное расстояние превращает дрожь руки в переворот.
        grip: Math.max(Math.abs(point.x), MIN_GRIP),
        from: plan.from,
        commitAt: plan.commitAt,
        time: performance.now(),
        moved: false,
      };
      if (controls) controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      event.stopPropagation();
    };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [controls, gl, onStart, pointerToBook, progressAt]);

  return null;
}
