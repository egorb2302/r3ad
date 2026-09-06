/**
 * Тема: всё, из чего книга и сцена сделаны на вид.
 *
 * То, ради чего в профиле вообще заводится 3D (SPEC §8). Ассетов здесь нет ни
 * одного: материал переплёта, тиснение, окраска среза, тон и плотность бумаги,
 * порода дерева и свет — это параметры, а не файлы. Отсюда и главное свойство
 * темы: она сериализуется в полсотни байт и едет в снимке, поэтому чужая полка
 * выглядит у получателя ровно так же, как у автора.
 *
 * Три решения, которые определяют всё остальное в этом файле.
 *
 * **Тема — единственный источник правды о внешности.** Палитра корешка из неё
 * выводится (`paletteOf`), а не лежит рядом отдельным полем. Пока лежала — а до
 * M6 лежала, — цвет крышки и цвет корешка были двумя разными числами, и любой
 * их разъезд означал книгу, которая на столе одна, а на полке другая.
 *
 * **У темы есть выведенное состояние.** Дефолт считается из названия и автора
 * детерминированным хэшем: полка из сорока одинаковых книг — не полка, а
 * коробка. Поэтому «тему не трогали» и «тема такая-то» — разные вещи, и первое
 * не нужно ни хранить, ни передавать: в короткой ссылке (§11.1) тема пишется
 * только у тех томов, где она отличается от выводимой.
 *
 * **Плотность бумаги — единственный параметр внешности, меняющий геометрию.**
 * Гсм задаёт толщину листа, лист — толщину блока, блок — место тома на полке.
 * При этом в ключ вёрстки плотность не входит: страниц от неё не прибавляется,
 * книга просто становится толще. Это и делает ползунок наглядным — число
 * страниц стоит на месте, а корешок пухнет.
 */
import {
  CLOTH_HUES,
  clothFor,
  clothFromColor,
  hashString,
  hexToHsl,
  hslToHex,
  type Hsl,
  type SpinePalette,
} from './library/palette';
import { DEFAULT_GSM } from './units';

export type CoverMaterial = 'cloth' | 'leather' | 'board' | 'jacket';
export type FoilKind = 'gold' | 'silver' | 'blind' | 'none';
export type EdgeKind = 'plain' | 'sprayed' | 'gilded' | 'marbled';
export type PaperTint = 'white' | 'cream' | 'aged';
export type ScenePreset = 'lamp' | 'daylight' | 'evening' | 'studio';
export type WoodSpecies = 'oak' | 'walnut' | 'birch' | 'ebony';

export interface CoverTheme {
  material: CoverMaterial;
  /** Основной цвет тома: крышки, корешок и поле под тиснением. */
  color: string;
  foil: FoilKind;
  /** Потёртость: 0 — из типографии, 1 — из букинистического. */
  wear: number;
}

export interface PaperTheme {
  tint: PaperTint;
  /** Плотность, г/м². Через неё — толщина листа и всего тома. */
  gsm: number;
  edge: EdgeKind;
  /**
   * Краска среза. Для `plain` не значит ничего и всё равно хранится: иначе
   * переключение туда-обратно теряло бы подобранный цвет.
   */
  edgeColor: string;
}

export interface BookTheme {
  cover: CoverTheme;
  paper: PaperTheme;
  /** Лента-закладка. `null` — её нет; у большинства книг её и не бывает. */
  ribbon: string | null;
}

/**
 * Сцена вокруг книг.
 *
 * Одна на весь стеллаж, а не на том: свет — это комната, а не вещь в ней.
 * Что именно значит «lamp» или «evening», знает сцена (scene/lighting.ts);
 * здесь только имя пресета. Ядро про three.js не знает — то же правило, по
 * которому в бандле лежит `view: 'desk' | 'case'`, а не позиция камеры.
 */
