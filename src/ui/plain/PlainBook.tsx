'use client';

/**
 * Книга в плоском режиме: одна глава на экран.
 *
 * Единица здесь глава, а не страница, и это не упрощение. Страница у нас —
 * следствие листа 148×210 мм: сколько строк туда влезло, столько в ней и есть.
 * В окне произвольной формы такой страницы не существует, а выдумывать вторую
 * разбивку, которая не совпадёт ни с толщиной книги, ни с номерами на срезе,
 * значило бы завести в проекте два разных представления о том, где человек
 * читает. Глава же — единица разбивки с самого начала (§6.3), и по ней режимы
 * стыкуются без вранья: ушли из главы 7 — вернулись на её первую страницу.
 *
 * Разметку главы кладём в DOM напрямую, минуя React. Причина не в скорости, а в
 * подсветке поиска: она оборачивает найденное в `<mark>` прямо в тексте, и если
 * бы поддеревом владел React, следующий же рендер стёр бы её или, хуже,
 * попытался бы согласовать своё представление с чужими узлами.
 */
import { useEffect, useRef } from 'react';
import type { Chapter } from '@/core/content';
import { chapterAtPage } from '@/core/plain';
import { useBook } from '@/store/useBook';
import { useShell } from '@/store/useShell';

/**
 * Обернуть найденное в `<mark>` и вернуть узел нужного по счёту совпадения.
 *
 * Текстовые узлы собираются заранее: мы их по ходу дела рассекаем, а
 * TreeWalker, обходящий изменяемое дерево, приводит к тому, что часть
 * совпадений находится дважды, а часть не находится вовсе.
 */
function highlight(root: HTMLElement, query: string, nth: number): HTMLElement | null {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue && node.nodeValue.trim()) nodes.push(node as Text);
  }

  let seen = 0;
  let target: HTMLElement | null = null;

  for (const node of nodes) {
    const text = node.nodeValue ?? '';
    const lower = text.toLowerCase();
    let at = lower.indexOf(needle);
    if (at < 0) continue;

    let rest = node;
    let consumed = 0;
    while (at >= 0) {
      // rest начинается с consumed-го знака исходного текста.
      const middle = rest.splitText(at - consumed);
      middle.splitText(needle.length);

      const mark = document.createElement('mark');
      if (seen === nth) {
        mark.className = 'here';
        target = mark;
      }
      middle.replaceWith(mark);
      mark.append(middle);
      seen += 1;

      const tail = mark.nextSibling as Text | null;
      if (!tail) break;
      rest = tail;
      consumed = at + needle.length;
      at = lower.indexOf(needle, consumed);
    }
  }

  return target;
}

export function PlainBook() {
  const doc = useBook((s) => s.doc);
  const pagination = useBook((s) => s.pagination);
  const currentSheet = useBook((s) => s.currentSheet);
  const status = useBook((s) => s.status);

  const chosen = useShell((s) => s.chapter);
  const setChapter = useShell((s) => s.setChapter);
  const find = useShell((s) => s.find);

  /*
   * Какая глава открыта. Своего выбора может и не быть — тогда показываем ту, на
   * которой стоит книга: человек пришёл сюда из 3D, и первое, что он должен
   * увидеть, это то, что он читал.
   */
  const standing = chapterAtPage(pagination, currentSheet * 2)?.id;
  const active = chosen ?? standing ?? doc.chapters[0]?.id ?? null;
  const index = Math.max(0, doc.chapters.findIndex((c) => c.id === active));
  const chapter: Chapter | undefined = doc.chapters[index];
  const span = pagination?.chapters.find((c) => c.id === chapter?.id) ?? null;

  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const html = chapter?.html ?? '';
  const query = find?.query ?? null;
  const nth = find?.nth ?? 0;

  useEffect(() => {
    const node = body.current;
    if (!node) return;

    /*
     * Разметка главы уже прошла санитайзер при разборе книги (§18): ни
     * скриптов, ни обработчиков, ни внешних адресов в ней нет — картинки
     * приезжают data-URI. Второй раз чистить нечего, а вставлять текст
     * посимвольно означало бы потерять курсив и иллюстрации.
     */
    node.innerHTML = html;

    if (!query) {
      // Новая глава читается с начала — кроме случая, когда сюда пришли из
      // поиска: там начало это найденное место.
      scroller.current?.scrollTo({ top: 0 });
      return;
    }

    const target = highlight(node, query, nth);
    target?.scrollIntoView({ block: 'center' });
  }, [html, query, nth]);

  if (!chapter) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] opacity-60">
        {status === 'reading' || status === 'paginating' ? 'opening…' : 'nothing on the desk'}
      </div>
    );
  }

  const titled = /<h1[\s>]/i.test(chapter.html);
  const previous = doc.chapters[index - 1];
  const next = doc.chapters[index + 1];

  return (
    /*
      Прокручиваемая область получает фокус: колесо есть не у всех, а стрелки
      листают то, на чём стоит фокус. Без tabIndex до текста книги с клавиатуры
      было бы не добраться вовсе.
    */
    <div ref={scroller} tabIndex={0} aria-label={chapter.title} className="h-full overflow-y-auto">
      <article className="r3ad-plain">
        <p className="tabular mb-6 text-[11px] uppercase tracking-[0.14em] opacity-45">
          {index + 1} / {doc.chapters.length}
          {span ? ` · pp. ${span.startPage + 1}–${span.startPage + span.pageCount}` : ''}
        </p>

        {/*
          Заголовок главы у книги обычно есть в самой разметке, поэтому свой
          ставим только когда его нет: два одинаковых заголовка подряд — верный
          признак читалки, собранной наспех.
        */}
        {titled ? null : <h1>{chapter.title}</h1>}

        <div ref={body} />

        <nav className="mt-12 flex items-center justify-between gap-4 border-t border-black/10 pt-5 text-[12px]">
          <button
            type="button"
            disabled={!previous}
            onClick={() => previous && setChapter(previous.id)}
            className="max-w-[45%] truncate rounded px-1.5 py-1 text-left underline decoration-black/30 underline-offset-4 disabled:opacity-25 disabled:no-underline"
          >
            {previous ? `← ${previous.title}` : '← start of the book'}
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => next && setChapter(next.id)}
            className="max-w-[45%] truncate rounded px-1.5 py-1 text-right underline decoration-black/30 underline-offset-4 disabled:opacity-25 disabled:no-underline"
          >
            {next ? `${next.title} →` : 'end of the book →'}
          </button>
        </nav>
      </article>
    </div>
  );
}
