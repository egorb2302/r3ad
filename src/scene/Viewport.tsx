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
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Book } from './Book';
import { Leaf } from './Leaf';
import { COVER_H, COVER_T, COVER_W, GUTTER, TRIM_W } from './geometry';
import { MAX_SPEED, motion, planTurn, releaseTarget, resetMotion, type TurnPlan } from './turn';
import { useBook } from '@/store/useBook';
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

export function Viewport() {
  const pagination = useBook((s) => s.pagination);
  const currentSheet = useBook((s) => s.currentSheet);
  const turn = useBook((s) => s.turn);
  const turnRequest = useBook((s) => s.turnRequest);
  const setTurn = useBook((s) => s.setTurn);
  const endTurn = useBook((s) => s.endTurn);

  const pages = usePageTextures();

  const sheets = pagination?.sheetCount ?? 1;
  const pageCount = pagination?.pageCount ?? 0;

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
  const view = turn
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
    const base = turn ? turn.a : currentSheet;
    return request(
      [view.leftPage, view.rightPage, view.front, view.back],
      // Соседние развороты готовим в простое: листание не должно ждать растр.
      [page(2 * base + 1), page(2 * base + 2), page(2 * base - 2), page(2 * base - 3)],
    );
  }, [
    request,
    page,
    turn,
    currentSheet,
    view.leftPage,
    view.rightPage,
    view.front,
    view.back,
  ]);

  const startTurn = useCallback(
    (dir: 1 | -1, dragging: boolean): TurnPlan | null => {
      const state = useBook.getState();
      const plan = planTurn(state.currentSheet, state.pagination?.sheetCount ?? 1, dir);
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

  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ position: [0, 42, 50], fov: 30, near: 0.5, far: 500 }}
    >
      <color attach="background" args={['#14100d']} />
      <fog attach="fog" args={['#14100d', 90, 240]} />

      <ambientLight intensity={0.5} color="#ffeedd" />

      {/* Настольная лампа слева-сверху — отсюда основная светотень на обрезе */}
      <directionalLight position={[-26, 40, 20]} intensity={2.1} color="#ffd9a8" />
      {/* Холодная подсветка справа, чтобы тени не проваливались в чёрное */}
      <directionalLight position={[30, 24, -18]} intensity={0.45} color="#8fb2d8" />

      {/*
        Собственная граница Suspense. Environment подвешивается, пока собирает
        карту окружения, и без этой границы вместе с ним подвисает вся сцена —
        включая книгу и хук, который заказывает текстуры страниц.
      */}
      <Suspense fallback={null}>
        <Environment resolution={256}>
          <Lightformer intensity={2.4} position={[-10, 12, 6]} scale={[14, 14, 1]} color="#ffe2bb" />
          <Lightformer intensity={0.8} position={[12, 8, -8]} scale={[10, 10, 1]} color="#a9c6e8" />
          <Lightformer intensity={0.5} form="ring" position={[0, 16, 0]} scale={[20, 20, 1]} />
        </Environment>
      </Suspense>

      <Desk />

      <Book
        leftSheets={view.leftSheets}
        rightSheets={view.rightSheets}
        leftPage={pages.get(view.leftPage)}
        rightPage={pages.get(view.rightPage)}
      />

      {turn ? (
        <Leaf
          key={`${turn.a}-${turn.from}`}
          front={pages.get(view.front)}
          back={pages.get(view.back)}
          leftSheets={view.leftSheets}
          rightSheets={view.rightSheets}
          onSettled={onSettled}
        />
      ) : null}

      <TurnInput onStart={startTurn} />

      <ContactShadows
        position={[0, 0.003, 0]}
        opacity={0.55}
        scale={80}
        blur={2.4}
        far={8}
        resolution={512}
        color="#000000"
      />

      <OrbitControls
        makeDefault
        target={[0, 1.2, 0]}
        enablePan={false}
        minDistance={26}
        maxDistance={150}
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
