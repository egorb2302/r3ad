'use client';

/**
 * Переезд камеры между столом и стеллажом.
 *
 * Две сцены проекта — раскрытая книга и полка — живут в одном мире, на
 * расстоянии метра друг от друга, и переключение между ними это не смена
 * экрана, а поворот головы. Отсюда и способ: не два вьюпорта и не роутинг, а
 * один облёт камеры, во время которого видно и то, откуда уехали, и то, куда
 * приехали.
 *
 * Дистанция до стеллажа не константа: она считается из его габаритов и текущей
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
import { CASE_HEIGHT, CASE_WIDTH, CASE_Z } from '../bookcase/caseGeometry';
import { easeInOutCubic, flightFocus, flightPosition } from '../flight';

export type CameraView = 'desk' | 'case';

/** Сколько длится переезд. Совпадает с полётом книги: они идут вместе. */
const TRAVEL = 0.9;

/** Воздух вокруг стеллажа в кадре. */
const MARGIN = 8;

interface OrbitLike {
  enabled: boolean;
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
  update: () => void;
}

interface Shot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
}

/** Дистанция, с которой предмет заданных габаритов целиком влезает в кадр. */
function fitDistance(width: number, height: number, fovDeg: number, aspect: number): number {
  const half = Math.tan((fovDeg * Math.PI) / 360);
  return Math.max((height / 2 + MARGIN) / half, (width / 2 + MARGIN) / (half * aspect));
}

function shotFor(view: CameraView, fov: number, aspect: number): Shot {
  if (view === 'desk') {
    return {
      position: new THREE.Vector3(0, 42, 50),
      target: new THREE.Vector3(0, 1.2, 0),
      minDistance: 26,
      maxDistance: 150,
    };
  }

  const distance = fitDistance(CASE_WIDTH, CASE_HEIGHT, fov, aspect);

  return {
    position: new THREE.Vector3(0, CASE_HEIGHT / 2 + 4, CASE_Z + distance),
    target: new THREE.Vector3(0, CASE_HEIGHT / 2, CASE_Z),
    minDistance: 40,
    maxDistance: distance + 120,
  };
}

export function CameraRig({ view }: { view: CameraView }) {
  const store = useStore();

  const travel = useRef<{
    t: number;
    from: THREE.Vector3;
    fromTarget: THREE.Vector3;
    shot: Shot;
  } | null>(null);

  /** Куда камера смотрит по своему ракурсу, до поправки на летящую книгу. */
  const aim = useRef(new THREE.Vector3());
  const lastShot = useRef<Shot | null>(null);
  const following = useRef(false);

  useEffect(() => {
    const state = store.getState();
    const controls = state.controls as unknown as OrbitLike | null;
    if (!controls) return;

    const camera = state.camera as THREE.PerspectiveCamera;
    const next = shotFor(view, camera.fov, state.size.width / state.size.height);

    travel.current = {
      t: 0,
      from: camera.position.clone(),
      fromTarget: controls.target.clone(),
      shot: next,
    };
    lastShot.current = next;

    /*
     * Пределы приближения расширяются сразу, а не по приезде: стеллаж дальше
     * стола, и старый maxDistance зажал бы камеру на полпути.
     */
    controls.minDistance = Math.min(controls.minDistance, next.minDistance);
    controls.maxDistance = Math.max(controls.maxDistance, next.maxDistance);
    controls.enabled = false;
  }, [store, view]);

  useFrame((state, delta) => {
    const controls = state.controls as unknown as OrbitLike | null;
    if (!controls) return;

    const move = travel.current;
    const focus = flightFocus();
    if (!move && focus <= 0 && !following.current) return;

    /*
     * Положение камеры задаётся явно в каждом кадре, даже когда переезд уже
     * кончился. OrbitControls держат камеру на постоянном выносе от цели, и
     * стоит цели поехать за книгой, как за ней уедет и камера — кадр к концу
     * полёта оказывается совсем не тем, из которого начинали.
     */
    if (move) {
      move.t = Math.min(1, move.t + delta / TRAVEL);
      const k = easeInOutCubic(move.t);
      state.camera.position.lerpVectors(move.from, move.shot.position, k);
      aim.current.lerpVectors(move.fromTarget, move.shot.target, k);
    } else if (lastShot.current) {
      state.camera.position.copy(lastShot.current.position);
      aim.current.copy(lastShot.current.target);
    }

    /*
     * Поправка на книгу. Ракурс задаёт, куда камера смотрит вообще, а этот
     * сдвиг — то, что она провожает взглядом летящий том. Ноль на концах пути,
     * поэтому у полки и у стола кадр остаётся тем, каким его выбрали.
     */
    controls.target.lerpVectors(aim.current, flightPosition, focus);
    controls.update();

    if (move && move.t >= 1) {
      controls.minDistance = move.shot.minDistance;
      controls.maxDistance = move.shot.maxDistance;
      travel.current = null;
    }

    // Вращать сцену, пока камера ведёт книгу, нельзя: цель уходит из-под рук.
    following.current = focus > 0;
    controls.enabled = !travel.current && !following.current;
  });

  return null;
}
