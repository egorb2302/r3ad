'use client';

/**
 * Публичная страница снимка `/s/:id`.
 *
 * Та же сцена, что и в воркспейсе, — и это главное требование к ней: получатель
 * должен увидеть полку, а не её скриншот. Поэтому здесь нет второго рендерера,
 * второй модели книги и «облегчённого режима»; есть тот же `Viewport`, которому
 * сторы заполнены из бандла.
 *
 * Чего здесь нет — так это инструментов. Снимок read-only не потому, что править
 * его технически нечем, а потому что править чужое молча — худшее, что можно
 * сделать с ссылкой: человек рисует полчаса, обновляет страницу и обнаруживает,
 * что рисовал в воздухе. Кнопка «форкнуть» ставит это на место одним движением:
 * полка становится своей, и дальше всё как обычно.
 *
 * Ключ из фрагмента читается здесь же и не уходит никуда дальше: `#k=…` не
 * попадает ни в запрос, ни в `Referer` — на этом и держится обещание §11.3.
 */
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { applyBundle } from '@/store/hydrate';
import { useLibrary } from '@/store/useLibrary';
import {
  useShare,
  loadSnapshot,
  pausePersistence,
  type LoadedSnapshot,
} from '@/store/useShare';
import { Notice } from '../primitives';
import { useBoot } from '../boot';

const Viewport = dynamic(() => import('@/scene/Viewport').then((m) => m.Viewport), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-ink-950" />,
});

type Phase = 'loading' | 'locked' | 'ready' | 'failed';

export function SnapshotView({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [stage, setStage] = useState('opening');
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [snapshot, setSnapshot] = useState<LoadedSnapshot | null>(null);
  const [forked, setForked] = useState(false);

  const boot = useBoot();
  const router = useRouter();
  const view = useLibrary((s) => s.view);
  const setView = useLibrary((s) => s.setView);

  /*
   * Состояние здесь не трогается до первого `await` — эффект ниже зовёт эту
   * функцию сразу, а синхронный setState в теле эффекта означает лишний каскад
   * рендеров. Начальная фаза и так `loading`; сбрасывает её обратно тот, кто
   * повторяет попытку, — и делает это из обработчика события.
   */
  const load = useCallback(
    async (key?: string) => {
      try {
        const loaded = await loadSnapshot(id, key, (what, done, total) =>
          setStage(total > 1 ? `${what} — ${done} of ${total}` : what),
        );
        await applyBundle(loaded.bundle, { assets: loaded.assets, mode: 'replace' });
        setSnapshot(loaded);
        setPhase('ready');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // «Заперт» — не отказ, а вопрос. Пароль спрашиваем ровно тогда, когда
        // он есть, и знаем об этом из самого конверта (см. core/share/lock.ts).
        if (message === 'this snapshot is locked' || message === 'wrong passphrase') {
          setPhase('locked');
          setError(message === 'wrong passphrase' ? 'That is not the phrase.' : null);
          return;
        }
        setPhase('failed');
        setError(message);
      }
    },
    [id],
  );

  useEffect(() => {
    /*
     * Первым делом — не писать. Дальше сторы заполнятся чужой полкой, а
     * автосохранение отличить её от своей не может: для него это просто новое
     * состояние библиотеки.
     */
    pausePersistence();

    void (async () => {
      // Ключ из фрагмента. `location.hash` живёт только в браузере и на сервер
      // не уходит — ради этого он там и лежит.
      const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
      await load(fragment.get('k') ?? undefined);
    })();
  }, [load]);

  const fork = useCallback(async () => {
    if (!snapshot) return;
    // Форк — это «пусть будет у меня»: полка перестаёт быть чужой, поэтому
    // дальше человек идёт на главную, где у неё есть инструменты.
    await useShare.getState().fork(snapshot.bundle, snapshot.assets);
    setForked(true);
    setTimeout(() => router.push('/'), 600);
  }, [router, snapshot]);

  return (
    <div className="flex h-dvh w-full flex-col bg-ink-950">
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900 px-3">
        <div className="flex items-center gap-2 text-[11.5px]">
          <Link href="/" className="font-medium tracking-tight text-brass-500">
            r3ad
          </Link>
          <span className="text-ink-600">/</span>
          <span className="max-w-[320px] truncate text-ash-100">
            {snapshot?.title ?? 'a shelf'}
          </span>
          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ash-400">
            read-only
          </span>
        </div>

        <div className="flex items-center gap-2">
          {phase === 'ready' ? (
            <button
              type="button"
              onClick={() => setView(view === 'case' ? 'desk' : 'case')}
              className="rounded bg-ink-800 px-2 py-0.5 text-[10.5px] text-ash-300 transition-colors hover:bg-ink-700 hover:text-ash-100"
            >
              {view === 'case' ? 'desk' : 'bookcase'}
            </button>
          ) : null}
          {phase === 'ready' ? (
            <button
              type="button"
              onClick={() => void fork()}
              disabled={forked}
              className="rounded bg-brass-700 px-2.5 py-0.5 text-[10.5px] text-ash-100 transition-colors hover:bg-brass-600 disabled:opacity-60"
              title="Copy this shelf into your own library"
            >
              {forked ? 'copied — opening…' : 'fork to my shelf'}
            </button>
          ) : null}
          {/*
            Кнопка жалобы из §18. Обычная почтовая ссылка, а не форма: форма
            означала бы шестой эндпоинт и хранение чужих обращений, а адрес
            снимка человек и так видит в адресной строке.
          */}
          <a
            href={`mailto:abuse@r3ad.app?subject=${encodeURIComponent(`Report ${id}`)}`}
            className="text-[10.5px] text-ash-400 transition-colors hover:text-ash-200"
          >
            report
          </a>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {phase === 'ready' && boot === 'ready' ? (
          <Viewport />
        ) : (
          <div className="h-full w-full bg-ink-950" />
        )}

        {phase === 'loading' || boot === 'fonts' ? (
          <Centred>
            <span className="tabular text-[11.5px] text-ash-300">{stage}…</span>
          </Centred>
        ) : null}

        {phase === 'locked' ? (
          <Centred>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPhase('loading');
                setError(null);
                void load(secret);
              }}
              className="flex w-[300px] flex-col gap-2 rounded-lg border border-ink-700 bg-ink-900 p-4"
            >
              <span className="text-[11.5px] text-ash-100">This shelf is locked.</span>
              <span className="text-[10.5px] leading-snug text-ash-400">
                It was encrypted in the sender&rsquo;s browser. Whatever they told you goes here —
                the server never had it.
              </span>
              <input
                autoFocus
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="passphrase"
                className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-[12px] text-ash-100 outline-none focus:border-brass-600"
              />
              {error ? <Notice tone="error">{error}</Notice> : null}
              <button
                type="submit"
                className="rounded bg-brass-700 px-3 py-1.5 text-[11.5px] text-ash-100 hover:bg-brass-600"
              >
                Open
              </button>
            </form>
          </Centred>
        ) : null}

        {phase === 'failed' ? (
          <Centred>
            <div className="w-[320px]">
              <Notice tone="error">{error ?? 'That snapshot is not here.'}</Notice>
            </div>
          </Centred>
        ) : null}
      </main>
    </div>
  );
}

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ink-950/70 backdrop-blur-sm">
      {children}
    </div>
  );
}
