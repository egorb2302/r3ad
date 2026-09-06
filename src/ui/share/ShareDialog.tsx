'use client';

/**
 * Диалог шеринга — сценарий §4.3 целиком, на одном экране.
 *
 * Порядок вопросов задан §11.2 и не переставляется: сперва **что кладём**, и
 * дефолт здесь минимальный, потом замок, и только потом кнопка. Объём,
 * предложенный последним, читался бы как формальность — а это единственное
 * решение в диалоге, которое нельзя отозвать: ссылку уже отправили.
 *
 * Рядом с объёмом всегда стоят цифры того, что уедет. Разговор про приватность
 * ведётся не абзацем про приватность, а строкой «12 томов · 2 тетради · 31 МБ»:
 * её читают, а абзац — нет.
 */
import { useEffect } from 'react';
import type { ShareScope } from '@/core/share/bundle';
import type { LockKind } from '@/core/share/lock';
import { useShare } from '@/store/useShare';
import { Notice } from '../primitives';

const SCOPES: { value: ShareScope; label: string; hint: string }[] = [
  {
    value: 'appearance',
    label: 'The look of it',
    hint: 'Spines, titles, colours, thickness. Nothing you wrote or opened leaves this machine.',
  },
  {
    value: 'journal',
    label: 'Notebooks too',
    hint: 'Pages, strokes, pasted screenshots and clippings travel with the shelf.',
  },
  {
    value: 'volume',
    label: 'Books as well',
    hint: 'The files you opened are uploaded in full.',
  },
];

const LOCKS: { value: LockKind; label: string; hint: string }[] = [
  { value: 'none', label: 'Open', hint: 'Anyone with the link reads it. The server can too.' },
  {
    value: 'link',
    label: 'Key in the link',
    hint: 'Encrypted here; the key rides in the # of the URL, which browsers never send.',
  },
  {
    value: 'passphrase',
    label: 'Passphrase',
    hint: 'The key is derived from a phrase you tell them separately. It is in no link.',
  },
];

export function ShareDialog() {
  const open = useShare((s) => s.open);
  const toggle = useShare((s) => s.toggle);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, toggle]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) toggle(false);
      }}
    >
      <Body />
    </div>
  );
}

