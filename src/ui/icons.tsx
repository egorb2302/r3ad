'use client';

/**
 * Символы оболочки: лого и кнопки шапки, плитки инспектора.
 *
 * Нарисованы под проект, как и инструменты тетради (SPEC §12.4): 16×16,
 * обводка 1.3, скруглённые концы — тот же вес, что и у текста панелей, и тот
 * же, что у `journal/icons`, иначе кнопка «поделиться» в шапке выглядела бы
 * тяжелее «пера» в тулбаре под ней.
 */
import type { ReactNode } from 'react';

/**
 * Лого — раскрытая книга. Тот же рисунок, что в `app/icon.svg`: вкладка и
 * шапка обязаны показывать одну и ту же вещь, а не две похожих.
 */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect width="64" height="64" rx="17" fill="#17130f" />
      <path
        d="M31 21.5C26 17.6 18.6 16.2 13 17.2Q10.4 17.7 10.4 20.3V43.6Q10.4 46.4 13.1 46C18.8 45.1 26 45.8 31 49.6Z"
        fill="#f0d29a"
      />
      <path
        d="M33 21.5C38 17.6 45.4 16.2 51 17.2Q53.6 17.7 53.6 20.3V43.6Q53.6 46.4 50.9 46C45.2 45.1 38 45.8 33 49.6Z"
        fill="#e0ad55"
      />
      <path d="M32 22.5V49.4" stroke="#17130f" strokeWidth={2.6} strokeLinecap="round" />
      <path
        d="M15.4 25.6h10.2M15.4 31h11.2M15.4 36.4h8.6M38.4 25.6h10.2M38.4 31h11.2M38.4 36.4h8.6"
        stroke="#17130f"
        strokeOpacity={0.32}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </svg>
  );
}

const shapes = {
  /* Шапка */
  panels: 'M2.6 3.4h10.8v9.2H2.6z M5.6 3.4v9.2 M10.4 3.4v9.2',
  text: 'M2.6 4h10.8 M2.6 7h10.8 M2.6 10h7.6 M2.6 13h4.6',
  search: 'M6.8 2.8a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M9.8 9.8l3.6 3.6',
  share: 'M8 2.6V10 M5.2 5.4L8 2.6l2.8 2.8 M3.4 8.8v4.4h9.2V8.8',
  shelve: 'M2.6 13.4h10.8 M4.2 13.4V5.2h3v8.2 M8.6 13.4V3h3v10.4',
  desk: 'M2 6.6h12 M3.6 6.6V13 M12.4 6.6V13 M5.2 6.6V4.4a1.2 1.2 0 0 1 1.2-1.2h3.2a1.2 1.2 0 0 1 1.2 1.2v2.2',
  bookcase: 'M2.6 2.6h10.8v10.8H2.6z M2.6 8h10.8 M5.2 4.2v3.8 M7.4 4.2v3.8 M9.4 9.4v3.8 M11.4 9.4v3.8',
  more: 'M3.6 8h.01 M8 8h.01 M12.4 8h.01',
  close: 'M4 4l8 8 M12 4l-8 8',
  back: 'M10 3L5 8l5 5',
  /* Плитки инспектора */
  source: 'M4 2.5h5.5l3 3v8H4z M9.5 2.5v3h3 M6 8.6h4.5 M6 11h4.5',
  binding:
    'M3.5 3h8a1.5 1.5 0 0 1 1.5 1.5V13H5a1.5 1.5 0 0 1-1.5-1.5z M3.5 11.5A1.5 1.5 0 0 1 5 10h8 M5.8 5.6h4.6',
  paper: 'M3.5 2.5h9V10l-3.5 3.5h-5.5z M9 13.5V10h3.5',
  type: 'M2.4 12.6L6 3.4l3.6 9.2 M3.7 9.5h4.6 M13.4 8.4v4.2 M13.4 10.5a2.1 2.1 0 1 0-4.2 0a2.1 2.1 0 0 0 4.2 0',
  margins: 'M2.6 2.6h10.8v10.8H2.6z M5.4 5.4h5.2v5.2H5.4z',
  volume: 'M2.6 5.2h10.8v8.2H2.6z M2.6 8h10.8 M2.6 10.6h10.8 M5 2.6h6v2.6',
  scene: 'M5.2 2.6h5.6l2.2 5.4H3z M8 8v4.6 M5.2 13.4h5.6',
  storage: 'M2.6 5.4L8 2.6l5.4 2.8v5.2L8 13.4l-5.4-2.8z M2.6 5.4L8 8.2l5.4-2.8 M8 8.2v5.2',
  raster: 'M2.6 2.6h10.8v10.8H2.6z M2.6 6.2h10.8 M2.6 9.8h10.8 M6.2 2.6v10.8 M9.8 2.6v10.8',
  notebook: 'M4.2 2.8h8.2v10.4H4.2z M4.2 5.4H2.8 M4.2 8H2.8 M4.2 10.6H2.8 M6.6 6.4h3.6 M6.6 9h3.6',
  page: 'M4 2.5h8v11H4z M6.2 5.6h3.6 M6.2 8h3.6 M6.2 10.4h2.2',
  layers: 'M8 2.8l5.6 3L8 8.8 2.4 5.8z M2.4 9.2L8 12.2l5.6-3',
  selection: 'M2.8 2.8h2.6 M8 2.8h2.6 M13.2 2.8v2.6 M13.2 8v2.6 M13.2 13.2h-2.6 M8 13.2H5.4 M2.8 13.2v-2.6 M2.8 8V5.4',
  room: 'M2.6 7.4L8 2.8l5.4 4.6 M4.2 6.2v7.2h7.6V6.2 M6.8 13.4V9.6h2.4v3.8',
} as const;

export type IconName = keyof typeof shapes;

export function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d={shapes[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth={name === 'more' ? 2.2 : 1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Кнопка шапки: квадрат под иконку, подпись — только во всплывающей подсказке. */
export function IconButton({
  label,
  active,
  onClick,
  children,
  accent,
}: {
  label: string;
  active?: boolean;
  accent?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-brass-500/20 text-brass-300'
          : accent
            ? 'bg-brass-700 text-ash-100 hover:bg-brass-600'
            : 'text-ash-400 hover:bg-ink-800 hover:text-ash-100'
      }`}
    >
      {children}
    </button>
  );
}
