'use client';

/**
 * Изгиб страницы: цилиндрическая деформация плюс поворот вокруг корешка
 * (SPEC §7.2).
 *
 * Сделано врезкой в MeshStandardMaterial, а не отдельным ShaderMaterial. Причина
 * в свете: сцена освещена картой окружения и двумя источниками, и лист,
 * написанный с нуля, выпал бы из неё плоским прямоугольником — заметно сильнее,
 * чем любая неточность изгиба. Врезка сохраняет весь конвейер освещения three и
 * подменяет ровно две вещи: положение вершины и её нормаль.
 *
 * Нормаль считается аналитически, а не по соседним вершинам. Изгиб здесь —
 * цилиндр, у него нормаль известна в замкнутом виде: (-sin a, 0, cos a). Это и
 * точнее численной оценки, и дешевле.
 */
import * as THREE from 'three';

export interface CurlUniforms {
  /** Прогресс переворота: 0 — лист лежит справа, 1 — слева. */
  uT: { value: number };
  /** Радиус изгиба в середине переворота, в единицах сцены. Меньше — круче загиб. */
  uCurl: { value: number };
  uFlutter: { value: number };
  /**
   * Сдвиг от центра геометрии до оси корешка. Плоскость приходит из R3F
   * центрированной, а изгиб и поворот считаются от корешка, поэтому смещение
   * живёт в шейдере: трогать саму геометрию значило бы делать это в обход
   * декларативного дерева сцены.
   */
  uOrigin: { value: number };
  /** Длина листа от корешка до внешнего обреза — по ней нормируется трепет. */
  uWidth: { value: number };
  /** Оборотная сторона. */
  uBackMap: { value: THREE.Texture | null };
  /** Просвет: сколько оборота видно сквозь бумагу. */
  uBleed: { value: number };
}

export function makeCurlUniforms(width: number, origin: number): CurlUniforms {
  return {
    uT: { value: 0 },
    uCurl: { value: 18 },
    uFlutter: { value: 0.22 },
    uOrigin: { value: origin },
    uWidth: { value: width },
    uBackMap: { value: null },
    uBleed: { value: 0.07 },
  };
}

const CURL_GLSL = /* glsl */ `
uniform float uT;
uniform float uCurl;
uniform float uFlutter;
uniform float uOrigin;
uniform float uWidth;

/** В покое лист почти плоский: радиус в десятки метров вместо бесконечности. */
const float R_FLAT = 400.0;
const float PI_ = 3.14159265359;

void curlFrame(in vec3 p, out vec3 outPos, out vec3 outNormal) {
  // x отсчитывается от корешка, а не от центра листа.
  float x = p.x + uOrigin;

  // Изгиб появляется и исчезает вместе с переворотом: в начале и в конце лист
  // лежит плоско, максимум приходится на вертикальное положение.
  float bend = sin(uT * PI_);
  float r = mix(R_FLAT, uCurl, bend);
  float a = x / r;

  vec3 q = vec3(r * sin(a), p.y, r * (1.0 - cos(a)));

  // Трепет: тем сильнее, чем дальше от корешка и ближе к середине переворота.
  q.z += uFlutter * sin(p.y * 3.0 + uT * 8.0) * (x / max(uWidth, 0.001)) * bend;

  // Поворот вокруг корешка — оси Y, проходящей через x = 0.
  float theta = uT * PI_;
  float c = cos(theta);
  float s = sin(theta);

  outPos = vec3(q.x * c - q.z * s, q.y, q.x * s + q.z * c);

  // Нормаль цилиндра, повёрнутая тем же преобразованием. Вклад трепета в неё
  // сознательно опущен: амплитуда порядка миллиметра, а производная от синуса
  // добавила бы заметную рябь на свету там, где её нет в геометрии.
  vec3 n = vec3(-sin(a), 0.0, cos(a));
  outNormal = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
}
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D uBackMap;
uniform float uBleed;
`;

/**
 * Лицо и оборот на одной геометрии.
 *
 * gl_FrontFacing разводит стороны, оборот зеркалится по горизонтали: край у
 * корешка физически один и тот же, а на текстуре оборотной страницы он справа —
 * там у неё внутреннее поле.
 */
const FACE_GLSL = /* glsl */ `
vec4 frontTexel = texture2D( map, vMapUv );
vec4 backTexel = texture2D( uBackMap, vec2( 1.0 - vMapUv.x, vMapUv.y ) );
vec4 face = gl_FrontFacing ? frontTexel : backTexel;
vec4 other = gl_FrontFacing ? backTexel : frontTexel;
// Просвет: бумага не непрозрачна, на просвет проступает оборот.
face.rgb = mix( face.rgb, other.rgb, uBleed );
diffuseColor *= face;
`;

/** Врезать изгиб в готовый материал. Вызывается один раз, в эффекте. */
export function attachCurl(material: THREE.MeshStandardMaterial, uniforms: CurlUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = CURL_GLSL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      [
        'vec3 curlPos;',
        'vec3 curlNormal;',
        'curlFrame( position, curlPos, curlNormal );',
        'vec3 objectNormal = curlNormal;',
      ].join('\n'),
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      'vec3 transformed = curlPos;',
    );

    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', FACE_GLSL);
  };

  // Врезка одна и та же для всех экземпляров — иначе three пересобирал бы
  // программу на каждый материал заново.
  material.customProgramCacheKey = () => 'r3ad-page-curl';
  material.needsUpdate = true;
}

/**
 * Мягкая тень от поднятого листа.
 *
 * Не shadow map: единственная тень, которую здесь видно, — контактная, у
 * корешка, и она дешевле рисуется градиентом. Насыщенность максимальна у сгиба
 * и сходит на нет к внешнему краю — так же, как у настоящей страницы.
 */
let shadowTexture: THREE.CanvasTexture | null = null;

export function leafShadowTexture(): THREE.CanvasTexture {
  if (shadowTexture) return shadowTexture;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.32)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Смягчение к верхнему и нижнему обрезу: тень не обрывается прямой линией.
  const fade = ctx.createLinearGradient(0, 0, 0, size);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.14, 'rgba(0,0,0,1)');
  fade.addColorStop(0.86, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);

  shadowTexture = new THREE.CanvasTexture(canvas);
  shadowTexture.colorSpace = THREE.SRGBColorSpace;
  return shadowTexture;
}
