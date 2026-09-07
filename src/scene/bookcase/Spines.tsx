'use client';

/**
 * Ряд корешков.
 *
 * Один InstancedMesh на всю библиотеку: сорок книг стоят одного drawcall'а, и
 * это единственный способ уложиться в бюджет стеллажа (SPEC §16). Всё, чем тома
 * различаются, приезжает инстансными данными — матрица даёт толщину, положение
 * и завал, атрибут `aCell` показывает, в какой клетке атласа напечатан именно
 * этот корешок.
 *
 * Матрицы переписываются каждый кадр, а не по изменению состояния: наведение,
 * наклон и перетаскивание — это анимации, и гнать их через React означало бы
 * шестьдесят реконсиляций в секунду ради сорока чисел.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useStore, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Placement } from '@/core/library/shelfLayout';
import type { VolumeRecord } from '@/core/library/volume';
import { CASE, SHELF_BOOK_Z, SHELF_LEFT, shelfSurfaceY } from './caseGeometry';
import { composeShelfPose, volumeScale } from './pose';
import { spineAtlas } from './spineAtlas';
import { spineResources } from './spineInstances';
import { SPINE_CAPACITY } from './atlasGrid';

/** Дальше этого сдвига нажатие считается перетаскиванием, а не щелчком. */
const DRAG_SLOP = 0.7;

/** Насколько перетаскиваемый том приподнят над полкой. */
const DRAG_LIFT = 1.4;

const scratch = {
  matrix: new THREE.Matrix4(),
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  ndc: new THREE.Vector2(),
  hit: new THREE.Vector3(),
  raycaster: new THREE.Raycaster(),
  plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -SHELF_BOOK_Z),
};

/** Вращение камеры на время перетаскивания корешка выключается. */
function setOrbit(store: { getState: () => { controls: unknown } }, enabled: boolean) {
  const controls = store.getState().controls as { enabled: boolean } | null;
  if (controls) controls.enabled = enabled;
}

interface AnimState {
  hover: number;
  arm: number;
}

interface DragState {
  id: string;
  /** Мировая координата корешка под пальцем. */
  x: number;
  startX: number;
  moved: boolean;
}

export interface SpinesProps {
  volumes: Map<string, VolumeRecord>;
  placements: Placement[];
  hovered: string | null;
  armed: string | null;
  /** Том, которого сейчас нет на полке: он в полёте или лежит на столе. */
  hidden: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onReorder: (id: string, toIndex: number) => void;
}

