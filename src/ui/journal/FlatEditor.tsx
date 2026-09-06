'use client';

/**
 * Плоский режим: 2D-холст поверх сцены.
 *
 * Компонент монтируется заново на каждую страницу (ключом снаружи): приближение,
 * панорама и незаконченный набор относятся к той странице, над которой сидели, и
 * переносить их на следующую незачем.
 *
 * Главное решение тетради (SPEC §9.1). Рисовать прямо по 3D-поверхности через
 * raycast нельзя: попадание считается с точностью пикселя вьюпорта, а не
 * стилуса, нажим и наклон по дороге теряются, на изогнутой странице всё едет.
 * Поэтому камера ложится над страницей, а рисование идёт по обычному холсту —
 * с `pointerrawupdate`-точностью, нажимом и `getCoalescedEvents`, которые
 * возвращают все точки, случившиеся между кадрами: на 120 Гц браузер отдаёт в
 * `pointermove` одну из двух, и без них линия угловатая.
 *
 * Холст стоит ровно там, где сцена показывает страницу: прямоугольник приезжает
 * проекцией её углов (scene/journal/flatFrame). Поэтому наклон и появление
 * холста — одно движение, а не «затемнение и открытие редактора».
 *
 * Два холста, а не один. Нижний держит страницу и перерисовывается только по
 * событию; верхний — то, что происходит прямо сейчас: ведомый штрих, кольцо
 * ластика, рамка выделения. Иначе каждая точка стилуса стоила бы полной
 * перепечатки страницы со всеми её штрихами.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { imageFor, imageSize } from '@/core/assets';
import { id as makeId } from '@/core/journal/ids';
import {
  blockAt,
  FACES,
  paintBlock,
  paintPage,
  paintStroke,
  TEXT_LEADING,
} from '@/core/journal/paint';
import { hitStroke, MIN_STEP_MM } from '@/core/journal/stroke';
import {
  blockLayer,
  PAGE_H,
  PAGE_W,
  strokeLayer,
  type Block,
  type PageDoc,
  type Rect,
  type Stroke,
} from '@/core/journal/types';
import type { PaperTint } from '@/core/theme';
import { flatRect, serverFlatRect, subscribeFlatRect } from '@/scene/journal/flatFrame';
import { BRUSH_OF, useJournal } from '@/store/useJournal';
import { clippingFor, useClips } from '@/store/useClips';

/** Предел приближения. Дальше страница крупнее собственного разрешения. */
const ZOOM = { min: 0.6, max: 6 };

/** Радиус захвата ручки размера, в пикселях экрана. */
const HANDLE = 9;

interface Drag {
  mode: 'move' | 'resize' | 'pan';
  block?: Block;
  startX: number;
  startY: number;
  origin: Rect;
  panX: number;
  panY: number;
}

interface Draft {
  block: Extract<Block, { type: 'text' }>;
  fresh: boolean;
}

/**
 * Тон бумаги приходит пропсом, а не читается из библиотеки.
 *
 * Редактор знает про тетрадь и не знает про полку — так было с M3, и заводить
 * ему знакомство со стором библиотеки ради одного цвета незачем. Кто эту
 * тетрадь держит на столе, знает Workspace, он и передаёт.
 */