export interface SceneTheme {
  preset: ScenePreset;
  /**
   * Экспозиция тонмаппинга. Не яркость источников: пресет задаёт светотень,
   * ползунок — общий уровень, и разводить их важно ради снимка — тёмная сцена
   * на чужом экране светлеет целиком, а не выцветает в бликах.
   */
  exposure: number;
  /** Сила контактной тени под книгой и под стеллажом. */
  shadows: number;
  wood: WoodSpecies;
}

export const DEFAULT_SCENE: SceneTheme = {
  preset: 'lamp',
  exposure: 1,
  shadows: 0.55,
  wood: 'walnut',
};

/* ─── Бумага ────────────────────────────────────────────────────────────── */

export interface PaperStock {
  /** Фон страницы при растеризации — он же тон разворота. */
  page: string;
  /** Бумага блока в 3D: торцы стопки и заглушка под текстуру. */
  block: string;
  /** Основа обреза, поверх которой рисуются слои листов. */
  edge: string;
  /** Цвет набора. На состаренной бумаге чёрная краска выглядит напечатанной вчера. */
  ink: string;
}

export const PAPERS: Record<PaperTint, PaperStock> = {
  white: { page: '#f8f6f2', block: '#f1ede6', edge: '#eae6dc', ink: '#17140f' },
  cream: { page: '#f6f1e6', block: '#efe6d4', edge: '#e8dfcd', ink: '#1b1712' },
  aged: { page: '#efe4cb', block: '#e6d8ba', edge: '#dccca9', ink: '#26200f' },
};

/* ─── Палитра переплёта ─────────────────────────────────────────────────── */

/** Краска тиснения. `blind` — тиснение без краски, поэтому цвет берётся от крышки. */
const FOIL_INK: Record<FoilKind, string | null> = {
  gold: '#d8b25c',
  silver: '#c9ced6',
  blind: null,
  none: null,
};

/**
 * Цвета корешка из темы.
 *
 * Накладка отбивается от поля светлотой, а не другим тоном: у переплёта это тот
 * же материал, только другой прокрас. Каптал берут контрастным — обычно из
 * дополнительного тона, и на полке эта полоска в два миллиметра неожиданно
 * заметна.
 */
export function paletteOf(theme: BookTheme): SpinePalette {
  const cloth = hexToHsl(theme.cover.color);

  const panel: Hsl = {
    h: cloth.h,
    s: Math.min(cloth.s * 1.05, 0.6),
    l: cloth.l > 0.3 ? cloth.l - 0.12 : cloth.l + 0.1,
  };

  const ink = FOIL_INK[theme.cover.foil];
  const foil: Hsl = ink
    ? hexToHsl(ink)
    : /*
       * Блинт — след без краски: тот же цвет, но глубже. На тёмной крышке
       * вдавленность не видна вовсе, и её приходится показывать осветлением, —
       * ровно так же, как это делает на переплёте боковой свет.
       */
      { h: cloth.h, s: cloth.s * 0.6, l: cloth.l < 0.3 ? cloth.l + 0.14 : cloth.l - 0.22 };

  return {
    cloth: theme.cover.color,
    panel: hslToHex(panel),
    foil: hslToHex(foil),
    head: hslToHex({ h: (cloth.h + 170) % 360, s: 0.42, l: 0.56 }),
  };
}

/** Печатается ли на корешке и крышке тиснение вообще. */
export const stamped = (theme: BookTheme) => theme.cover.foil !== 'none';

/* ─── Дефолты ───────────────────────────────────────────────────────────── */

/**
 * Материал по хэшу.
 *
 * Доли подобраны так, как выглядит полка сегодняшних изданий: ткань и картон —
 * основная масса, супер-обложки вокруг, кожа редкость. До этого кожа шла
 * второй, и полка из сорока томов выглядела кабинетом нотариуса. Ряд из сорока
 * одинаково одетых книг всё равно читается как стопка коробок, а не как
 * библиотека, — отсюда четыре материала, а не один.
 */
function materialFor(hash: number): CoverMaterial {
  const roll = hash % 100;
  if (roll < 52) return 'cloth';
  if (roll < 78) return 'board';
  if (roll < 94) return 'jacket';
  return 'leather';
}