export function Spines({
  volumes,
  placements,
  hovered,
  armed,
  hidden,
  onHover,
  onSelect,
  onReorder,
}: SpinesProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const anim = useRef(new Map<string, AnimState>());
  const drag = useRef<DragState | null>(null);
  /**
   * Состав ряда сменился — габаритную сферу надо пересчитать.
   *
   * Отрисовке она больше не нужна (ряд не отсекается), но по ней отсекает
   * попадания `raycast`: посчитанная один раз на пустом ряду, она оставила бы
   * корешки и без наведения, и без щелчка. Пересчёт стоит перебора матриц, а
   * не кадра, поэтому делается по изменению ряда, а не каждый кадр — подъём
   * корешка под курсором в неё и так укладывается.
   */
  const remeasure = useRef(true);

  /*
   * Камера, холст и OrbitControls берутся из стора R3F вызовом, а не хуком:
   * ими приходится управлять на месте — гасить вращение на время
   * перетаскивания, — а значения из хуков менять нельзя.
   */
  const store = useStore();

  const visible = useMemo(
    () => placements.filter((p) => p.id !== hidden),
    [placements, hidden],
  );

  // Клетки атласа переписываются только когда меняется состав ряда или толщина
  // тома: рисование корешка — не кадровая работа.
  useEffect(() => {
    const { cells } = spineResources();
    for (let i = 0; i < visible.length; i++) {
      const volume = volumes.get(visible[i].id);
      if (!volume) continue;
      const cell = spineAtlas().cellFor(volume, visible[i].thickness);
      cells.setXYZW(i, cell.u0, cell.v0, cell.du, cell.dv);
    }
    cells.needsUpdate = true;
    remeasure.current = true;
    /*
     * Кадр приходится просить самим. Атлас и клетки — это буферы и холст, а не
     * свойства элемента: R3F о такой правке не знает и луп, работающий по
     * требованию, из-за неё не проснётся. Книга, добавленная в библиотеку,
     * оставалась бы ненапечатанной до первого движения мышью.
     */
    store.getState().invalidate();
  }, [store, visible, volumes]);

  useFrame((frame, delta) => {
    const node = mesh.current;
    if (!node) return;

    const { tints } = spineResources();
    const held = drag.current;
    const dt = Math.min(delta, 1 / 30);

    // Подъём корешка под курсором доезжает затуханием, а кадры выдаются по
    // требованию (см. Viewport): пока хоть один том не доехал, просим ещё.
    let settling = false;

    for (let i = 0; i < visible.length; i++) {
      const placement = visible[i];
      const state = anim.current.get(placement.id) ?? { hover: 0, arm: 0 };

      const wantHover = placement.id === hovered || placement.id === held?.id ? 1 : 0;
      const wantArm = placement.id === armed ? 1 : 0;
      state.hover = THREE.MathUtils.damp(state.hover, wantHover, 14, dt);
      state.arm = THREE.MathUtils.damp(state.arm, wantArm, 11, dt);
      anim.current.set(placement.id, state);
      if (Math.abs(state.hover - wantHover) > 0.002 || Math.abs(state.arm - wantArm) > 0.002) {
        settling = true;
      }

      composeShelfPose(placement, state.hover, state.arm, scratch.position, scratch.quaternion);

      // Том под пальцем идёт за курсором и приподнят: иначе непонятно, что его
      // именно несут, а не двигают вместе с рядом.
      if (held?.id === placement.id && held.moved) {
        scratch.position.x = held.x;
        scratch.position.y += DRAG_LIFT;
      }

      volumeScale(placement.thickness, scratch.scale);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      node.setMatrixAt(i, scratch.matrix);
      tints.setX(i, state.hover * 0.5 + state.arm * 0.5);
    }

    node.count = visible.length;
    node.instanceMatrix.needsUpdate = true;
    tints.needsUpdate = true;

    if (remeasure.current) {
      node.computeBoundingSphere();
      remeasure.current = false;
    }

    if (settling || held) frame.invalidate();
  });

  /** Точка на плоскости ряда под курсором. */
  const pointerToShelf = useCallback(
    (clientX: number, clientY: number): THREE.Vector3 | null => {
      const { camera, gl } = store.getState();
      const rect = gl.domElement.getBoundingClientRect();
      scratch.ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      scratch.raycaster.setFromCamera(scratch.ndc, camera);
      return scratch.raycaster.ray.intersectPlane(scratch.plane, scratch.hit) ? scratch.hit : null;
    },
    [store],
  );

  /** Полка, над которой сейчас курсор. */
  const shelfAt = useCallback((y: number) => {
    for (let s = 0; s < CASE.shelves; s++) {
      const surface = shelfSurfaceY(s);
      if (y >= surface - CASE.board && y < surface + CASE.clearance) return s;
    }
    return y > shelfSurfaceY(0) ? 0 : CASE.shelves - 1;
  }, []);

  /**
   * Куда встанет том, если отпустить здесь.
   *
   * Считаем по всему ряду, а не по одной полке: полки — это продолжение одного
   * списка, и перенос книги вниз ничем не отличается от переноса вправо.
   */
  const indexAt = useCallback(
    (id: string, shelf: number, x: number) => {
      let index = 0;
      for (const placement of placements) {
        if (placement.id === id) continue;
        const before =
          placement.shelf < shelf || (placement.shelf === shelf && SHELF_LEFT + placement.x < x);
        if (!before) break;
        index += 1;
      }
      return index;
    },
    [placements],
  );

  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (event.button !== 0 || event.instanceId === undefined) return;
      const placement = visible[event.instanceId];
      if (!placement) return;

      const point = pointerToShelf(event.clientX, event.clientY);
      if (!point) return;

      event.stopPropagation();
      drag.current = { id: placement.id, x: point.x, startX: point.x, moved: false };
      setOrbit(store, false);
    },
    [pointerToShelf, store, visible],
  );

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (drag.current || event.instanceId === undefined) return;
      const placement = visible[event.instanceId];
      if (placement) onHover(placement.id);
    },
    [onHover, visible],
  );

  const onPointerOut = useCallback(() => {
    if (!drag.current) onHover(null);
  }, [onHover]);

  /*
   * Движение и отпускание слушаются на окне: перетаскивание почти всегда уводит
   * курсор с корешка, а события меша до него уже не долетают. Та же причина, по
   * которой так сделан перелистывающий drag.
   */
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const held = drag.current;
      if (!held) return;

      const point = pointerToShelf(event.clientX, event.clientY);
      if (!point) return;

      held.x = point.x;
      if (Math.abs(point.x - held.startX) > DRAG_SLOP) held.moved = true;
      if (!held.moved) return;

      // Перестановка происходит на ходу, а не по отпусканию: ряд расступается
      // под книгой, и видно, куда она встанет.
      onReorder(held.id, indexAt(held.id, shelfAt(point.y), point.x));
    };

    const up = () => {
      const held = drag.current;
      drag.current = null;
      setOrbit(store, true);
      if (!held) return;
      if (!held.moved) onSelect(held.id);
    };

    /*
     * Уход фокуса — не выбор. Нажатие без протяжки наклоняет том наружу, а
     * второе такое же вытаскивает его с полки, и делать это за человека потому,
     * что поверх окна открылся системный диалог, нельзя. Всё, что нужно, —
     * перестать держать.
     */
    const leave = () => {
      drag.current = null;
      setOrbit(store, true);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    /*
     * Потеря фокуса считается отпусканием. Иначе окно, уведённое системным
     * диалогом посреди перетаскивания, оставляло бы корешок зажатым: ряд
     * продолжал бы расступаться под курсором, а камера — не вращаться, потому
     * что орбиту возвращает как раз отпускание.
     */
    window.addEventListener('blur', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', leave);
    };
  }, [indexAt, onReorder, onSelect, pointerToShelf, shelfAt, store]);

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, SPINE_CAPACITY]}
      /*
       * Ряд не отсекается по пирамиде видимости, и это не оптимизация наоборот.
       * Габаритная сфера инстансированного меша считается один раз — при первом
       * отсечении — и больше не пересчитывается, сколько потом ни переписывай
       * матрицы. Считается она, стало быть, на пустом ряду: библиотека приезжает
       * из IndexedDB позже первого кадра, count тогда ноль, и сфера выходит
       * пустой — с центром в нуле сцены и отрицательным радиусом. Дальше ряд
       * виден ровно тогда, когда в кадр попадает начало координат, то есть книга
       * на столе: у стеллажа корешки пропадали и появлялись от поворота камеры.
       * Пересчитывать сферу каждый кадр незачем — весь ряд это один вызов
       * отрисовки, и отсекать в нём нечего.
       */
      frustumCulled={false}
      castShadow
      receiveShadow
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
    >
      <primitive object={spineResources().geometry} attach="geometry" />
      <primitive object={spineResources().material} attach="material" />
    </instancedMesh>
  );
}