export function FlatEditor({ tint }: { tint: PaperTint }) {
  const rect = useSyncExternalStore(subscribeFlatRect, flatRect, serverFlatRect);

  const openId = useJournal((s) => s.openId);
  const docs = useJournal((s) => s.docs);
  const flatPage = useJournal((s) => s.flatPage);
  const tool = useJournal((s) => s.tool);
  const brushes = useJournal((s) => s.brushes);
  const eraserRadius = useJournal((s) => s.eraser);
  const selection = useJournal((s) => s.selection);
  const apply = useJournal((s) => s.apply);
  const select = useJournal((s) => s.select);
  const setTool = useJournal((s) => s.setTool);
  const edit = useJournal((s) => s.edit);
  const insertImage = useJournal((s) => s.insertImage);
  const insertClipping = useJournal((s) => s.insertClipping);

  const journal = openId ? docs[openId] ?? null : null;
  const page = journal && flatPage !== null ? journal.pages[flatPage] ?? null : null;
  /** Слой чернил этой страницы: по его флагам решается, принимает ли она перо. */
  const ink = page ? strokeLayer(page) : { visible: true, locked: true };

  const base = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [erasing, setErasing] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Block | null>(null);

  const stroke = useRef<Stroke | null>(null);
  /** Время начала штриха: точки хранят смещение от него, а не абсолютное время. */
  const startedAt = useRef(0);
  const drag = useRef<Drag | null>(null);
  const erased = useRef(new Set<string>());
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** Зажатый пробел временно превращает любой инструмент в руку (SPEC §9.3). */
  const space = useRef(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLTextAreaElement)) space.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /** Пикселей экрана в миллиметре страницы. */
  const scale = (rect.w / PAGE_W) * zoom;

  const toPage = useCallback(
    (clientX: number, clientY: number) => {
      const box = surface.current?.getBoundingClientRect();
      if (!box) return { x: 0, y: 0 };
      return {
        x: (clientX - box.left - pan.x) / scale,
        y: (clientY - box.top - pan.y) / scale,
      };
    },
    [pan.x, pan.y, scale],
  );

  /** Общая для обоих холстов подготовка: разрешение экрана и координаты страницы. */
  const prepare = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || rect.w < 1) return null;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(rect.w * dpr);
      const height = Math.round(rect.h * dpr);

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.w, rect.h);
      ctx.translate(pan.x, pan.y);
      ctx.scale(scale, scale);
      return ctx;
    },
    [pan.x, pan.y, rect.h, rect.w, scale],
  );

  const hidden = useMemo(() => {
    const set = new Set(erasing);
    if (draft && !draft.fresh) set.add(draft.block.id);
    if (preview) set.add(preview.id);
    return set;
  }, [draft, erasing, preview]);

  const paintBase = useCallback(() => {
    const ctx = prepare(base.current);
    if (!ctx || !page) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, PAGE_W, PAGE_H);
    ctx.clip();
    paintPage(ctx, page, {
      image: imageFor,
      size: imageSize,
      clipping: clippingFor,
      hide: hidden,
      tint,
      rule: journal?.ruleMm,
    });
    ctx.restore();
  }, [hidden, journal?.ruleMm, page, prepare, tint]);

  const paintLive = useCallback(() => {
    const ctx = prepare(live.current);
    if (!ctx) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, PAGE_W, PAGE_H);
    ctx.clip();

    if (stroke.current) paintStroke(ctx, stroke.current);
    if (preview) paintBlock(ctx, preview, { image: imageFor, size: imageSize, clipping: clippingFor });
    ctx.restore();

    // Кольцо ластика и рамка выделения — поверх обреза: это интерфейс, не бумага.
    if (tool === 'eraser' && pointer.current) {
      ctx.beginPath();
      ctx.arc(pointer.current.x, pointer.current.y, eraserRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(20,16,12,0.55)';
      // Толщина задаётся в миллиметрах страницы, а нужна постоянная на экране.
      ctx.lineWidth = 1.2 / scale;
      ctx.stroke();
    }

    const chosen = preview ?? (selection && page ? findBlock(page, selection) : null);
    if (chosen && tool === 'select') {
      const { x, y, w, h } = chosen.rect;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(chosen.rot);
      ctx.strokeStyle = '#c9a227';
      ctx.lineWidth = 1.4 / scale;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#c9a227';
      const handle = HANDLE / scale;
      ctx.fillRect(w / 2 - handle / 2, h / 2 - handle / 2, handle, handle);
      ctx.restore();
    }
  }, [eraserRadius, page, preview, prepare, scale, selection, tool]);

  useEffect(() => paintBase(), [paintBase]);
  useEffect(() => paintLive(), [paintLive]);

  /** Картинку выбирают файлом сразу, как только берут инструмент. */
  useEffect(() => {
    if (tool === 'image') picker.current?.click();
  }, [tool]);

  const pressureOf = (event: { pressure: number; pointerType: string }) =>
    event.pointerType === 'mouse' || event.pressure === 0 ? 0.5 : event.pressure;

  const onPointerDown = (event: React.PointerEvent) => {
    if (!page) return;

    /*
     * Гасим действие по умолчанию: нажатие на холст переводит фокус на документ,
     * а поле ввода текста заводится этим же нажатием — и теряет фокус в тот же
     * миг, не успев появиться. Заодно снимается выделение текста при протяжке.
     */
    event.preventDefault();

    const point = toPage(event.clientX, event.clientY);
    (event.target as Element).setPointerCapture(event.pointerId);

    // Средняя кнопка и пробел панорамируют чем угодно: это не инструмент, а рука.
    const panning = event.button === 1 || space.current;
    if (panning || tool === 'select') {
      const block = panning ? null : blockAt(page, point.x, point.y);

      if (panning || !block) {
        if (tool === 'select' && !block) select(null);
        drag.current = {
          mode: 'pan',
          startX: event.clientX,
          startY: event.clientY,
          origin: { x: 0, y: 0, w: 0, h: 0 },
          panX: pan.x,
          panY: pan.y,
        };
        return;
      }

      select(block.id);
      const corner = {
        x: block.rect.x + block.rect.w,
        y: block.rect.y + block.rect.h,
      };
      const grabbingCorner =
        Math.hypot(point.x - corner.x, point.y - corner.y) * scale < HANDLE * 1.6;

      drag.current = {
        mode: grabbingCorner ? 'resize' : 'move',
        block,
        startX: point.x,
        startY: point.y,
        origin: { ...block.rect },
        panX: pan.x,
        panY: pan.y,
      };
      setPreview(block);
      return;
    }

    if (tool === 'text') {
      const existing = blockAt(page, point.x, point.y);
      const block = existing?.type === 'text' ? existing : newTextBlock(point.x, point.y);

      setDraft({ block, fresh: block !== existing });
      /*
       * Про набор текста знает и стор: пока поле ввода открыто, буквы — это
       * буквы, а не горячие клавиши инструментов. Полагаться на то, что фокус
       * уже в поле, нельзя — оно только что появилось.
       */
      edit(block.id);
      return;
    }

    /*
     * Вырезка кладётся тем же нажатием, которым выбирают ей место. Выбранная —
     * та, что подсвечена в панели: инструмент не спрашивает, какую именно, ровно
     * как перо не спрашивает, каким цветом.
     */
    if (tool === 'clip') {
      const clips = useClips.getState();
      const clipping = clips.chosen ? clips.clips[clips.chosen] : null;
      if (clipping) insertClipping(clipping, point);
      return;
    }

    /*
     * Запертый или погашенный слой чернил не принимает ни штриха, ни ластика.
     * Проверка здесь одна на оба инструмента: ниже начинается работа с
     * документом, и пускать её дальше значило бы дорисовать в слой, которого
     * на экране нет.
     */
    if (!ink.visible || ink.locked) return;

    if (tool === 'eraser') {
      erased.current = new Set();
      pointer.current = point;
      eraseAt(point);
      return;
    }

    const brush = BRUSH_OF[tool];
    if (!brush) return;

    const settings = brushes[brush];
    startedAt.current = event.timeStamp;
    stroke.current = {
      id: makeId(),
      brush,
      color: settings.color,
      width: settings.width,
      opacity: settings.opacity,
      points: [[point.x, point.y, pressureOf(event), 0]],
    };
    paintLive();
  };

  const eraseAt = (point: { x: number; y: number }) => {
    if (!page) return;
    let found = false;

    for (const candidate of strokeLayer(page).strokes) {
      if (erased.current.has(candidate.id)) continue;
      if (hitStroke(candidate, point.x, point.y, eraserRadius)) {
        erased.current.add(candidate.id);
        found = true;
      }
    }
    if (found) setErasing(new Set(erased.current));
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!page) return;

    if (drag.current?.mode === 'pan') {
      setPan({
        x: drag.current.panX + (event.clientX - drag.current.startX),
        y: drag.current.panY + (event.clientY - drag.current.startY),
      });
      return;
    }

    const point = toPage(event.clientX, event.clientY);

    if (drag.current && drag.current.block) {
      const state = drag.current;
      const dx = point.x - state.startX;
      const dy = point.y - state.startY;
      const next =
        state.mode === 'move'
          ? { ...state.origin, x: state.origin.x + dx, y: state.origin.y + dy }
          : {
              ...state.origin,
              w: Math.max(6, state.origin.w + dx),
              // Пропорции картинки сохраняем: растянутый скриншот — брак.
              h:
                state.block!.type === 'image'
                  ? (state.origin.h * Math.max(6, state.origin.w + dx)) / state.origin.w
                  : Math.max(6, state.origin.h + dy),
            };
      setPreview({ ...state.block!, rect: next } as Block);
      return;
    }

    if (tool === 'eraser') {
      pointer.current = point;
      if (event.buttons > 0) eraseAt(point);
      paintLive();
      return;
    }

    const current = stroke.current;
    if (!current) return;

    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    for (const raw of events) {
      const sample = toPage(raw.clientX, raw.clientY);
      const last = current.points[current.points.length - 1];
      if (Math.hypot(sample.x - last[0], sample.y - last[1]) < MIN_STEP_MM) continue;
      current.points.push([
        sample.x,
        sample.y,
        pressureOf(raw),
        Math.max(0, raw.timeStamp - startedAt.current),
      ]);
    }
    paintLive();
  };

  const onPointerUp = () => {
    const state = drag.current;
    drag.current = null;

    if (state?.block && preview && page) {
      apply({
        type: 'block:update',
        page: page.id,
        id: state.block.id,
        from: state.block,
        to: preview,
      });
      setPreview(null);
      return;
    }

    if (tool === 'eraser' && erased.current.size > 0 && page) {
      const gone = strokeLayer(page).strokes.filter((s) => erased.current.has(s.id));
      erased.current = new Set();
      setErasing(new Set());
      apply({ type: 'strokes:remove', page: page.id, strokes: gone });
      return;
    }

    const current = stroke.current;
    stroke.current = null;
    if (current && current.points.length > 0 && page) {
      apply({ type: 'strokes:add', page: page.id, strokes: [current] });
    }
    paintLive();
  };

  /**
   * Колесо приближает к курсору, а не к центру.
   *
   * Точка под курсором обязана остаться на месте: приближаются всегда к чему-то
   * конкретному, и «зум в центр» заставляет потом искать это что-то панорамой.
   */
  const onWheel = (event: React.WheelEvent) => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return;

    const next = Math.min(ZOOM.max, Math.max(ZOOM.min, zoom * Math.exp(-event.deltaY / 420)));
    const factor = next / zoom;
    const cx = event.clientX - box.left;
    const cy = event.clientY - box.top;

    setPan({ x: cx - (cx - pan.x) * factor, y: cy - (cy - pan.y) * factor });
    setZoom(next);
  };

  const commitDraft = (text: string) => {
    const current = draft;
    // Правку закрывает потеря фокуса, а её вызывает и щелчок по следующему
    // месту страницы — где уже успел завестись новый черновик. Снимаем только
    // свой, иначе набор обрывался бы на первом же символе.
    setDraft((live) => (live === current ? null : live));
    edit(null);
    if (!current || !page) return;

    const trimmed = text.trim();
    if (current.fresh) {
      if (!trimmed) return;
      apply({ type: 'block:add', page: page.id, block: { ...current.block, text } });
      return;
    }

    if (text === current.block.text) return;
    if (!trimmed) {
      apply({ type: 'block:remove', page: page.id, block: current.block });
      return;
    }
    apply({
      type: 'block:update',
      page: page.id,
      id: current.block.id,
      from: current.block,
      to: { ...current.block, text },
    });
  };

  if (!rect.ready || !page) return null;

  return (
    <div className="absolute inset-0 z-20">
      {/* Затемнение вокруг страницы: смотреть сейчас надо на неё, а не на сцену */}
      <div className="absolute inset-0 bg-ink-950/55" />

      <div
        ref={surface}
        className="absolute touch-none overflow-hidden"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          cursor: cursorFor(tool),
          boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          pointer.current = null;
          paintLive();
        }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={base} className="absolute inset-0 h-full w-full" />
        <canvas
          ref={live}
          className="absolute inset-0 h-full w-full"
          // Маркер обязан умножаться и на живом слое, иначе он темнеет в момент,
          // когда штрих отпускают и он ложится на страницу.
          style={{ mixBlendMode: tool === 'marker' ? 'multiply' : 'normal' }}
        />

        {draft ? (
          <TextInput
            block={draft.block}
            scale={scale}
            pan={pan}
            onCommit={commitDraft}
          />
        ) : null}
      </div>

      <input
        ref={picker}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          setTool('select');
          if (file) void insertImage(file).catch(() => undefined);
        }}
      />
    </div>
  );
}

