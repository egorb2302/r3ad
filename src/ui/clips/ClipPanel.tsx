'use client';

/**
 * Панель вырезок: развернуть ссылку, вставить руками, собрать досье.
 *
 * Два поля, а не одно с переключателем. Ручная вставка — равноправный путь
 * (SPEC §10), и прятать её за «попробуйте иначе» значило бы обещать, что
 * автоматический разбор обычно срабатывает. С датацентрового IP он срабатывает
 * не всегда, и человек, который это знает, должен попадать в нужное поле сразу,
 * а не после отказа.
 *
 * Список здесь же и он же — оглавление будущего тома: порядок вырезок в панели
 * есть порядок глав.
 */
import { useState } from 'react';
import { dateOf } from '@/core/clipping/card';
import { bylineOf, clippingText, type Clipping } from '@/core/clipping/types';
import { useClips } from '@/store/useClips';
import { useJournal } from '@/store/useJournal';
import { useLibrary } from '@/store/useLibrary';
import { Notice, Panel } from '../primitives';

const ADAPTER_LABEL: Record<Clipping['adapter'], string> = {
  'x-post': 'X post',
  article: 'article',
  'og-card': 'card',
  image: 'image',
  paste: 'pasted',
};

const ACCENT: Record<Clipping['adapter'], string> = {
  'x-post': '#1d9bf0',
  article: '#b07d3a',
  'og-card': '#7a8b6f',
  image: '#8d6f9c',
  paste: '#a2a08f',
};

export function ClipPanel() {
  const clips = useClips((s) => s.clips);
  const order = useClips((s) => s.order);
  const pending = useClips((s) => s.pending);
  const error = useClips((s) => s.error);
  const chosen = useClips((s) => s.chosen);
  const unfurl = useClips((s) => s.unfurl);
  const pasteClip = useClips((s) => s.paste);
  const remove = useClips((s) => s.remove);
  const choose = useClips((s) => s.choose);
  const compile = useClips((s) => s.compile);

  const desk = useLibrary((s) => s.desk);
  const flatPage = useJournal((s) => s.flatPage);
  const setTool = useJournal((s) => s.setTool);
  const insertClipping = useJournal((s) => s.insertClipping);

  const [link, setLink] = useState('');
  const [manual, setManual] = useState('');
  // Поле ручной вставки раскрывается само, когда источник нас не пустил.
  const [open, setOpen] = useState(false);
  const showManual = open || error?.code === 'paste';

  const writing = desk?.kind === 'journal';
  const list = order.map((id) => clips[id]).filter(Boolean);

  const submit = () => {
    const url = link.trim();
    if (!url || pending) return;
    void unfurl(url).then((clipping) => {
      if (clipping) setLink('');
    });
  };

  const addManual = () => {
    if (!manual.trim()) return;
    if (pasteClip(manual, link.trim() || undefined)) {
      setManual('');
      setOpen(false);
    }
  };

  return (
    <Panel
      title="Clippings"
      right={
        <span className="tabular text-[10px] text-ash-400">{list.length > 0 ? list.length : ''}</span>
      }
    >
      <div className="flex gap-1.5">
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') submit();
          }}
          placeholder="Paste a link"
          spellCheck={false}
          className="h-[22px] min-w-0 flex-1 rounded border border-ink-700 bg-ink-850 px-1.5 text-[11px] text-ash-200 outline-none placeholder:text-ash-500 focus:border-ink-600"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!link.trim() || pending !== ''}
          className="h-[22px] shrink-0 rounded bg-ink-700 px-2 text-[11px] text-ash-100 transition-colors hover:bg-ink-600 disabled:opacity-35"
        >
          {pending ? '…' : 'unfurl'}
        </button>
      </div>

      {error ? (
        <div className="mt-2">
          <Notice tone={error.code === 'paste' ? 'warn' : 'error'}>{error.message}</Notice>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1.5 text-[10.5px] text-ash-400 underline-offset-2 transition-colors hover:text-ash-200 hover:underline"
      >
        {showManual ? 'hide the paste box' : 'or paste the text by hand'}
      </button>

      {showManual ? (
        <div className="mt-1.5">
          <textarea
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={'Name\n@handle\nThe post text…'}
            spellCheck={false}
            rows={4}
            className="w-full resize-none rounded border border-ink-700 bg-ink-850 p-1.5 text-[11px] leading-snug text-ash-200 outline-none placeholder:text-ash-500 focus:border-ink-600"
          />
          <p className="mt-1 text-[10px] leading-snug text-ash-400">
            The author, handle and date are read out of the pasted text; the link above becomes the
            attribution.
          </p>
          <button
            type="button"
            onClick={addManual}
            disabled={!manual.trim()}
            className="mt-1.5 h-[22px] w-full rounded bg-ink-800 text-[11px] text-ash-300 transition-colors hover:bg-ink-700 hover:text-ash-100 disabled:opacity-35"
          >
            Add the clipping
          </button>
        </div>
      ) : null}

      {list.length > 0 ? (
        <div className="mt-2.5 flex flex-col gap-1">
          {list.map((clipping) => (
            <div
              key={clipping.id}
              className={`group flex items-start gap-1.5 rounded px-1.5 py-1 transition-colors ${
                chosen === clipping.id ? 'bg-ink-800' : 'hover:bg-ink-850'
              }`}
            >
              <span
                className="mt-[3px] h-[9px] w-[3px] shrink-0 rounded-sm"
                style={{ backgroundColor: ACCENT[clipping.adapter] }}
              />
              <button
                type="button"
                onClick={() => choose(chosen === clipping.id ? null : clipping.id)}
                className="min-w-0 flex-1 text-left"
                title={clipping.attribution.sourceUrl || clipping.attribution.sourceName}
              >
                <span className="block truncate text-[11px] text-ash-100">{headline(clipping)}</span>
                <span className="block truncate text-[10px] text-ash-400">
                  {ADAPTER_LABEL[clipping.adapter]} · {bylineOf(clipping)} ·{' '}
                  {dateOf(clipping.publishedAt ?? clipping.fetchedAt)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(clipping.id)}
                title="Forget this clipping"
                className="shrink-0 px-1 text-[11px] text-ash-500 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {list.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {writing ? (
            <button
              type="button"
              onClick={() => {
                const clipping = chosen ? clips[chosen] : list[list.length - 1];
                if (!clipping) return;
                // Не на столе — сначала ложимся к странице: класть вырезку
                // некуда, пока страница не раскрыта плоско.
                if (flatPage === null) setTool('clip');
                else insertClipping(clipping);
              }}
              className="h-[22px] w-full rounded bg-ink-800 text-[11px] text-ash-300 transition-colors hover:bg-ink-700 hover:text-ash-100"
            >
              {flatPage === null ? 'Open the page and place it' : 'Place on this page'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => compile()}
            className="h-[22px] w-full rounded bg-brass-500/20 text-[11px] text-brass-300 transition-colors hover:bg-brass-500/30"
            title="Compile the clippings into a volume and put it on the shelf"
          >
            Compile a dossier · {list.length}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[10.5px] leading-snug text-ash-400">
          Unfurled links land here. Several of them compile into a volume that reads like any other
          book.
        </p>
      )}
    </Panel>
  );
}

/** Строка списка: заголовок, а если его нет — начало текста. */
function headline(clipping: Clipping): string {
  if (clipping.title) return clipping.title;
  const text = clippingText(clipping).replace(/\s+/g, ' ').trim();
  return text.length > 52 ? `${text.slice(0, 51)}…` : text || clipping.attribution.sourceName;
}
