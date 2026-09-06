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
import { rasterize } from '../rasterize/svgRasterizer';
import { fontCssForText, type FontStyle } from '../rasterize/fonts';

export interface RenderedPage {
  index: number;
  canvas: HTMLCanvasElement;
  ms: number;
  svgKb: number;
  fontKb: number;
  fontFiles: string[];
}

/** Правая страница книги — нечётная, у неё внутреннее поле слева. */
const isRecto = (pageIndex: number) => pageIndex % 2 === 0;

export class PageRenderer {
  private compositor: Compositor;
  private chapters: Map<string, Chapter>;
  private pagination: PaginationResult;
  private metrics: PageMetrics;
  private typography: Typography;
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
  ) {
    this.chapters = new Map(chapters.map((c) => [c.id, c]));
    this.pagination = pagination;
    this.metrics = metrics;
    this.typography = typography;
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

    const { canvas, timings, svgBytes } = await rasterize({
      node: this.compositor.node,
      widthPx: m.pageWidthPx,
      heightPx: m.pageHeightPx,
      css: this.compositor.css,
      fontCss: font.css,
      background: '#f6f1e6',
      offsetX,
      offsetY: m.marginTopPx,
      overlayHtml,
    });

    return {
      index: pageIndex,
      canvas,
      ms: timings.total,
      svgKb: svgBytes / 1024,
      fontKb: font.bytes / 1024,
      fontFiles: font.files,
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