function findBlock(page: PageDoc, id: string): Block | null {
  return blockLayer(page).blocks.find((b) => b.id === id) ?? null;
}

function newTextBlock(x: number, y: number): Extract<Block, { type: 'text' }> {
  const width = Math.min(72, Math.max(28, PAGE_W - x - 8));
  return {
    id: makeId(),
    type: 'text',
    rect: { x, y, w: width, h: 12 },
    rot: 0,
    text: '',
    style: { sizeMm: 4, color: '#23303f', family: 'sans', weight: 400 },
  };
}

function cursorFor(tool: string) {
  if (tool === 'select') return 'default';
  if (tool === 'text') return 'text';
  if (tool === 'clip') return 'copy';
  return 'crosshair';
}

/**
 * Поле ввода поверх страницы.
 *
 * Текст набирается настоящим `textarea` — с курсором, выделением, композицией
 * иероглифов и всем, что браузер уже умеет и что заново на холсте не написать.
 * Совпадение с печатью обеспечивается тем, что кегль, гарнитура и интерлиньяж
 * берутся из того же блока (см. blockFont в core/journal/paint).
 */
function TextInput({
  block,
  scale,
  pan,
  onCommit,
}: {
  block: Extract<Block, { type: 'text' }>;
  scale: number;
  pan: { x: number; y: number };
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(block.text);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Следующей задачей: поле заводится нажатием, и фокус, поставленный внутри
    // того же события, у него ещё может отобрать браузер.
    const timer = setTimeout(() => {
      field.current?.focus();
      field.current?.select();
    });
    return () => clearTimeout(timer);
  }, []);

  return (
    <textarea
      ref={field}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') field.current?.blur();
      }}
      spellCheck={false}
      className="absolute resize-none border border-dashed border-brass-500/70 bg-transparent p-0 outline-none"
      style={{
        left: block.rect.x * scale + pan.x,
        top: block.rect.y * scale + pan.y,
        width: block.rect.w * scale,
        height: Math.max(block.rect.h, block.style.sizeMm * TEXT_LEADING * 2) * scale,
        // По частям, а не сокращённой записью `font`: она перебивает lineHeight.
        fontFamily: FACES[block.style.family],
        fontSize: block.style.sizeMm * scale,
        fontWeight: block.style.weight,
        lineHeight: TEXT_LEADING,
        color: block.style.color,
      }}
    />
  );
}