/** Тема из цвета крышки. Всё остальное — производные и умолчания. */
function themeFromCloth(cloth: string, hash: number): BookTheme {
  const { l } = hexToHsl(cloth);

  return {
    cover: {
      material: materialFor(hash),
      color: cloth,
      // Золото на тёмном поле, блинт — на светлом: на светлой ткани золото
      // почти того же тона, что и краска крышки, и тиснение пропадает.
      foil: l < 0.36 ? 'gold' : 'blind',
      // Из типографии, а не из букинистики: потёрт лишь каждый пятый, и слегка.
      wear: (hash >>> 4) % 5 === 0 ? ((hash >>> 8) % 12) / 100 : 0,
    },
    paper: { tint: 'cream', gsm: DEFAULT_GSM, edge: 'plain', edgeColor: '#8d3f3f' },
    ribbon: null,
  };
}

/** Тема по названию и автору. Детерминирована: книга обязана оставаться собой. */
export function themeFor(seed: string): BookTheme {
  const { cloth, hash } = clothFor(seed);
  return themeFromCloth(cloth, hash);
}

/** Тема по доминанте обложки издания — тот же путь, другой источник цвета. */
export function themeFromCover(hsl: Hsl, seed: string): BookTheme {
  return themeWithCover(seed, clothFromColor(hsl));
}

/**
 * Тема с заданной краской крышки; всё прочее выводится, как обычно.
 *
 * Нужна там, где цвет уже известен, а темы ещё нет: у обложки издания и у
 * снимков, записанных до M6, — в них от внешности сохранён ровно цвет корешка.
 */
export function themeWithCover(seed: string, cloth: string): BookTheme {
  return themeFromCloth(cloth, clothFor(seed).hash);
}

/** Совпадает ли тема с выводимой из названия. Ответ решает, писать ли её в ссылку. */
export function isDerived(theme: BookTheme, seed: string): boolean {
  return JSON.stringify(theme) === JSON.stringify(themeFor(seed));
}

/**
 * Тема, какой её выводила версия до визуального прохода.
 *
 * Тёмные переплётные тона, кожа второй по частоте, потёртость у каждого —
 * полка нотариуса. Нужна ровно в одном месте: при подъёме бандла второй
 * версии (`share/bundle.ts`). Том, чью тему не трогали, обязан получить новую
 * выводимую, а том, который переодевали руками, — остаться в своём; отличить
 * одно от другого можно, только зная, что выводилось раньше. Правила
 * повторены здесь буквально, а не вызваны: они и есть то, что изменилось.
 */
export function legacyThemeFor(seed: string): BookTheme {
  const hash = hashString(seed);
  const cloth = hslToHex({
    h: CLOTH_HUES[hash % CLOTH_HUES.length],
    s: Math.min(Math.max(0.2 + ((hash >>> 8) % 22) / 100, 0.14), 0.52),
    l: Math.min(Math.max(0.19 + ((hash >>> 16) % 20) / 100, 0.15), 0.44),
  });
  const roll = hash % 100;
  const { l } = hexToHsl(cloth);

  return {
    cover: {
      material: roll < 50 ? 'cloth' : roll < 72 ? 'leather' : roll < 92 ? 'board' : 'jacket',
      color: cloth,
      foil: l < 0.34 ? 'gold' : 'blind',
      wear: ((hash >>> 4) % 26) / 100,
    },
    paper: { tint: 'cream', gsm: DEFAULT_GSM, edge: 'plain', edgeColor: '#8d3f3f' },
    ribbon: null,
  };
}

/* ─── Пресеты переплёта ─────────────────────────────────────────────────── */

/**
 * Готовые переплёты.
 *
 * Демо-момент вехи — «один кадр, десять разных книг», и держится он не на
 * ползунках, а на том, что десять внешностей набираются десятью щелчками.
 * Названия не украшение: это существующие переплётные традиции, и по ним видно,
 * что набор параметров описывает вещь, а не подобран случайно.
 */
