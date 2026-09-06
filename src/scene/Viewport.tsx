'use client';

/**
 * Вьюпорт: сцена, свет, камера.
 *
 * Два решения по итогам M0:
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
 * — Никаких карт теней. Единственная тень, которая тут действительно нужна, —
 *   контактная под книгой; ContactShadows даёт её дешевле, чем полноценный
 *   shadow map на 2048². Самозатенение блока вернём при полировке (M7).
 *
 * Свет собирается из Lightformer'ов, а не из HDRI-файла: окружение считается на
 * месте, без сетевой загрузки — важно и для оффлайна, и чтобы первый кадр не
 * ждал мегабайтную карту.
 */
import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Book } from './Book';
import { useBook } from '@/store/useBook';
import { useSpreadTextures } from './useSpreadTextures';

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
  const { left, right } = useSpreadTextures();

  const sheets = pagination?.sheetCount ?? 1;

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
      <Book sheets={sheets} currentSheet={currentSheet} leftPage={left} rightPage={right} />

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
