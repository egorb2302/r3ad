'use client';

/**
 * Панель «Storage» — что лежит у меня и что уехало.
 *
 * До M5 полка жила в памяти вкладки, и вопрос «переживёт ли это перезагрузку»
 * не имел ответа, потому что ответ был всегда «нет». Теперь он есть, и его надо
 * показывать: локальное хранилище — единственная часть системы, которая может
 * молча кончиться (браузер даёт квоту и не спрашивает), а узнать об этом по
 * пропавшему конспекту — худший из возможных способов.
 */
import { useEffect, useState } from 'react';
import { localUsage, type LocalUsage } from '@/db/local';
import { useClips } from '@/store/useClips';
import { useJournal } from '@/store/useJournal';
import { useLibrary } from '@/store/useLibrary';
import { useShare } from '@/store/useShare';
import { Panel, Stat } from '../primitives';

export function SharePanel() {
  const [usage, setUsage] = useState<LocalUsage | null>(null);

  const volumes = useLibrary((s) => s.volumes);
  const journals = useJournal((s) => s.docs);
  const clips = useClips((s) => s.clips);
  const link = useShare((s) => s.link);
  const toggle = useShare((s) => s.toggle);

  /*
   * Считаем после каждой правки полки, а не по таймеру: запись в базу идёт с
   * задержкой в секунду (см. useShare), поэтому цифра здесь и без того догоняет
   * с опозданием — но догоняет от события, а не когда вздумается.
   */
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void localUsage().then((value) => {
        if (alive) setUsage(value);
      });
    }, 1200);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [volumes, journals, clips]);

  return (
    <Panel
      title="Storage"
      right={
        <button
          type="button"
          onClick={() => toggle(true)}
          className="rounded px-1.5 text-[10px] text-ash-400 transition-colors hover:bg-ink-800 hover:text-ash-100"
        >
          share
        </button>
      }
    >
      <Stat
        label="On the shelf"
        value={`${volumes.length} · ${Object.keys(journals).length} notebooks`}
      />
      <Stat
        label="Kept locally"
        value={usage ? `${usage.assets} files · ${(usage.bytes / 1024 / 1024).toFixed(1)} MB` : '—'}
        hint="Images, clipping media and the book files you opened, stored by their sha256 in this browser"
      />
      <Stat
        label="Published"
        value={link ? `${link.id} · v${link.version}` : '—'}
        hint={link ? link.url : 'Nothing from this session has a public link'}
      />
    </Panel>
  );
}
