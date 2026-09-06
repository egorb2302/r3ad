'use client';

/**
 * Шеринг: ссылка на полку, файл `.r3ad`, форк чужого и сохранение своего.
 *
 * Четыре сценария, у которых общая середина — бандл (core/share/bundle.ts).
 * Отличаются они только тем, куда он едет и откуда приезжает, поэтому и стор
 * один: три отдельных завели бы три расходящихся представления о том, что
 * такое «моя полка».
 *
 * Сохранение в локальную базу живёт здесь же, внизу файла, подпиской на сторы.
 * Не в компоненте — иначе полка перестала бы сохраняться, стоило скрыть панели;
 * не в самих сторах — иначе каждый из них знал бы про базу и про два соседних.
 *
 * `manageToken` — единственное, что делает снапшот «моим» без аккаунта (§11.3).
 * Он лежит в localStorage: потерялся — снапшот остаётся жить и читаться, но
 * обновить и снести его больше некому. Так и задумано, и об этом сказано в
 * диалоге.
 *
 * Рядом с токеном лежит и сама ссылка. Токен без ссылки бесполезен: после
 * перезагрузки диалог показывал «Get a link», хотя право снести или обновить
 * снапшот в этом браузере было, — и снести его можно было только руками через
 * API. Теперь открытый диалог поднимает последнюю опубликованную ссылку, если
 * токен на неё ещё здесь.
 */
import { create } from 'zustand';
import { assetBlob } from '@/core/assets';
import {
  bundleStats,
  parseBundle,
  referencedAssets,
  type Bundle,
  type BundleStats,
  type ShareScope,
} from '@/core/share/bundle';
import { COMPACT_MAX, packShelf, shelfFromVolumes, unpackShelf, volumesFromShelf } from '@/core/share/compact';
import type { LockKind } from '@/core/share/lock';
import { packBundle, packFileName, unpackBundle } from '@/core/share/pack';
import { fetchSnapshot, openSnapshot, publish, removeSnapshot } from '@/core/share/publish';
import { loadBundle, pruneAssets, restoreAssets, saveBundle } from '@/db/local';
import { applyBundle, currentBundle } from './hydrate';
import { useClips } from './useClips';
import { useJournal } from './useJournal';
import { useLibrary } from './useLibrary';
import { useTheme } from './useTheme';

export interface ShareLink {
  id: string;
  /** Полный адрес со схемой и доменом — его и копируют. */
  url: string;
  version: number;
  scope: ShareScope;
  locked: LockKind;
}

interface ShareState {
  open: boolean;
  title: string;
  scope: ShareScope;
  lock: LockKind;
  passphrase: string;

  status: 'idle' | 'measuring' | 'working' | 'done' | 'error';
  stage: string;
  progress: { done: number; total: number };
  error: string | null;

  /** Что уедет при текущем объёме. Пересчитывается при смене объёма. */
  preview: BundleStats | null;
  link: ShareLink | null;
  /** Короткая ссылка `?s=` — есть, только если полка в неё помещается. */
  compact: string | null;
  /**
   * На экране чужая полка, пришедшая из адреса.
   *
   * Пока это так, в базу не пишется ничего: `?s=` — это «покажи мне вот эту
   * полку», и своя обязана дождаться в базе, а не быть затёртой чужой (та же
   * причина, что и у `pausePersistence` ниже).
   */
  shared: boolean;

  toggle: (open: boolean) => void;
  setTitle: (title: string) => void;
  setScope: (scope: ShareScope) => void;
  setLock: (lock: LockKind) => void;
  setPassphrase: (passphrase: string) => void;

  measure: () => Promise<void>;
  share: () => Promise<void>;
  revoke: () => Promise<void>;

  exportFile: () => Promise<void>;
  importFile: (file: Blob) => Promise<void>;
  fork: (bundle: Bundle, assets: Map<string, Blob>) => Promise<void>;
  /** Оставить показанную полку себе — форк для короткой ссылки. */
  keep: () => Promise<void>;
  reset: () => void;
}

const MANAGE_PREFIX = 'r3ad.manage.';

function rememberToken(id: string, token: string) {
  try {
    localStorage.setItem(MANAGE_PREFIX + id, token);
  } catch {
    /* приватное окно — снапшот останется чужим даже для того, кто его сделал */
  }
}

function recallToken(id: string): string | null {
  try {
    return localStorage.getItem(MANAGE_PREFIX + id);
  } catch {
    return null;
  }
}

function forgetToken(id: string) {
  try {
    localStorage.removeItem(MANAGE_PREFIX + id);
  } catch {
    /* см. выше */
  }
}

