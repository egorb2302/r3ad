'use client';

/**
 * Тело плоского режима: бумага, стили набора и то, что на ней показано.
 *
 * Отдельно от шапки, потому что шапок две — своя у воркспейса и своя у
 * публичного снимка, — а бумага под ними одна и та же. Второй экземпляр этих
 * стилей означал бы, что чужая ссылка однажды начнёт выглядеть иначе, чем своя
 * полка, и заметит это только тот, кому её прислали.
 */
import { useMemo } from 'react';
import { plainCss } from '@/core/plain';
import { PAPERS } from '@/core/theme';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { PlainBook } from './PlainBook';
import { PlainJournal } from './PlainJournal';
import { PlainShelf } from './PlainShelf';

export function PlainBody() {
  const typography = useBook((s) => s.typography);
  const view = useLibrary((s) => s.view);
  const desk = useLibrary((s) => s.desk);

  // Бумага — та же, что у книги на столе (§8): плоский режим не другая книга, а
  // та же самая, набранная в другой среде.
  const paper = PAPERS[desk?.theme.paper.tint ?? 'cream'];
  const css = useMemo(() => plainCss(typography, paper), [typography, paper]);

  return (
    <div className="h-full" style={{ background: paper.page, color: paper.ink }}>
      <style>{css}</style>
      {view === 'case' ? (
        <PlainShelf />
      ) : desk?.kind === 'journal' ? (
        <PlainJournal />
      ) : (
        <PlainBook />
      )}
    </div>
  );
}
