'use client';

/** Мелкие кирпичи панелей. Держим в одном месте, чтобы панели читались как разметка. */
import type { ReactNode } from 'react';

export function Panel({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-ink-800">
      <header className="flex items-center justify-between px-3 py-2">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.13em] text-ash-400">{title}</h2>
        {right}
      </header>
      <div className="px-3 pb-3">{children}</div>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2.5 grid grid-cols-[74px_1fr] items-center gap-2 last:mb-0">
      <span className="text-[11px] text-ash-400">{label}</span>
      {children}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="tabular w-[52px] shrink-0 text-right text-[11px] text-ash-200">
        {value}
        {suffix ? <span className="text-ash-400">{suffix}</span> : null}
      </span>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`h-[22px] rounded px-2 text-[11px] transition-colors ${
        checked
          ? 'bg-ink-600 text-ash-100'
          : 'bg-ink-800 text-ash-400 hover:text-ash-300'
      }`}
      aria-pressed={checked}
    >
      {label}
    </button>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between py-[3px]">
      <span className="text-[11px] text-ash-400">{label}</span>
      <span className="tabular text-[11px] text-ash-200" title={hint}>
        {value}
      </span>
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-[22px] w-full rounded border border-ink-700 bg-ink-850 px-1.5 text-[11px] text-ash-200 outline-none focus:border-ink-600"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Предупреждение от разбора файла: книга открылась, но не целиком. */
export function Notice({ tone, children }: { tone: 'warn' | 'error'; children: ReactNode }) {
  return (
    <p
      className={`rounded border px-2 py-1.5 text-[10.5px] leading-snug ${
        tone === 'error'
          ? 'border-red-900/70 bg-red-950/40 text-red-300'
          : 'border-brass-900/60 bg-brass-950/30 text-brass-300'
      }`}
    >
      {children}
    </p>
  );
}
