'use client';

/**
 * Переезд камеры между столом, стеллажом и страницей тетради.
 *
 * Три места проекта — раскрытая книга, полка и страница под пером — живут в
 * одном мире, и переключение между ними это не смена экрана, а поворот головы.
 * Отсюда и способ: не три вьюпорта и не роутинг, а один облёт камеры, во время
 * которого видно и то, откуда уехали, и то, куда приехали.
 *
 * Дистанция не константа: она считается из габаритов предмета и текущей
 * пропорции окна, иначе на широком мониторе полка тонет в пустоте, а на узком
 * не влезает по краям.
 *
 * Камера и OrbitControls берутся из стора R3F вызовом, а не хуком. Их
 * приходится менять на месте — иначе никакого переезда и не выйдет, — а
 * значения, пришедшие из хука, менять нельзя: правило React Compiler про
 * неизменяемость распространяется и на эффекты.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useStore } from '@react-three/fiber';
import * as THREE from 'three';
import { CASE_HEIGHT, CASE_WIDTH, CASE_X, CASE_Y, CASE_Z, FLOOR_Y } from '../bookcase/caseGeometry';
import { WALL_X, WALL_Z } from '../room/decor';
import { COVER_H, COVER_W, GUTTER, TRIM_H, TRIM_W } from '../geometry';
import { easeInOutCubic } from '../flight';
import { flightFocus, flightPosition } from '../route';
import { span } from '../motionPrefs';

export type CameraView = 'desk' | 'case' | 'flat';

/** Сколько длится переезд между столом и полкой. Совпадает с полётом книги. */
const TRAVEL = 0.9;

/** Сколько длится наклон к тетради. Величина из SPEC §9.1. */
const LEAN = 0.35;

/** Воздух вокруг предмета в кадре, в сантиметрах. */
const MARGIN = 8;
const PAGE_MARGIN = 1.4;

interface OrbitLike {
  enabled: boolean;
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
  minAzimuthAngle: number;
  maxAzimuthAngle: number;
  update: () => void;
}

interface Shot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /**
   * Верх кадра в мире.
   *
   * У стола и полки это просто «вверх», а над страницей вертикаль экрана — это
   * глубина сцены: камера смотрит вниз, и головка страницы оказывается от
   * читателя, то есть в −z.
   */
  up: THREE.Vector3;
  /** Свободен ли ракурс: у стола и полки его крутит мышь, над страницей — нет. */
  free: boolean;
  minDistance: number;
  maxDistance: number;
  /**
   * Пределы поворота вокруг цели, в радианах от «спереди».
   *
   * У комнаты есть стены, и облёт, который в пустоте был безобиден, теперь
   * уводит камеру сквозь них: за стеллаж, за стену, под пол. Пределы считаются
   * от расстояния, на котором камера встаёт по приезде, — вращают обычно с
   * него.
   */
  azimuth: [number, number];
}

/** Дистанция, с которой предмет заданных габаритов целиком влезает в кадр. */
function fitDistance(
  width: number,
  height: number,
  fovDeg: number,
  aspect: number,
  margin: number,
): number {
  const half = Math.tan((fovDeg * Math.PI) / 360);
  return Math.max((height / 2 + margin) / half, (width / 2 + margin) / (half * aspect));
}

const UP = new THREE.Vector3(0, 1, 0);

/** Воздух между камерой и стеной или полом: ближе камера в комнате не бывает. */
const AIR = 12;

/** Без пределов: пока камера едет, её ведут руками, и зажимать нечего. */
const FREE_AZIMUTH: [number, number] = [-Infinity, Infinity];

/**
 * Не выпускать камеру из комнаты.
 *
 * Пределы поворота — первая линия: они не дают камере разогнаться к стене.
 * Но они считаются на одном расстоянии, а колесо мыши меняет его, и с
 * дальней дистанции даже разрешённый угол выводит за стену. Поэтому положение
 * ещё и зажимается коробкой комнаты — на каждом кадре, после того как своё
 * слово сказали OrbitControls. Взгляд после сдвига наводится на цель заново:
 * иначе камера, прижатая к стене, смотрела бы туда, куда смотрела до сдвига.
 */
function keepInRoom(camera: THREE.Camera, controls: OrbitLike) {
  const p = camera.position;
  const x = THREE.MathUtils.clamp(p.x, -WALL_X + AIR, WALL_X - AIR);
  const y = Math.max(p.y, FLOOR_Y + AIR);
  const z = Math.max(p.z, WALL_Z + AIR);
  if (x === p.x && y === p.y && z === p.z) return;
  p.set(x, y, z);
  camera.lookAt(controls.target);
}

/** Ширина раскрытой книги от обреза до обреза. */
const SPREAD_WIDTH = 2 * (GUTTER + COVER_W);

