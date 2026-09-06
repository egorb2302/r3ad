/**
 * Композитор — скрытый кусок DOM, в котором браузер верстает страницы за нас.
 *
 * Мы не считаем переносы, вдовы и обтекание сами: элементу задаётся
 * column-width, равная ширине наборной полосы, и движок сам режет текст на
 * колонки. Каждая колонка — ровно одна страница книги. Отсюда бесплатно
 * получаются корректные переносы для любого языка (SPEC §6.3).
 *
 * Тот же самый узел потом отдаётся растеризатору: страница на текстуре — это
 * буквально то, что насчитал браузер, а не независимая перерисовка.
 */
import type { PageMetrics, Typography } from '../typography';
import { pageCss, flowInlineStyle } from './pageCss';

export class Compositor {
  private root: HTMLDivElement;
  private styleEl: HTMLStyleElement;
  private clipEl: HTMLDivElement;
  private flowEl: HTMLDivElement;
  private metrics: PageMetrics;
  private typography: Typography;

  constructor(metrics: PageMetrics, typography: Typography) {
    this.metrics = metrics;
    this.typography = typography;

    this.root = document.createElement('div');
    // Композитор обязан быть в потоке, иначе layout не считается.
    // visibility:hidden оставляет вёрстку, но убирает отрисовку.
    this.root.setAttribute(
      'style',
      'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
        'z-index:-1;contain:strict;width:0;height:0;overflow:hidden',
    );
    this.root.setAttribute('aria-hidden', 'true');

    this.styleEl = document.createElement('style');
    this.clipEl = document.createElement('div');
    this.clipEl.className = 'r3ad-clip';
    this.flowEl = document.createElement('div');
    this.flowEl.className = 'r3ad-flow';

    this.clipEl.appendChild(this.flowEl);
    this.root.append(this.styleEl, this.clipEl);
    document.body.appendChild(this.root);

    this.applyStyle();
  }

  /** Пересобрать геометрию и типографику. Инвалидирует текущую разбивку. */
  configure(metrics: PageMetrics, typography: Typography) {
    this.metrics = metrics;
    this.typography = typography;
    this.applyStyle();
  }

  private applyStyle() {
    const m = this.metrics;
    this.styleEl.textContent = pageCss(m, this.typography);
    this.clipEl.setAttribute('style', `width:${m.boxWidthPx}px;height:${m.boxHeightPx}px`);
    this.flowEl.setAttribute('style', flowInlineStyle(m, 'right'));

    /*
     * Язык вешаем на саму полосу, а не полагаемся на <html lang>. Внутри
     * SVG-картинки наследовать неоткуда: там свой документ, и без явного
     * атрибута переносы в растре расходятся с теми, по которым посчитаны
     * страницы. Атрибут переживает XMLSerializer и уезжает в разметку вместе
     * с узлом.
     */
    this.flowEl.setAttribute('lang', this.typography.lang);
    this.flowEl.setAttribute('xml:lang', this.typography.lang);
  }

  /** Залить содержимое главы. Вызывающий отвечает за санитайзинг. */
  setContent(html: string) {
    this.flowEl.innerHTML = html;
    this.seek(0);
  }

  /**
   * Сколько колонок (то есть страниц) заняла глава.
   *
   * scrollWidth включает вылезшие вправо колонки. Последняя колонка не
   * сопровождается зазором, поэтому прибавляем один columnGap перед делением.
   */
  count(): number {
    const { boxWidthPx, columnGapPx } = this.metrics;
    // Чтение scrollWidth принудительно синхронизирует layout — это и есть замер.
    const total = this.flowEl.scrollWidth;
    if (total <= 0) return 1;
    return Math.max(1, Math.round((total + columnGapPx) / (boxWidthPx + columnGapPx)));
  }

  /**
   * Показать колонку с индексом i.
   *
   * Сдвигаем именно transform, а не scrollLeft: XMLSerializer переносит в SVG
   * инлайновые стили, но не позицию прокрутки — на растре страница уехала бы
   * обратно к началу главы.
   */
  seek(column: number) {
    const { boxWidthPx, columnGapPx } = this.metrics;
    const dx = column * (boxWidthPx + columnGapPx);
    this.flowEl.style.transform = `translateX(${-dx}px)`;
  }

  /** Узел под растеризацию: обрезан ровно по наборной полосе. */
  get node(): HTMLElement {
    return this.clipEl;
  }

  get css(): string {
    return pageCss(this.metrics, this.typography);
  }

  /** Текст текущего содержимого — нужен, чтобы выбрать подмножества шрифтов. */
  get text(): string {
    return this.flowEl.textContent ?? '';
  }

  destroy() {
    this.root.remove();
  }
}
