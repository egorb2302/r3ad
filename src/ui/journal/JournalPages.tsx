'use client';

/**
 * Список страниц тетради в навигаторе.
 *
 * У тома в этом месте оглавление, у тетради его нет и быть не может: заголовков
 * в конспекте никто не расставляет. Вместо него — сами страницы, и по каждой
 * видно, есть ли на ней что-нибудь. Это ровно тот признак, по которому ищут
 * нужную: «где-то на четвёртой, там ещё картинка».
 */
import { useBook } from '@/store/useBook';
import { useJournal } from '@/store/useJournal';

/** «1 stroke», «2 blocks», «—» — то, по чему страницу узнают в списке. */
function summary(strokes: number, blocks: number): string {
  const parts: string[] = [];
  if (strokes) parts.push(`${strokes} stroke${strokes === 1 ? '' : 's'}`);
  if (blocks) parts.push(`${blocks} block${blocks === 1 ? '' : 's'}`);
  return parts.join(' · ') || '—';
}

export function JournalPages() {
  const openId = useJournal((s) => s.openId);
  const docs = useJournal((s) => s.docs);
  const flatPage = useJournal((s) => s.flatPage);
  const setFlatPage = useJournal((s) => s.setFlatPage);

  const currentSheet = useBook((s) => s.currentSheet);
  const setSheet = useBook((s) => s.setSheet);

  const journal = openId ? docs[openId] ?? null : null;
  if (!journal) return null;

  const flat = flatPage !== null;
  const spread = [currentSheet * 2 - 1, currentSheet * 2];

  return (
    <nav className="flex-1 overflow-y-auto py-1">
      {journal.pages.map((page, index) => {
        const strokes = page.layers.reduce(
          (sum, layer) => sum + (layer.type === 'strokes' ? layer.strokes.length : 0),
          0,
        );
        const blocks = page.layers.reduce(
          (sum, layer) => sum + (layer.type === 'blocks' ? layer.blocks.length : 0),
          0,
        );
        const active = flat ? index === flatPage : spread.includes(index);

        return (
          <button
            key={page.id}
            type="button"
            onClick={() => (flat ? setFlatPage(index) : setSheet(Math.floor((index + 1) / 2)))}
            className={`flex w-full items-baseline justify-between gap-2 py-[5px] pl-3 pr-3 text-left text-[11.5px] transition-colors ${
              active
                ? 'bg-ink-800 text-ash-100'
                : 'text-ash-300 hover:bg-ink-850 hover:text-ash-100'
            }`}
          >
            <span className="tabular">Page {index + 1}</span>
            <span className="tabular shrink-0 text-[10.5px] text-ash-400">
              {summary(strokes, blocks)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