/** Ракурс стола: куда смотрим, откуда и с какого расстояния на широком экране. */
const DESK_TARGET = new THREE.Vector3(0, 1.2, 0);
const DESK_DIRECTION = new THREE.Vector3(0, 31.2, 50).normalize();
const DESK_DISTANCE = 64.6;
/** Высота глаз стоящего человека, в координатах сцены: 60 см над столом. */
const CASE_EYE = 60;
/** Верх страницы в плоском режиме: от читателя. */
const PAGE_UP = new THREE.Vector3(0, 0, -1);

export interface FlatFocus {
  /** Центр страницы на столе. */
  x: number;
  y: number;
}

function shotFor(view: CameraView, flat: FlatFocus | null, fov: number, aspect: number): Shot {
  if (view === 'flat' && flat) {
    const distance = fitDistance(TRIM_W, TRIM_H, fov, aspect, PAGE_MARGIN);
    return {
      position: new THREE.Vector3(flat.x, flat.y + distance, 0),
      target: new THREE.Vector3(flat.x, flat.y, 0),
      up: PAGE_UP,
      free: false,
      minDistance: distance,
      maxDistance: distance,
      azimuth: FREE_AZIMUTH,
    };
  }

  /*
   * Полка. Стеллаж стоит на полу рядом со столом, и с высоты сидящего его
   * нижние ряды ушли бы под край кадра. Поэтому на стеллаж смотрят стоя:
   * камера поднята на высоту глаз человека, вставшего из-за стола. Цель —
   * середина стеллажа, наклон получается сам.
   */
  if (view === 'case') {
    const distance = fitDistance(CASE_WIDTH, CASE_HEIGHT, fov, aspect, MARGIN);
    /*
     * Стеллаж стоит у левой стены, и влево камере почти некуда: до стены
     * полметра. Вправо — вся комната. Предел с каждой стороны — тот угол, на
     * котором камера с этого расстояния упрётся в стену; вправо ещё и не
     * дальше ~65°, иначе полку видно только сбоку.
     */
    const left = Math.asin(Math.min(1, (CASE_X + WALL_X - AIR) / distance));
    const right = Math.asin(Math.min(1, (WALL_X - CASE_X - AIR) / distance));
    return {
      position: new THREE.Vector3(CASE_X, CASE_EYE, CASE_Z + distance),
      target: new THREE.Vector3(CASE_X, CASE_Y + CASE_HEIGHT / 2, CASE_Z),
      up: UP,
      free: true,
      minDistance: 40,
      maxDistance: distance + 60,
      azimuth: [-left, Math.min(right, 1.15)],
    };
  }

  /*
   * Стол. Направление взгляда постоянное — это выбранный ракурс, — а вот
   * расстояние подбирается под окно, как и у полки.
   *
   * До M7 оно было константой, и на узком экране разворот вылезал за края:
   * тридцать сантиметров книги в портретном окне не помещаются ни при какой
   * высоте. Отступаем ровно настолько, чтобы поместились, и ни на сантиметр
   * дальше — на широком мониторе кадр остался тем же, каким был.
   *
   * Глубину берём с поправкой на наклон: книга лежит, камера смотрит на неё
   * под сорок градусов, и на экране её высота — не 21 сантиметр, а проекция.
   */
  const fit = fitDistance(SPREAD_WIDTH, COVER_H * 0.62, fov, aspect, 2);
  const distance = Math.max(DESK_DISTANCE, fit);

  return {
    position: DESK_TARGET.clone().addScaledVector(DESK_DIRECTION, distance),
    target: DESK_TARGET.clone(),
    up: UP,
    free: true,
    minDistance: 26,
    maxDistance: Math.max(150, distance + 40),
    // Почти кругом: стена за столом далеко, и заглянуть на книгу «от окна» можно.
    azimuth: [-1.9, 1.9],
  };
}

