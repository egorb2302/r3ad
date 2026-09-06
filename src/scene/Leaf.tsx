'use client';

/**
 * Переворачивающийся лист.
 *
 * Один меш на весь переворот: лицо и оборот — стороны одной геометрии, а не два
 * плоских прямоугольника. Иначе на просвет и на срезе видно, что «страница» —
 * это две наклейки, а вся затея как раз про то, что книга физична.
 *
 * Прогресс не проходит через React. Он живёт в изменяемом объекте (см. turn.ts),
 * useFrame читает его и пишет прямо в юниформы и в матрицы — шестьдесят раз в
 * секунду перерисовывать дерево компонентов ради одного числа незачем.
 *
 * Геометрия и материалы при этом объявлены разметкой, а не собраны руками:
 * созданием и уборкой ресурсов занимается R3F, а мы дотягиваемся до них через
 * ref только в кадре, когда рендер уже позади.
 */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { attachCurl, leafShadowTexture, makeCurlUniforms, type CurlUniforms } from './materials/pageCurl';
import { motion, stepMotion } from './turn';
import type { PaperTint } from '@/core/theme';
import { blankPage, blockThickness, COVER_T, GUTTER, TRIM_H, TRIM_W } from './geometry';

/** Полная длина листа от оси корешка до внешнего обреза. */
const REACH = GUTTER + TRIM_W;
/** Плоскость приходит центрированной; отсюда до корешка. */
const ORIGIN = GUTTER + TRIM_W / 2;

export interface LeafProps {
  /** Лицевая страница листа и его оборот. */
  front: THREE.Texture | null;
  back: THREE.Texture | null;
  /** Листов в стопках, между которыми идёт переворот. Сам лист не в счёт. */
  leftSheets: number;
  rightSheets: number;
  /**
   * Бумага тома: тон и плотность. Лист обязан быть из той же пачки, что стопки
   * под ним, — и по цвету, и по высоте, на которой он над ними висит.
   */
  tint: PaperTint;
  gsm: number;
  /** Пружина успокоилась: аргумент — на каком краю. */
  onSettled: (target: number) => void;
}

export function Leaf({ front, back, leftSheets, rightSheets, tint, gsm, onSettled }: LeafProps) {
  const group = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Group>(null);
  const shadowMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const uniforms = useRef<CurlUniforms | null>(null);

  // Врезка ставится один раз, после монтирования: до этого материала ещё нет.
  useEffect(() => {
    if (!material.current) return;
    const own = makeCurlUniforms(REACH, ORIGIN);
    uniforms.current = own;
    attachCurl(material.current, own);
  }, []);

  useFrame((_, delta) => {
    const own = uniforms.current;
    if (!own) return;

    // Оборот приезжает асинхронно и подставляется в кадре: лист может подняться
    // раньше, чем дорисуется его изнанка.
    own.uBackMap.value = back ?? blankPage(tint);

    const done = stepMotion(motion, delta);
    own.uT.value = motion.t;

    const left = blockThickness(leftSheets, gsm);
    const right = blockThickness(rightSheets, gsm);

    if (group.current) {
      /*
       * Высота оси переворота переезжает с одной стопки на другую. Без этого
       * лист в начале движения висел бы над правой страницей или, наоборот,
       * тонул в ней: стопки разной толщины, и разница доходит до сантиметра.
       */
      group.current.position.y = COVER_T + THREE.MathUtils.lerp(right, left, motion.t) + 0.006;
    }

    if (shadow.current && shadowMaterial.current) {
      const theta = motion.t * Math.PI;
      const overhang = Math.abs(Math.cos(theta));
      const opacity = Math.sin(theta) * overhang * 0.62;

      shadow.current.visible = opacity > 0.01;
      if (shadow.current.visible) {
        // Тень ложится на ту стопку, над которой лист сейчас нависает.
        const overRight = motion.t < 0.5;
        shadow.current.scale.x = overRight ? overhang : -overhang;
        shadow.current.position.y = COVER_T + (overRight ? right : left) + 0.005;
        shadowMaterial.current.opacity = opacity;
      }
    }

    /*
     * Об окончании сообщаем каждый кадр покоя, без флага «уже сообщали».
     * Флаг здесь опасен: цель листа может смениться после того, как пружина
     * один раз пришла в равновесие (палец успел отпустить страницу до первого
     * кадра), и защёлкнутый флаг навсегда оставил бы лист висеть в воздухе.
     * Идемпотентность обеспечивает endTurn — он смотрит, есть ли ещё что
     * заканчивать.
     */
    if (done) onSettled(motion.target);
  });

  return (
    <>
      {/* Тень масштабируется от корешка, поэтому живёт в группе с осью в нуле */}
      <group ref={shadow} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh position={[REACH / 2, 0, 0]} renderOrder={2}>
          <planeGeometry args={[REACH, TRIM_H]} />
          <meshBasicMaterial
            ref={shadowMaterial}
            map={leafShadowTexture()}
            color="#000000"
            transparent
            depthWrite={false}
          />
        </mesh>
      </group>

      {/*
        Меш стоит в нуле: сдвиг до корешка делает шейдер (uOrigin), иначе
        трансформация применилась бы дважды — и до изгиба, и после.
      */}
      <group ref={group} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh renderOrder={3}>
          <planeGeometry args={[TRIM_W, TRIM_H, 48, 10]} />
          <meshStandardMaterial
            ref={material}
            map={front ?? blankPage(tint)}
            side={THREE.DoubleSide}
            roughness={0.94}
            metalness={0}
          />
        </mesh>
      </group>
    </>
  );
}
