'use client';

/**
 * Геометрия и материал закрытого тома.
 *
 * Том на полке — коробка с одной картой на все шесть граней, и разводит грани
 * не материал, а развёртка: лицевая грань берёт из клетки атласа напечатанный
 * корешок, крышки — точку с тканью, головка, хвост и передний обрез — точку с
 * бумагой. Шесть материалов на инстансированный меш повесить нельзя, а разные
 * грани нужны, — развёртка оказывается единственным местом, где это решается.
 *
 * Локальные оси тома: x — толщина, y — высота, z — глубина, корешок смотрит в
 * +z. Эта система координат общая для полки и для летящей книги, иначе том при
 * посадке разворачивался бы на месте.
 */
import * as THREE from 'three';
import { CLOTH_SWATCH, FACE_U, PAPER_SWATCH, spineAtlas } from './spineAtlas';

/**
 * Единичная коробка с развёрткой под клетку атласа.
 *
 * Отдаётся новой каждому вызову: инстансированному ряду нужны свои инстансные
 * атрибуты, а одиночному тому — чистая геометрия, и общий буфер здесь означал
 * бы, что одна сцена ломает другую.
 */
export function spineGeometry(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const uv = geometry.attributes.uv as THREE.BufferAttribute;

  // Порядок граней BoxGeometry: +x, -x, +y, -y, +z, -z, по четыре вершины.
  const swatch = (from: number, [u, v]: [number, number]) => {
    for (let i = from; i < from + 4; i++) uv.setXY(i, u, v);
  };

  swatch(0, CLOTH_SWATCH);
  swatch(4, CLOTH_SWATCH);
  swatch(8, PAPER_SWATCH);
  swatch(12, PAPER_SWATCH);
  swatch(20, PAPER_SWATCH);

  // Корешок: собственные координаты грани сжимаются в печатное поле клетки.
  for (let i = 16; i < 20; i++) {
    uv.setX(i, FACE_U[0] + uv.getX(i) * (FACE_U[1] - FACE_U[0]));
  }

  uv.needsUpdate = true;
  return geometry;
}

/**
 * Материал тома.
 *
 * Карта одна на всю библиотеку — сам атлас. Что именно достанется инстансу,
 * решает инстансный атрибут `aCell`: врезка в вершинный шейдер переносит
 * развёртку в нужную клетку. Без неё пришлось бы делать по материалу на книгу,
 * а это по drawcall'у на книгу.
 */
export function spineMaterial(instanced: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: instanced ? spineAtlas().texture : spineAtlas().texture.clone(),
    roughness: 0.78,
    metalness: 0.02,
  });

  if (!instanced) {
    // Одиночный том обходится штатным преобразованием карты: клетка задаётся
    // сдвигом и масштабом текстуры, шейдер трогать незачем.
    material.map!.needsUpdate = true;
    return material;
  }

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = ['attribute vec4 aCell;', 'attribute float aTint;', 'varying float vTint;', '']
      .join('\n')
      .concat(shader.vertexShader);

    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      ['#include <uv_vertex>', 'vMapUv = aCell.xy + vMapUv * aCell.zw;', 'vTint = aTint;'].join('\n'),
    );

    shader.fragmentShader = 'varying float vTint;\n'.concat(shader.fragmentShader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      ['#include <map_fragment>', 'diffuseColor.rgb *= 1.0 + vTint * 0.42;'].join('\n'),
    );
  };

  material.customProgramCacheKey = () => 'r3ad-spine-instanced';
  return material;
}