export const BINDINGS: { name: string; theme: BookTheme }[] = [
  {
    name: 'Clothbound',
    theme: {
      cover: { material: 'cloth', color: '#3c4d63', foil: 'gold', wear: 0.12 },
      paper: { tint: 'cream', gsm: 80, edge: 'plain', edgeColor: '#8d3f3f' },
      ribbon: null,
    },
  },
  {
    name: 'Half calf',
    theme: {
      cover: { material: 'leather', color: '#5a3120', foil: 'gold', wear: 0.34 },
      paper: { tint: 'aged', gsm: 90, edge: 'gilded', edgeColor: '#c8a24a' },
      ribbon: '#8d2f33',
    },
  },
  {
    name: 'Oxford',
    theme: {
      cover: { material: 'leather', color: '#22303a', foil: 'gold', wear: 0.18 },
      paper: { tint: 'cream', gsm: 70, edge: 'gilded', edgeColor: '#c8a24a' },
      ribbon: '#1f5136',
    },
  },
  {
    name: 'Marbled boards',
    theme: {
      cover: { material: 'board', color: '#7c6547', foil: 'blind', wear: 0.42 },
      paper: { tint: 'aged', gsm: 95, edge: 'marbled', edgeColor: '#7a3a4a' },
      ribbon: null,
    },
  },
  {
    name: 'Paperback',
    theme: {
      cover: { material: 'jacket', color: '#c65a2e', foil: 'none', wear: 0.28 },
      paper: { tint: 'aged', gsm: 60, edge: 'plain', edgeColor: '#8d3f3f' },
      ribbon: null,
    },
  },
  {
    name: 'Sprayed',
    theme: {
      cover: { material: 'jacket', color: '#1d4f45', foil: 'silver', wear: 0.05 },
      paper: { tint: 'white', gsm: 100, edge: 'sprayed', edgeColor: '#c0396b' },
      ribbon: '#c0396b',
    },
  },
  {
    name: 'Nightshade',
    theme: {
      cover: { material: 'leather', color: '#221d2b', foil: 'silver', wear: 0.2 },
      paper: { tint: 'white', gsm: 85, edge: 'sprayed', edgeColor: '#2b2440' },
      ribbon: '#5c4fa0',
    },
  },
  {
    name: 'Library board',
    theme: {
      cover: { material: 'board', color: '#5d6154', foil: 'none', wear: 0.5 },
      paper: { tint: 'aged', gsm: 110, edge: 'plain', edgeColor: '#8d3f3f' },
      ribbon: null,
    },
  },
];

/* ─── Списки для панелей ────────────────────────────────────────────────── */

export const MATERIALS: readonly { value: CoverMaterial; label: string }[] = [
  { value: 'cloth', label: 'Cloth' },
  { value: 'leather', label: 'Leather' },
  { value: 'board', label: 'Board' },
  { value: 'jacket', label: 'Jacket' },
];

export const FOILS: readonly { value: FoilKind; label: string }[] = [
  { value: 'gold', label: 'Gold' },
  { value: 'silver', label: 'Silver' },
  { value: 'blind', label: 'Blind' },
  { value: 'none', label: 'None' },
];

export const EDGES: readonly { value: EdgeKind; label: string }[] = [
  { value: 'plain', label: 'Plain' },
  { value: 'sprayed', label: 'Sprayed' },
  { value: 'gilded', label: 'Gilded' },
  { value: 'marbled', label: 'Marbled' },
];

export const TINTS: readonly { value: PaperTint; label: string }[] = [
  { value: 'white', label: 'White' },
  { value: 'cream', label: 'Cream' },
  { value: 'aged', label: 'Aged' },
];

export const PRESETS: readonly { value: ScenePreset; label: string }[] = [
  { value: 'lamp', label: 'Desk lamp' },
  { value: 'daylight', label: 'Daylight' },
  { value: 'evening', label: 'Evening' },
  { value: 'studio', label: 'Studio' },
];

export const WOODS: readonly { value: WoodSpecies; label: string }[] = [
  { value: 'oak', label: 'Oak' },
  { value: 'walnut', label: 'Walnut' },
  { value: 'birch', label: 'Birch' },
  { value: 'ebony', label: 'Ebony' },
];

