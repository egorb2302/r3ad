/**
 * Вырезка — то, во что сходятся все ссылки.
 *
 * Пять адаптеров (SPEC §10) достают из источника разное: у поста в X есть автор
 * и аватар, у статьи — заголовок и десять абзацев, у карточки OG — картинка и
 * две строки. Дальше по системе идёт только этот общий вид: страница тетради
 * рисует карточку, а скомпилированный том верстает главу, не зная, откуда
 * вырезка взялась. Разойдись это — каждый новый адаптер пришлось бы протаскивать
 * и через холст, и через типографику.
 *
 * Тело — список блоков, а не HTML. Причина не в удобстве, а в границе доверия:
 * разметку с чужого сайта пришлось бы санитизировать на клиенте и надеяться,
 * что санитайзер не обошли. Структурный список нечем эксплуатировать — в нём
 * нет ни тегов, ни атрибутов, только текст, — а обратно в HTML он собирается
 * нами, с экранированием (см. compile.ts).
 */

export type AdapterKind = 'x-post' | 'article' | 'og-card' | 'image' | 'paste';

/**
 * Блок нормализованного тела.
 *
 * Набор намеренно беден: всё, что не отображается ни карточкой на странице, ни
 * главой тома, вырезке не нужно. Картинка ссылается номером в `media`, а не
 * адресом: адрес к моменту показа уже не имеет смысла — байты лежат в
 * хранилище ассетов по хэшу.
 */
export type ContentBlock =
  | { type: 'para'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'media'; index: number };

export interface ClippingAuthor {
  name: string;
  /** @handle без собачки. Есть у поста, нет у статьи. */
  handle?: string;
  avatarHash?: string;
}

export interface ClippingMedia {
  assetHash: string;
  alt?: string;
  width: number;
  height: number;
}

/**
 * Атрибуция рендерится всегда и не отключается (SPEC §10).
 *
 * Поэтому она и лежит отдельным обязательным полем, а не «где-то в теле»: то,
 * что можно забыть отрисовать, рано или поздно забывают.
 */
export interface Attribution {
  sourceName: string;
  sourceUrl: string;
}

export interface Clipping {
  id: string;
  url: string;
  adapter: AdapterKind;
  fetchedAt: number;
  title?: string;
  author?: ClippingAuthor;
  /** Дата публикации источника, если он её объявил. */
  publishedAt?: number;
  body: ContentBlock[];
  media: ClippingMedia[];
  attribution: Attribution;
}

/* ─── То же самое, но по проводу ────────────────────────────────────────── */

/**
 * Картинка в ответе `/api/unfurl` едет байтами, а не адресом.
 *
 * Браузеру чужой адрес бесполезен: холст, на который попала картинка с другого
 * origin без CORS, становится tainted, и WebGL отказывается брать из него
 * текстуру — то есть вырезка не доехала бы ровно до страницы в 3D, ради которой
 * всё и делается. Второй проксирующий эндпоинт означал бы шестой в списке из
 * пяти (§14), поэтому байты кладутся прямо в ответ, с потолками из `net.ts`.
 *
 * Размеров здесь нет: их называет тот, кто картинку декодировал, а декодирует
 * её браузер (`createImageBitmap` в assets.ts). Сервер, чтобы назвать их сам,
 * должен был бы разбирать заголовки пяти форматов — ради числа, которое через
 * секунду и так станет известно точно.
 */
export interface WireMedia {
  dataUri: string;
  alt?: string;
}

/**
 * Ответ эндпоинта: та же вырезка, но ассеты ещё не разложены по хэшам —
 * хранилище живёт в браузере, и хэши считает он же (см. adopt.ts).
 */
export interface WireClipping {
  url: string;
  adapter: AdapterKind;
  fetchedAt: number;
  title?: string;
  author?: { name: string; handle?: string; avatar?: WireMedia };
  publishedAt?: number;
  body: ContentBlock[];
  media: WireMedia[];
  attribution: Attribution;
}

/** Потолки нормализации. Ниже них ни один адаптер не опускается. */
export const LIMITS = {
  /** Блоков в теле. Длинная статья — это тридцать абзацев, а не тысяча. */
  blocks: 400,
  /** Знаков в блоке. Всё, что длиннее, — не абзац, а слипшаяся страница. */
  blockChars: 4000,
  items: 40,
  media: 4,
  title: 200,
} as const;

/** Плоский текст вырезки — им считается объём будущего тома и превью в панели. */
export function clippingText(clipping: Clipping): string {
  const out: string[] = [];
  if (clipping.title) out.push(clipping.title);

  for (const block of clipping.body) {
    if (block.type === 'list') out.push(block.items.join(' '));
    else if (block.type !== 'media') out.push(block.text);
  }
  return out.join('\n');
}

/** Подпись под карточкой: «@handle» у поста, имя сайта у всего остального. */
export function bylineOf(clipping: Clipping): string {
  if (clipping.author?.handle) return `@${clipping.author.handle}`;
  if (clipping.author?.name) return clipping.author.name;
  return clipping.attribution.sourceName;
}
