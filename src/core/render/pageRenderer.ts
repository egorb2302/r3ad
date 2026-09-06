/**
 * Сборка конкретной страницы: разбивка + композитор + растеризатор.
 *
 * Держит одну главу загруженной между вызовами — при последовательном чтении
 * это экономит перезаливку DOM на каждой странице, а перелистывание внутри
 * главы сводится к одному transform.
 */
import { Compositor } from '../paginate/compositor';
import type { PaginationResult, Chapter } from '../paginate/paginate';
import type { PageMetrics, Typography } from '../typography';
import { PAPERS, type PaperStock } from '../theme';
import { rasterize } from '../rasterize/svgRasterizer';
import { fontCssForText, type FontStyle } from '../rasterize/fonts';

export interface RenderedPage {
  index: number;
  canvas: HTMLCanvasElement;
  ms: number;
  /** Разбивка времени: сборка разметки, декодирование SVG, перенос на холст. */
  timings: { build: number; decode: number; blit: number };
  svgKb: number;
  fontKb: number;
  fontFiles: string[];
}

/** Правая страница книги — нечётная, у неё внутреннее поле слева. */
const isRecto = (pageIndex: number) => pageIndex % 2 === 0;

/** Прозрачный пиксель — подмена для иллюстраций, которых на этой странице нет. */
const BLANK_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export class PageRenderer {
  private compositor: Compositor;
  private chapters: Map<string, Chapter>;
  private pagination: PaginationResult;
  private metrics: PageMetrics;
  private typography: Typography;
  private paper: PaperStock;
  private loadedChapter: string | null = null;

  /**
   * Очередь отрисовки.
   *
   * Композитор один, а его положение — общее состояние: две страницы разворота
   * заказываются одновременно, каждая делает seek на свою колонку, и пока
   * первая ждёт шрифты, вторая успевает перемотать композитор под себя. В итоге
   * обе стороны разворота выходили с одним и тем же текстом. Рендер всё равно
   * упирается в главный поток, так что последовательное выполнение ничего не
   * стоит и снимает гонку целиком.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    chapters: Chapter[],
    pagination: PaginationResult,
    metrics: PageMetrics,
    typography: Typography,
    paper: PaperStock = PAPERS.cream,
  ) {
    this.chapters = new Map(chapters.map((c) => [c.id, c]));
    this.pagination = pagination;
    this.metrics = metrics;
    this.typography = typography;
    this.paper = paper;
    this.compositor = new Compositor(metrics, typography);
  }

  render(pageIndex: number): Promise<RenderedPage> {
    const job = this.queue.then(() => this.renderNow(pageIndex));
    // Упавшая страница не должна вставать поперёк очереди для остальных.
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async renderNow(pageIndex: number): Promise<RenderedPage> {
    const ref = this.pagination.pages[pageIndex];
    if (!ref) throw new Error(`No page ${pageIndex}`);

    if (this.loadedChapter !== ref.chapterId) {
      const chapter = this.chapters.get(ref.chapterId);
      if (!chapter) throw new Error(`No chapter ${ref.chapterId}`);
      this.compositor.setContent(chapter.html);
      this.loadedChapter = ref.chapterId;
    }
    this.compositor.seek(ref.column);
    const restoreImages = this.hideImagesOutsideColumn();

    const m = this.metrics;
    const recto = isRecto(pageIndex);

    // Внутреннее поле всегда со стороны корешка: слева на правой странице и наоборот.
    const offsetX = recto ? m.marginInnerPx : m.marginOuterPx;

    const folioBottom = Math.round(m.marginBottomPx * 0.42);
    const overlayHtml =
      `<div class="r3ad-folio" style="bottom:${folioBottom}px">${pageIndex + 1}</div>`;

    const font = await fontCssForText(
      this.compositor.text + `${pageIndex + 1}`,
      'body',
      this.stylesInUse(),
    );

    let result;
    try {
      result = await rasterize({
        node: this.compositor.node,
        widthPx: m.pageWidthPx,
        heightPx: m.pageHeightPx,
        /*
         * Краска набора дописывается правилом поверх стилей композитора, а не
         * протаскивается в него самого: от цвета текста разбивка не зависит, и
         * заводить ради него ещё один аргумент у вёрстки значило бы делать вид,
         * что зависит.
         */
        css: `${this.compositor.css}
.r3ad-flow{color:${this.paper.ink}}`,
        fontCss: font.css,
        background: this.paper.page,
        offsetX,
        offsetY: m.marginTopPx,
        overlayHtml,
      });
    } finally {
      restoreImages();
    }
    const { canvas, timings, svgBytes } = result;

    return {
      index: pageIndex,
      canvas,
      ms: timings.total,
      timings: { build: timings.build, decode: timings.decode, blit: timings.blit },
      svgKb: svgBytes / 1024,
      fontKb: font.bytes / 1024,
      fontFiles: font.files,
    };
  }

  /**
   * Убрать из разметки иллюстрации, не попавшие в текущую колонку.
   *
   * Картинки книги лежат в HTML как base64 — иначе внутри SVG они не
   * отрисуются (SPEC §6.4). Но в композиторе лежит глава целиком, и в SVG
   * каждой её страницы уезжали бы все иллюстрации главы разом: пять картинок
   * по 80 КБ превращаются в лишние 400 КБ разметки и лишние миллисекунды
   * декодирования на каждой странице, включая те, где картинок нет вовсе.
   *
   * Подменять src безопасно ровно потому, что санитайзер проставил каждой
   * картинке width и height: бокс задан атрибутами, а не содержимым, и от
   * подмены вёрстка не шелохнётся.
   */
  private hideImagesOutsideColumn(): () => void {
    const images = this.compositor.node.querySelectorAll('img');
    if (images.length === 0) return () => {};

    const clip = this.compositor.node.getBoundingClientRect();
    const hidden: { el: Element; src: string }[] = [];

    for (const img of images) {
      const box = img.getBoundingClientRect();
      const outside = box.right <= clip.left || box.left >= clip.right;
      if (!outside) continue;
      hidden.push({ el: img, src: img.getAttribute('src') ?? '' });
      img.setAttribute('src', BLANK_PIXEL);
    }

    return () => {
      for (const { el, src } of hidden) el.setAttribute('src', src);
    };
  }

  /**
   * Какие начертания встречаются в текущей главе.
   *
   * Смотрим на главу, а не на отдельную колонку: содержимое колонки браузер
   * наружу не отдаёт, а перебирать элементы по координатам дороже, чем изредка
   * вшить неиспользованный курсив. Главы без курсива — а их большинство —
   * экономят на этом 74 КБ разметки на каждой странице.
   */
  private stylesInUse(): ReadonlySet<FontStyle> {
    const styles = new Set<FontStyle>(['normal']);
    if (this.compositor.node.querySelector('em, i, cite, blockquote, address, dfn, var')) {
      styles.add('italic');
    }
    return styles;
  }

  destroy() {
    this.compositor.destroy();
  }
}