/* ─── Упаковка в ссылку ─────────────────────────────────────────────────── */

/*
 * Тема в короткой ссылке (§11.1).
 *
 * Полтора килобайта на всю полку — бюджет, в который JSON темы (полтораста
 * знаков на том) не помещается и вдесятером. Отсюда буквенные коды и
 * фиксированный порядок полей: тема укладывается в тринадцать знаков, а у
 * нетронутой книги не занимает ни одного — она выводится из названия.
 */
const MATERIAL_CODE: Record<CoverMaterial, string> = {
  cloth: 'c',
  leather: 'l',
  board: 'b',
  jacket: 'j',
};
const FOIL_CODE: Record<FoilKind, string> = { gold: 'g', silver: 's', blind: 'b', none: 'n' };
const TINT_CODE: Record<PaperTint, string> = { white: 'w', cream: 'c', aged: 'a' };
const EDGE_CODE: Record<EdgeKind, string> = {
  plain: 'p',
  sprayed: 's',
  gilded: 'g',
  marbled: 'm',
};

function decodeKey<T extends string>(codes: Record<T, string>, char: string, fallback: T): T {
  return (Object.keys(codes) as T[]).find((key) => codes[key] === char) ?? fallback;
}

const hex6 = (color: string) => color.replace('#', '').slice(0, 6).padStart(6, '0');

export function encodeTheme(theme: BookTheme): string {
  const head = [
    MATERIAL_CODE[theme.cover.material],
    FOIL_CODE[theme.cover.foil],
    TINT_CODE[theme.paper.tint],
    EDGE_CODE[theme.paper.edge],
    hex6(theme.cover.color),
    Math.round(theme.cover.wear * 9),
    Math.round(theme.paper.gsm).toString(36).padStart(2, '0'),
  ].join('');

  // Хвосты пишем, только когда они значат: срез с краской и лента есть не у
  // всякой книги, а платить за них хочется там, где они видны.
  const edge = theme.paper.edge === 'plain' ? '' : `+${hex6(theme.paper.edgeColor)}`;
  const ribbon = theme.ribbon ? `~${hex6(theme.ribbon)}` : '';
  return head + edge + ribbon;
}

export function decodeTheme(code: string, fallback: BookTheme): BookTheme {
  if (code.length < 13) return fallback;

  const edgeAt = code.indexOf('+');
  const ribbonAt = code.indexOf('~');
  const pick = (at: number) => (at < 0 ? null : `#${code.slice(at + 1, at + 7)}`);

  return {
    cover: {
      material: decodeKey(MATERIAL_CODE, code[0], 'cloth'),
      color: `#${code.slice(4, 10)}`,
      foil: decodeKey(FOIL_CODE, code[1], 'gold'),
      wear: Math.min(9, Number(code[10]) || 0) / 9,
    },
    paper: {
      tint: decodeKey(TINT_CODE, code[2], 'cream'),
      gsm: parseInt(code.slice(11, 13), 36) || DEFAULT_GSM,
      edge: decodeKey(EDGE_CODE, code[3], 'plain'),
      edgeColor: pick(edgeAt) ?? fallback.paper.edgeColor,
    },
    ribbon: pick(ribbonAt),
  };
}

/** Сцена в ссылку: четыре знака на всю полку. */
export function encodeScene(scene: SceneTheme): string {
  return [
    scene.preset[0],
    scene.wood[0],
    Math.round(scene.exposure * 9),
    Math.round(scene.shadows * 9),
  ].join('');
}

export function decodeScene(code: string): SceneTheme {
  if (code.length < 4) return DEFAULT_SCENE;

  return {
    preset: PRESETS.find((p) => p.value[0] === code[0])?.value ?? DEFAULT_SCENE.preset,
    wood: WOODS.find((w) => w.value[0] === code[1])?.value ?? DEFAULT_SCENE.wood,
    exposure: (Number(code[2]) || 9) / 9,
    shadows: (Number(code[3]) || 5) / 9,
  };
}
