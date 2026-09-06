/**
 * Растеризатор страницы: DOM → canvas, пригодный для загрузки в WebGL.
 *
 * Это спайк, ради которого существует M0 (SPEC §19, риск №1). Узел композитора
 * сериализуется в XHTML, кладётся в <foreignObject>, рядом вшиваются шрифты,
 * всё это грузится как изображение и переносится на холст.
 *
 * ── Про два неочевидных решения ────────────────────────────────────────────
 *
 * 1. data:-URL, а не blob:. SVG, загруженный в <img> с blob:-адреса, помечается
 *    как cross-origin, и попытка отдать такую картинку в texImage2D падает с
 *    SecurityError. Тот же самый SVG через data: остаётся origin-clean.
 *    Замерено в M0, поведение Chromium.
 *
 * 2. Холст, а не ImageBitmap. Казалось бы, createImageBitmap эффективнее — но
 *    ImageBitmap, полученный из SVG-картинки, теряет origin-clean даже когда
 *    исходный <img> его сохранил, и WebGL снова отказывается его принимать.
 *    Проход через 2D-холст стоит меньше миллисекунды и снимает вопрос.
 *
 * Отброшенные альтернативы: html2canvas переписывает вёрстку своим движком и
 * врёт на переносах и курсиве; рисовать текст руками в canvas значит потерять
 * всю типографику, ради которой браузер и звался.
 */

export interface RasterizeRequest {
  node: HTMLElement;
  widthPx: number;
  heightPx: number;
  /** Стили страницы — те же, что в композиторе. */
  css: string;
  /** @font-face с data-URI. Без них foreignObject отрисуется запасным шрифтом. */
  fontCss: string;
  background: string;
  /** Отступ полосы от края страницы. */
  offsetX: number;
  offsetY: number;
  /** Колонцифра и прочее, что лежит вне полосы набора. Должно быть валидным XHTML. */
  overlayHtml?: string;
}

export interface RasterizeResult {
  canvas: HTMLCanvasElement;
  /** Разбивка времени — по ней видно, во что упираемся при регрессиях. */
  timings: { build: number; decode: number; blit: number; total: number };
  svgBytes: number;
}

const serializer = typeof XMLSerializer !== 'undefined' ? new XMLSerializer() : null;

/**
 * base64 от UTF-8: btoa работает с байтами, а в разметке бывает не только
 * латиница.
 *
 * Размер куска подобран замером, а не на глаз. Разворачивать массив в аргументы
 * (`fromCharCode(...chunk)`) кажется бесплатным, но на 32 КБ аргументов движок
 * уходит в медленный путь вызова: 10.4 мс на страницу против 1.7 мс при 8 КБ и
 * `apply`. Восемь миллисекунд — пятая часть бюджета растеризации, потраченная
 * на форму записи цикла.
 */
const B64_CHUNK = 0x2000;

function toDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK) as unknown as number[]);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function buildSvg(req: RasterizeRequest): string {
  const { widthPx: w, heightPx: h } = req;
  const inner = serializer!.serializeToString(req.node);

  // CSS уходит в CDATA: в XML-контексте голые < и & сломали бы разбор.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" ` +
    `style="width:${w}px;height:${h}px;background:${req.background};` +
    `position:relative;overflow:hidden">` +
    `<style><![CDATA[${req.fontCss}\n${req.css}]]></style>` +
    `<div style="position:absolute;left:${req.offsetX}px;top:${req.offsetY}px">${inner}</div>` +
    (req.overlayHtml ?? '') +
    `</div>` +
    `</foreignObject></svg>`
  );
}

export async function rasterize(req: RasterizeRequest): Promise<RasterizeResult> {
  if (!serializer) throw new Error('rasterize is browser-only');

  const t0 = performance.now();
  const svg = buildSvg(req);
  const url = toDataUrl(svg);
  const t1 = performance.now();

  // Разметка последней страницы под рукой в дев-сборке: расхождения между
  // композитором и растром иначе отлаживать нечем — SVG живёт внутри картинки.
  if (process.env.NODE_ENV !== 'production') {
    (globalThis as { __r3adLastSvg?: string }).__r3adLastSvg = svg;
  }

  const img = new Image();
  img.width = req.widthPx;
  img.height = req.heightPx;
  img.src = url;
  await img.decode();
  const t2 = performance.now();

  const canvas = document.createElement('canvas');
  canvas.width = req.widthPx;
  canvas.height = req.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire a 2D context');
  ctx.drawImage(img, 0, 0);
  const t3 = performance.now();

  return {
    canvas,
    timings: { build: t1 - t0, decode: t2 - t1, blit: t3 - t2, total: t3 - t0 },
    svgBytes: svg.length,
  };
}

/** Освободить пиксели холста. Обнуление размеров отпускает буфер сразу. */
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

export interface RasterizerProbe {
  ok: boolean;
  /** Доля непустых пикселей. Safari умеет молча отдавать пустой foreignObject. */
  inkRatio: number;
  note: string;
}

/**
 * Проверка, что конвейер работает в этом браузере: рисуем контрольную строку и
 * считаем, попали ли на неё чернила. Заодно ловим потерю origin-clean — если
 * getImageData бросит SecurityError, значит в WebGL текстура тоже не уедет.
 */
export async function probeRasterizer(fontCss: string): Promise<RasterizerProbe> {
  const probe = document.createElement('div');
  probe.setAttribute(
    'style',
    "width:256px;height:64px;font-family:'Literata',serif;font-size:28px;color:#000",
  );
  probe.textContent = 'Probe Ag';

  try {
    const { canvas, timings } = await rasterize({
      node: probe,
      widthPx: 256,
      heightPx: 64,
      css: '',
      fontCss,
      background: '#fff',
      offsetX: 0,
      offsetY: 0,
    });

    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const data = ctx.getImageData(0, 0, 256, 64).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 200) ink++;
    }
    releaseCanvas(canvas);

    const inkRatio = ink / (256 * 64);
    return inkRatio > 0.005
      ? { ok: true, inkRatio, note: `foreignObject draws text, ${timings.total.toFixed(0)} ms per probe` }
      : { ok: false, inkRatio, note: 'foreignObject returned a blank raster — a fallback path is needed' };
  } catch (err) {
    return { ok: false, inkRatio: 0, note: `rasterization failed: ${String(err)}` };
  }
}