/**
 * Последняя опубликованная ссылка — одна: диалог держит одну, и обновляет её же.
 * Поднимается только вместе с токеном: ссылка без права на снапшот — это
 * просто адрес, и показывать её как «мою» было бы неправдой.
 */
const LINK_KEY = 'r3ad.link';

function rememberLink(link: ShareLink) {
  try {
    localStorage.setItem(LINK_KEY, JSON.stringify(link));
  } catch {
    /* приватное окно */
  }
}

function recallLink(): ShareLink | null {
  try {
    const raw = localStorage.getItem(LINK_KEY);
    if (!raw) return null;
    const link = JSON.parse(raw) as ShareLink;
    if (typeof link?.id !== 'string' || typeof link.url !== 'string') return null;
    return recallToken(link.id) ? link : null;
  } catch {
    return null;
  }
}

function forgetLink() {
  try {
    localStorage.removeItem(LINK_KEY);
  } catch {
    /* см. выше */
  }
}

/** Название снимка по умолчанию: то, что на столе, иначе — вся полка. */
function defaultTitle(): string {
  const library = useLibrary.getState();
  if (library.view !== 'case' && library.desk) return library.desk.title;
  return `A shelf of ${library.volumes.length}`;
}

export const useShare = create<ShareState>((set, get) => ({
  open: false,
  title: '',
  scope: 'appearance',
  lock: 'none',
  passphrase: '',

  status: 'idle',
  stage: '',
  progress: { done: 0, total: 0 },
  error: null,

  preview: null,
  link: null,
  compact: null,
  shared: false,

  toggle: (open) => {
    set({ open, error: null });
    if (open) {
      if (!get().title) set({ title: defaultTitle() });
      /*
       * Поднять опубликованное. Объём и замок — те, с которыми публиковали:
       * «новая версия» обязана уехать тем же составом, а не дефолтным.
       */
      if (!get().link) {
        const link = recallLink();
        if (link) set({ link, scope: link.scope, lock: link.locked });
      }
      void get().measure();
    }
  },

  setTitle: (title) => set({ title }),
  setScope: (scope) => {
    set({ scope, link: null, status: 'idle' });
    void get().measure();
  },
  setLock: (lock) => set({ lock, link: null, status: 'idle' }),
  setPassphrase: (passphrase) => set({ passphrase }),

  /**
   * Показать, что именно уедет.
   *
   * Дефолт объёма — минимальный (§11.2), и человек должен видеть цену перед
   * тем, как его повысить: «12 томов, 0 МБ» против «12 томов, 2 тетради, 31 МБ»
   * — это и есть весь разговор про приватность, сведённый к двум строчкам.
   */
  measure: async () => {
    set({ status: 'measuring' });
    try {
      const bundle = await currentBundle(get().title || defaultTitle(), get().scope);
      const compact = await compactLink(bundle.title);
      set({ preview: bundleStats(bundle), compact, status: 'idle' });
    } catch (err) {
      set({ status: 'error', error: message(err) });
    }
  },

  share: async () => {
    if (get().status === 'working') return;
    if (get().lock === 'passphrase' && get().passphrase.trim().length < 6) {
      set({ status: 'error', error: 'A passphrase shorter than six characters is not one.' });
      return;
    }

    set({ status: 'working', error: null, stage: 'packing', progress: { done: 0, total: 0 } });

    try {
      const title = get().title.trim() || defaultTitle();
      const bundle = await currentBundle(title, get().scope);

      // Обновление существующего снимка — та же ссылка, следующая версия
      // (§11.3). Токен есть только у того, кто им делился.
      const previous = get().link;
      const token = previous ? recallToken(previous.id) : null;

      const published = await publish(bundle, {
        lock: get().lock,
        passphrase: get().lock === 'passphrase' ? get().passphrase : undefined,
        id: previous && token ? previous.id : undefined,
        manageToken: token ?? undefined,
        onStage: (stage, done, total) => set({ stage, progress: { done, total } }),
      });

      if (published.manageToken) rememberToken(published.id, published.manageToken);

      const url =
        origin() +
        published.path +
        (published.fragmentKey ? `#k=${published.fragmentKey}` : '');

      const link: ShareLink = {
        id: published.id,
        url,
        version: published.version,
        scope: get().scope,
        locked: get().lock,
      };
      rememberLink(link);
      set({ status: 'done', stage: '', link });
    } catch (err) {
      set({ status: 'error', stage: '', error: message(err) });
    }
  },

  revoke: async () => {
    const link = get().link;
    if (!link) return;

    const token = recallToken(link.id);
    if (!token) {
      set({ error: 'That snapshot cannot be reached from here any more.' });
      return;
    }

    set({ status: 'working', stage: 'removing' });
    try {
      // 404 здесь — успех: снапшот истёк или снят раньше, и ссылке на него конец.
      await removeSnapshot(link.id, token);
      forgetToken(link.id);
      forgetLink();
      set({ status: 'idle', stage: '', link: null });
    } catch (err) {
      set({ status: 'error', stage: '', error: message(err) });
    }
  },

  /* ─── Файл ────────────────────────────────────────────────────────────── */

  exportFile: async () => {
    set({ status: 'working', stage: 'packing the file', error: null });
    try {
      const bundle = await currentBundle(get().title.trim() || defaultTitle(), get().scope);
      const file = await packBundle(bundle);

      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = packFileName(bundle);
      anchor.click();
      // Отзываем в следующем такте: у Safari скачивание начинается не мгновенно,
      // и снятый в том же кадре адрес превращается в пустой файл.
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      set({ status: 'idle', stage: '' });
    } catch (err) {
      set({ status: 'error', stage: '', error: message(err) });
    }
  },

  importFile: async (file) => {
    set({ status: 'working', stage: 'reading the file', error: null });
    try {
      const { bundle, assets } = await unpackBundle(file);
      await applyBundle(bundle, { assets, mode: 'merge' });
      set({ status: 'idle', stage: '' });
    } catch (err) {
      set({ status: 'error', stage: '', error: message(err) });
    }
  },

  /**
   * Форкнуть чужое к себе.
   *
   * Порядок в двух движениях, и оба обязательны. Сначала возвращается своя
   * полка: публичная страница показывает чужой снимок, то есть сторы сейчас
   * заняты не тем, что принадлежит читателю. Потом чужое кладётся рядом.
   * Наоборот было бы «форкнул — и лишился библиотеки», а это ровно тот исход,
   * от которого read-only страницу и городили.
   */
  fork: async (bundle, assets) => {
    await restoreLibrary();
    await applyBundle(bundle, { assets, mode: 'merge' });
    resumePersistence();
    await save();
  },

  /**
   * Оставить себе полку, пришедшую по короткой ссылке.
   *
   * Тот же порядок, что и у форка снапшота, и по той же причине: сперва своя
   * библиотека возвращается из базы, потом чужая ложится рядом. Разница лишь в
   * том, что здесь нет ни ассетов, ни тетрадей — в полтора килобайта они не
   * помещаются.
   */
  keep: async () => {
    const shown = useLibrary.getState().volumes;
    await restoreLibrary();

    const known = new Set(useLibrary.getState().volumes.map((v) => v.id));
    const fresh = shown.filter((v) => !known.has(v.id));

    useLibrary.setState({ volumes: [...useLibrary.getState().volumes, ...fresh] });
    resumePersistence();
    await save();
    set({ shared: false });
  },

  reset: () => set({ status: 'idle', stage: '', error: null, link: null }),
}));

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function origin(): string {
  return process.env.NEXT_PUBLIC_APP_ORIGIN || (typeof location === 'undefined' ? '' : location.origin);
}