function Body() {
  const title = useShare((s) => s.title);
  const scope = useShare((s) => s.scope);
  const lock = useShare((s) => s.lock);
  const passphrase = useShare((s) => s.passphrase);
  const status = useShare((s) => s.status);
  const stage = useShare((s) => s.stage);
  const progress = useShare((s) => s.progress);
  const error = useShare((s) => s.error);
  const preview = useShare((s) => s.preview);
  const link = useShare((s) => s.link);
  const compact = useShare((s) => s.compact);

  const setTitle = useShare((s) => s.setTitle);
  const setScope = useShare((s) => s.setScope);
  const setLock = useShare((s) => s.setLock);
  const setPassphrase = useShare((s) => s.setPassphrase);
  const share = useShare((s) => s.share);
  const revoke = useShare((s) => s.revoke);
  const exportFile = useShare((s) => s.exportFile);
  const toggle = useShare((s) => s.toggle);

  const busy = status === 'working';

  return (
    <div className="flex max-h-full w-[440px] flex-col overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
      <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
        <h2 className="text-[12px] font-medium text-ash-100">Share this shelf</h2>
        <button
          type="button"
          onClick={() => toggle(false)}
          className="rounded px-1.5 text-[11px] text-ash-400 hover:bg-ink-800 hover:text-ash-100"
        >
          esc
        </button>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.13em] text-ash-400">Name</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="A shelf"
            className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-[12px] text-ash-100 outline-none focus:border-brass-600"
          />
        </label>

        <section className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.13em] text-ash-400">What goes in</span>
          {SCOPES.map((option) => (
            <Choice
              key={option.value}
              checked={scope === option.value}
              label={option.label}
              hint={option.hint}
              onSelect={() => setScope(option.value)}
            />
          ))}

          {/*
            Предупреждение из §18 — прямое и на своём месте: рядом с тем самым
            переключателем, а не в подвале. «Публикуете содержимое файла» — это
            то, что человек должен прочесть до нажатия, а не после.
          */}
          {scope === 'volume' ? (
            <div className="mt-1">
              <Notice tone="warn">
                You are publishing the contents of the files you opened. Do this with your own text,
                or with something you are allowed to pass on.
              </Notice>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.13em] text-ash-400">Lock</span>
          {LOCKS.map((option) => (
            <Choice
              key={option.value}
              checked={lock === option.value}
              label={option.label}
              hint={option.hint}
              onSelect={() => setLock(option.value)}
            />
          ))}

          {lock === 'passphrase' ? (
            <input
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              type="password"
              placeholder="a phrase you will pass on by hand"
              className="mt-1 rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-[12px] text-ash-100 outline-none focus:border-brass-600"
            />
          ) : null}
        </section>

        {preview ? (
          <p className="tabular rounded border border-ink-800 bg-ink-850 px-2.5 py-2 text-[11px] text-ash-400">
            {[
              `${preview.volumes} ${preview.volumes === 1 ? 'volume' : 'volumes'}`,
              preview.journals > 0 ? `${preview.journals} notebooks · ${preview.pages} pages` : null,
              preview.clippings > 0 ? `${preview.clippings} clippings` : null,
              `${(preview.assetBytes / 1024 / 1024).toFixed(1)} MB of assets`,
              `${(preview.manifestBytes / 1024).toFixed(0)} KB of manifest`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}

        {error ? <Notice tone="error">{error}</Notice> : null}

        {busy ? (
          <p className="tabular text-[11px] text-brass-400">
            {stage}
            {progress.total > 0 ? ` — ${progress.done} of ${progress.total}` : ''}…
          </p>
        ) : null}

        {link ? <Result /> : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void share()}
            className="rounded bg-brass-700 px-3 py-1.5 text-[11.5px] text-ash-100 transition-colors hover:bg-brass-600 disabled:opacity-50"
          >
            {link ? 'Publish a new version' : 'Get a link'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportFile()}
            className="rounded bg-ink-800 px-3 py-1.5 text-[11.5px] text-ash-300 transition-colors hover:bg-ink-700 hover:text-ash-100 disabled:opacity-50"
            title="The same bundle, as a file. No server involved."
          >
            Export .r3ad
          </button>
          {link ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void revoke()}
              className="ml-auto rounded px-2 py-1.5 text-[11px] text-ash-400 transition-colors hover:text-red-300"
            >
              take it down
            </button>
          ) : null}
        </div>

        {/*
          Первый уровень §11.1. Показывается только там, где он честен: полка
          целиком в полтора килобайта, без сервера, без TTL и без счёта за
          трафик. Для объёмов выше он не существует — и об этом сказано, а не
          умолчано.
        */}
        {compact && scope === 'appearance' ? (
          <section className="flex flex-col gap-1.5 border-t border-ink-800 pt-3">
            <span className="text-[10px] uppercase tracking-[0.13em] text-ash-400">
              Or with no server at all
            </span>
            <p className="text-[10.5px] leading-snug text-ash-400">
              The whole shelf fits in the address — {compact.length} characters. It has no
              expiry, costs nothing to serve, and works from a static copy of the site.
            </p>
            <Copyable value={compact} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Result() {
  const link = useShare((s) => s.link)!;

  return (
    <section className="flex flex-col gap-1.5 rounded border border-brass-800/60 bg-brass-950/20 px-2.5 py-2">
      <span className="text-[10px] uppercase tracking-[0.13em] text-brass-500">
        Version {link.version} · unlisted
      </span>
      <Copyable value={link.url} />
      <p className="text-[10.5px] leading-snug text-ash-400">
        {link.locked === 'passphrase'
          ? 'Locked. Tell them the phrase some other way — it is not in this link.'
          : link.locked === 'link'
            ? 'Locked. The key after the # never reaches the server; keep it on the link.'
            : 'Anyone with this link can read it. It is not indexed.'}{' '}
        The right to update or delete it lives in this browser.
      </p>
    </section>
  );
}

function Copyable({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="tabular min-w-0 flex-1 truncate rounded border border-ink-700 bg-ink-850 px-2 py-1 text-[11px] text-ash-200 outline-none"
      />
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(value)}
        className="shrink-0 rounded bg-ink-800 px-2 py-1 text-[11px] text-ash-300 transition-colors hover:bg-ink-700 hover:text-ash-100"
      >
        copy
      </button>
    </div>
  );
}

function Choice({
  checked,
  label,
  hint,
  onSelect,
}: {
  checked: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={`rounded border px-2.5 py-2 text-left transition-colors ${
        checked
          ? 'border-brass-700/70 bg-ink-800'
          : 'border-ink-800 bg-ink-850 hover:border-ink-700'
      }`}
    >
      <span className={`block text-[11.5px] ${checked ? 'text-ash-100' : 'text-ash-300'}`}>
        {label}
      </span>
      <span className="mt-0.5 block text-[10.5px] leading-snug text-ash-400">{hint}</span>
    </button>
  );
}
