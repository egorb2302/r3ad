'use client';

/**
 * Тетрадь в плоском режиме — расшифровка, а не копия.
 *
 * Конспект на две трети состоит из того, что текстом не выражается: обводки,
 * стрелки, зачёркивания. Притворяться, будто мы это прочитали, нельзя — и врать
 * про это тоже: там, где на странице штрихи, так и написано, сколько их. Всё
 * остальное — набранный текст, вставленные картинки и вырезки — здесь есть
 * целиком, потому что оно и было текстом.
 *
 * Порядок внутри страницы — сверху вниз по положению на листе, а не по порядку
 * добавления: читают страницу глазами, а не историей правок.
 */
import { blockLayer, strokeLayer, type PageDoc } from '@/core/journal/types';
import { bylineOf, clippingText } from '@/core/clipping/types';
import { clippingFor } from '@/store/useClips';
import { useJournal } from '@/store/useJournal';
import { useLibrary } from '@/store/useLibrary';

function Page({ page, number }: { page: PageDoc; number: number }) {
  const blocks = [...blockLayer(page).blocks].sort((a, b) => a.rect.y - b.rect.y);
  const strokes = strokeLayer(page).strokes.length;

  return (
    <section className="border-t border-black/10 py-6">
      <p className="tabular mb-3 text-[11px] uppercase tracking-[0.14em] opacity-45">
        page {number}
        {strokes > 0 ? ` · ${strokes} handwritten ${strokes === 1 ? 'stroke' : 'strokes'}` : ''}
      </p>

      {blocks.length === 0 && strokes === 0 ? (
        <p className="text-[13px] opacity-45">Blank.</p>
      ) : null}

      {blocks.map((block) => {
        if (block.type === 'text') {
          return (
            <p key={block.id} className="mb-3 whitespace-pre-wrap text-[15px] leading-relaxed">
              {block.text}
            </p>
          );
        }

        if (block.type === 'image') {
          return (
            <p key={block.id} className="mb-3 text-[13px] opacity-55">
              [image]
            </p>
          );
        }

        const clipping = clippingFor(block.clippingId);
        if (!clipping) {
          return (
            <p key={block.id} className="mb-3 text-[13px] opacity-55">
              [clipping — not in this snapshot]
            </p>
          );
        }

        return (
          <blockquote key={block.id} className="mb-4 border-l-2 border-black/20 pl-3">
            <p className="mb-1 text-[12px] opacity-55">
              {bylineOf(clipping)} ·{' '}
              <a
                href={clipping.url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                {clipping.attribution.sourceName}
              </a>
            </p>
            {clipping.title ? <p className="mb-1 text-[15px] font-medium">{clipping.title}</p> : null}
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed">
              {clippingText(clipping)}
            </p>
          </blockquote>
        );
      })}
    </section>
  );
}

export function PlainJournal() {
  const desk = useLibrary((s) => s.desk);
  const doc = useJournal((s) => (s.openId ? s.docs[s.openId] : null));

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] opacity-60">
        nothing on the desk
      </div>
    );
  }

  return (
    <div tabIndex={0} aria-label={doc.title} className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[42em] px-5 py-8">
        <h1 className="text-[19px] font-medium">{desk?.title ?? doc.title}</h1>
        <p className="mb-4 text-[12.5px] opacity-55">
          notebook · {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
        </p>
        {doc.pages.map((page, i) => (
          <Page key={page.id} page={page} number={i + 1} />
        ))}
      </div>
    </div>
  );
}