/**
 * Ссылка первого уровня (§11.1).
 *
 * Считается вместе с обмером и просто отсутствует, если полка в полтора
 * килобайта не влезла: у неё тогда есть `/s/:id`, а врать про длину адреса
 * незачем.
 */
async function compactLink(title: string): Promise<string | null> {
  try {
    const payload = await packShelf(
      shelfFromVolumes(title, useLibrary.getState().volumes, useTheme.getState().scene),
    );
    if (payload.length > COMPACT_MAX) return null;
    return `${origin()}/?s=${payload}`;
  } catch {
    return null;
  }
}

/* ─── Открыть чужое ─────────────────────────────────────────────────────── */

export interface LoadedSnapshot {
  bundle: Bundle;
  assets: Map<string, Blob>;
  title: string;
  scope: ShareScope;
}

/** Забрать снапшот по идентификатору. Секрет — из фрагмента или от человека. */
export async function loadSnapshot(
  id: string,
  secret?: string,
  onStage?: (stage: string, done: number, total: number) => void,
): Promise<LoadedSnapshot> {
  const fetched = await fetchSnapshot(id);
  const opened = await openSnapshot(fetched, secret, onStage);

  return {
    bundle: parseBundle(opened.bundle),
    assets: opened.assets,
    title: fetched.payload.title,
    scope: fetched.payload.scope,
  };
}

export { fetchSnapshot };

/* ─── Короткая ссылка на входе ──────────────────────────────────────────── */

/**
 * Полка из адреса.
 *
 * Заменяет ряд целиком, а не подмешивается: `?s=` — это «покажи мне вот эту
 * полку», а не «добавь её книги к моим». Форк с такой ссылки делается кнопкой,
 * как и со снапшота.
 */