export function CameraRig({ view, flat }: { view: CameraView; flat: FlatFocus | null }) {
  const store = useStore();

  const travel = useRef<{
    t: number;
    span: number;
    from: THREE.Vector3;
    fromTarget: THREE.Vector3;
    fromUp: THREE.Vector3;
    fromFree: boolean;
    shot: Shot;
  } | null>(null);

  /** Куда камера смотрит по своему ракурсу, до поправки на летящую книгу. */
  const aim = useRef(new THREE.Vector3());
  const up = useRef(new THREE.Vector3(0, 1, 0));
  const lastShot = useRef<Shot | null>(null);
  const following = useRef(false);

  const flatX = flat?.x ?? 0;
  const flatY = flat?.y ?? 0;

  /*
   * Ракурс назначается независимо от того, готовы ли уже OrbitControls.
   *
   * Стойка объявлена в сцене раньше самих контролов, а эффекты выполняются в
   * порядке дерева, — значит, на первом монтировании `state.controls` ещё пуст.
   * Пока этот эффект на этом заканчивался, первый ракурс доезжал только в том
   * случае, если потом менялся: полка, открытая по ссылке `?s=`, приходит в
   * состояние «смотрим на стеллаж» до первого кадра, менять его больше некому —
   * и камера так и оставалась над пустым столом.
   *
   * Поэтому здесь считается и запоминается только сам переезд; контролов он не
   * касается. Всё, что нужно им, делает кадровый цикл, где они уже есть.
   */
  useEffect(() => {
    const state = store.getState();
    const controls = state.controls as unknown as OrbitLike | null;

    const camera = state.camera as THREE.PerspectiveCamera;
    const next = shotFor(
      view,
      view === 'flat' ? { x: flatX, y: flatY } : null,
      camera.fov,
      state.size.width / state.size.height,
    );

    const previous = lastShot.current;
    travel.current = {
      t: 0,
      // Наклон к тетради короче переезда: это движение головы, а не переход.
      span: span(view === 'flat' || previous?.free === false ? LEAN : TRAVEL),
      from: camera.position.clone(),
      fromTarget: controls ? controls.target.clone() : new THREE.Vector3(),
      fromUp: camera.up.clone(),
      fromFree: previous?.free ?? true,
      shot: next,
    };
    lastShot.current = next;

    if (controls) {
      controls.enabled = false;
      [controls.minAzimuthAngle, controls.maxAzimuthAngle] = FREE_AZIMUTH;
    }
  }, [store, view, flatX, flatY]);

  useFrame((state, delta) => {
    const controls = state.controls as unknown as OrbitLike | null;
    if (!controls) return;

    const move = travel.current;
    const shot = move ? move.shot : lastShot.current;
    const focus = flightFocus();
    const pinned = shot ? !shot.free : false;

    // Свободный облёт: единственное, что здесь нужно, — не выпустить из комнаты.
    if (!move && !pinned && focus <= 0) keepInRoom(state.camera, controls);

    if (!move && focus <= 0 && !following.current && !pinned) return;

    /*
     * Пока камера едет, просим следующий кадр сами: рендер-луп работает по
     * требованию (см. Viewport), и переезд, начатый одним кадром, без этого
     * замер бы на первом же его шаге.
     */
    if (move || focus > 0) state.invalidate();

    /*
     * Положение камеры задаётся явно в каждом кадре, даже когда переезд уже
     * кончился. OrbitControls держат камеру на постоянном выносе от цели, и
     * стоит цели поехать за книгой, как за ней уедет и камера — кадр к концу
     * полёта оказывается совсем не тем, из которого начинали.
     */
    if (move) {
      /*
       * Пределы приближения расширяются на время переезда, а не по приезде:
       * стеллаж дальше стола, и старый maxDistance зажал бы камеру на полпути.
       * Каждый кадр — потому что в момент назначения ракурса контролов может
       * ещё не быть (см. эффект выше).
       */
      controls.minDistance = Math.min(controls.minDistance, move.shot.minDistance);
      controls.maxDistance = Math.max(controls.maxDistance, move.shot.maxDistance);

      move.t = Math.min(1, move.t + delta / move.span);
      const k = easeInOutCubic(move.t);
      state.camera.position.lerpVectors(move.from, move.shot.position, k);
      aim.current.lerpVectors(move.fromTarget, move.shot.target, k);
      up.current.lerpVectors(move.fromUp, move.shot.up, k).normalize();
    } else if (shot) {
      state.camera.position.copy(shot.position);
      aim.current.copy(shot.target);
      up.current.copy(shot.up);
    }

    /*
     * Над страницей ракурс ведём сами. OrbitControls восстанавливают положение
     * камеры из сферических координат вокруг цели, а прямо сверху сфера
     * вырождается — и они же не дают камере встать вертикально, у полярного
     * угла есть предел. Пока камера лежит над тетрадью, они молчат.
     */
    const manual = move ? !(move.shot.free && move.fromFree) : pinned;

    if (manual) {
      state.camera.up.copy(up.current);
      state.camera.lookAt(aim.current);
      controls.target.copy(aim.current);
    } else {
      /*
       * Поправка на книгу. Ракурс задаёт, куда камера смотрит вообще, а этот
       * сдвиг — то, что она провожает взглядом летящий том. Ноль на концах
       * пути, поэтому у полки и у стола кадр остаётся тем, каким его выбрали.
       */
      state.camera.up.copy(UP);
      controls.target.lerpVectors(aim.current, flightPosition, focus);
      controls.update();
    }

    if (move && move.t >= 1) {
      controls.minDistance = move.shot.minDistance;
      controls.maxDistance = move.shot.maxDistance;
      [controls.minAzimuthAngle, controls.maxAzimuthAngle] = move.shot.azimuth;
      travel.current = null;
    }

    // Вращать сцену, пока камера ведёт книгу или лежит над страницей, нельзя.
    following.current = focus > 0;
    controls.enabled = !travel.current && !following.current && !pinned;
  });

  return null;
}