export async function adoptShelfFromUrl(payload: string): Promise<number> {
  const shelf = await unpackShelf(payload);
  const volumes = volumesFromShelf(shelf);
  if (volumes.length === 0) return 0;

  // Не писать раньше, чем заменять. Своя полка остаётся в базе и возвращается,
  // стоит убрать параметр из адреса, — или переезжает сюда кнопкой «keep».
  pausePersistence();

  useLibrary.setState({ volumes, desk: null, view: 'case', flight: null, armed: null });
  // Свет тоже приехал в адресе: полка обязана выглядеть так, как её отдавали.
  useTheme.setState({ scene: shelf.scene });
  useJournal.setState({ openId: null, flatPage: null });
  useShare.setState({ shared: true });
  return volumes.length;
}

/* ─── Локальная база ────────────────────────────────────────────────────── */

let saving: ReturnType<typeof setTimeout> | null = null;
/** Пока полка поднимается из базы, записывать в неё нечего. */
let restoring = true;
/**
 * Пишем ли мы вообще.
 *
 * Публичная страница снимка выключает запись первым делом, и это не мелочь:
 * она заполняет те же сторы чужой полкой, а подписки внизу файла никакого
 * различия между «моё» и «показываю чужое» не видят. Без этого выключателя
 * переход по чужой ссылке стирал бы собственную библиотеку в базе — молча и
 * необратимо.
 */
let persisting = true;

export function pausePersistence(): void {
  persisting = false;
  if (saving) clearTimeout(saving);
}

export function resumePersistence(): void {
  persisting = true;
}

async function save(): Promise<void> {
  const library = useLibrary.getState();
  const bundle = await currentBundle(
    library.desk?.title ?? `A shelf of ${library.volumes.length}`,
    // В базу кладём всё: она наша, и «объём шеринга» к ней отношения не имеет.
    'volume',
  );

  await saveBundle(bundle);

  /*
   * Подметаем по ссылкам, а не по манифесту. Разница на первый взгляд
   * стилистическая, на деле — между «прибрал лишнее» и «удалил картинку из
   * чужого конспекта»: в манифест попадают только те ассеты, чьи байты сейчас
   * под рукой, а страница тетради ссылается на них независимо от того, успели
   * ли они подняться из базы.
   */
  await pruneAssets(new Set(referencedAssets(bundle)));
}

/**
 * Поднять полку из базы.
 *
 * Зовётся один раз на старте. Пустая база — это первый визит: остаётся
 * демо-полка, заведённая сторами, и она же попадёт в базу первым сохранением.
 */
export async function restoreLibrary(): Promise<boolean> {
  restoring = true;
  try {
    const bundle = await loadBundle();
    if (!bundle) return false;

    const parsed = parseBundle(bundle);
    await restoreAssets(parsed);

    // По ссылкам, а не по списку манифеста: `restoreAssets` подняла в хранилище
    // именно их (см. db/local.ts), и сюда должны попасть те же.
    const assets = new Map<string, Blob>();
    for (const hash of referencedAssets(parsed)) {
      const blob = assetBlob(hash);
      if (blob) assets.set(hash, blob);
    }

    await applyBundle(parsed, { assets, mode: 'replace' });
    return true;
  } catch {
    // Испорченная или чужая по версии база — не повод не открыться. Полка
    // останется демонстрационной, и следующее сохранение её перезапишет.
    return false;
  } finally {
    restoring = false;
  }
}

/**
 * Сохранять после того, как затихло.
 *
 * Штрих пером меняет тетрадь двадцать раз в секунду, и сериализовать её на
 * каждый было бы платой за то, чего никто не увидит. Секунда покоя — это
 * «человек оторвал перо от бумаги».
 */
function schedule(): void {
  if (restoring || !persisting) return;
  if (saving) clearTimeout(saving);
  saving = setTimeout(() => void save(), 1000);
}

if (typeof window !== 'undefined') {
  useLibrary.subscribe((state, previous) => {
    if (state.volumes !== previous.volumes || state.desk !== previous.desk) schedule();
  });
  useJournal.subscribe((state, previous) => {
    if (state.docs !== previous.docs) schedule();
  });
  useClips.subscribe((state, previous) => {
    if (state.clips !== previous.clips) schedule();
  });
  useTheme.subscribe((state, previous) => {
    if (state.scene !== previous.scene) schedule();
  });
}

if (process.env.NODE_ENV !== 'production') {
  (globalThis as { __r3adShare?: typeof useShare }).__r3adShare = useShare;
}
