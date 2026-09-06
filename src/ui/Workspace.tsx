'use client';

/**
 * Оболочка приложения: что запускается, что принимает файлы и что показывает
 * книгу — сцена или плоский режим.
 *
 * Здесь же порядок запуска: сначала шрифты регистрируются в документе (иначе
 * композитор посчитает разбивку запасной гарнитурой и растр разойдётся с
 * вёрсткой), затем проба растеризатора, и только потом первая пагинация.
 *
 * До M7 всё это лежало вместе со сценой в одном файле. Разделение понадобилось,
 * когда у книги появился второй вид: приём файла, подъём полки из базы,
 * палитра команд и горячие клавиши общего назначения одинаковы в обоих
 * режимах, а вьюпорт есть только в одном — и на машине без WebGL2 его не должно
 * быть даже в загрузке.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SceneWorkspace } from './SceneWorkspace';
import { PlainReader } from './plain/PlainReader';
import { Palette } from './palette/Palette';
import { useBook } from '@/store/useBook';
import { useJournal } from '@/store/useJournal';
import { useClips } from '@/store/useClips';
import { useShare, adoptShelfFromUrl, restoreLibrary } from '@/store/useShare';
import { useShell } from '@/store/useShell';
import { ShareDialog } from './share/ShareDialog';
import { R3AD_EXTENSION } from '@/core/share/pack';
import { useBoot } from './boot';
import { useDevice } from './useDevice';

export function Workspace() {
  const [dropping, setDropping] = useState(false);

  useDevice();
  const boot = useBoot();

  const mode = useShell((s) => s.mode);
  const scene = useShell((s) => s.device.scene);
  const texture = useShell((s) => s.device.texture);

  const runPagination = useBook((s) => s.runPagination);
  const open = useBook((s) => s.open);

  const flatPage = useJournal((s) => s.flatPage);
  const flat = flatPage !== null;
  const insertImage = useJournal((s) => s.insertImage);
  const insertClipping = useJournal((s) => s.insertClipping);
  const unfurl = useClips((s) => s.unfurl);
  const importFile = useShare((s) => s.importFile);

  /**
   * Откуда взялась полка на этом экране.
   *
   * Порядок важен и разрешает спор в одну сторону: `?s=` в адресе побеждает
   * сохранённое. Человек перешёл по чужой ссылке — он пришёл смотреть её, а не
   * свою полку; своя при этом никуда не делась, она в базе, и вернётся, стоит
   * убрать параметр из адреса. Обратный порядок означал бы, что ссылка иногда
   * не открывается, и объяснить почему было бы нечем.
   *
   * И только после этого — первая вёрстка: она считает то, что в итоге лежит на
   * столе, а не то, что лежало до подъёма из базы.
   *
   * Вёрстки может и не быть вовсе. На машине без WebGL2 книга показывается
   * текстом, где страниц нет (§17), а разбивка — самая тяжёлая операция
   * проекта: полминуты работы композитора ради числа, которое негде показать.
   * Считаем её только там, где в сцену можно вернуться.
   */
  useEffect(() => {
    if (boot !== 'ready') return;
    let alive = true;

    (async () => {
      const shared = new URLSearchParams(location.search).get('s');
      if (shared) {
        try {
          await adoptShelfFromUrl(shared);
        } catch {
          /* Испорченный адрес — не повод не открыться: останется своя полка. */
        }
      } else {
        await restoreLibrary();
      }
      if (alive && scene) runPagination();
    })();

    return () => {
      alive = false;
    };
  }, [boot, runPagination, scene]);

  /**
   * Разрешение растра страницы — по машине, а не по желанию (§6.5).
   *
   * Ставится после шрифтов: смена профиля перевёрстывает книгу, а вёрстка до
   * загрузки гарнитуры посчиталась бы запасной и разошлась бы с растром. Число
   * страниц от профиля при этом не меняется — в метриках всё пропорционально
   * пикселям на миллиметр, — меняется только чёткость.
   */
  useEffect(() => {
    if (boot !== 'ready' || !scene) return;
    if (useBook.getState().profile !== texture) useBook.getState().setProfile(texture);
  }, [boot, scene, texture]);

  /**
   * Клавиши, общие для обоих режимов.
   *
   * Всё, что здесь есть, — с модификатором, и это не совпадение: одиночные
   * буквы принадлежат тому, что показано на экране (инструменты тетради,
   * листание), а сочетания — приложению целиком.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shell = useShell.getState();

      if (e.key === 'Escape' && shell.palette) {
        e.preventDefault();
        shell.closePalette();
        return;
      }

      if (!e.ctrlKey && !e.metaKey) return;

      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        if (shell.palette) shell.closePalette();
        else shell.openPalette('commands');
        return;
      }

      /*
       * ⌘F перехватывается у браузера. Его собственный поиск нашёл бы только то,
       * что сейчас в DOM: в сцене — ничего вообще, в плоском режиме — одну
       * открытую главу. Поиск по книге ищет по всем.
       */
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        shell.openPalette('search');
        return;
      }

      if (e.key === '\\') {
        e.preventDefault();
        shell.togglePanels();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Скриншот из буфера — главный способ попасть картинке в конспект.
   *
   * Слушаем на окне, а не на холсте: событие вставки приходит туда, где фокус,
   * а фокуса на холсте может и не быть — по нему рисуют, а не кликают в него.
   */
  useEffect(() => {
    if (!flat) return;

    const onPaste = (event: ClipboardEvent) => {
      // В поле ввода вставка принадлежит полю: там набирают текст, а не кладут
      // на страницу.
      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;

      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (file) {
        event.preventDefault();
        void insertImage(file).catch(() => undefined);
        return;
      }

      /*
       * Ссылка в буфере — это сценарий §4.2: вставили тред, он развернулся,
       * карточка легла на страницу. Отличаем её от обычного текста по форме,
       * а не по намерению: вставленный абзац ложиться карточкой не должен.
       */
      const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
      if (!/^https?:\/\/\S+$/i.test(text)) return;

      event.preventDefault();
      void unfurl(text).then((clipping) => {
        if (clipping) insertClipping(clipping);
      });
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [flat, insertClipping, insertImage, unfurl]);

  /**
   * Счётчик глубины перетаскивания.
   *
   * dragleave прилетает и при переходе указателя между вложенными элементами,
   * поэтому одним булевым флагом подсветка мигает. Считаем входы и выходы.
   */
  const dragDepth = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragDepth.current += 1;
    setDropping(true);
  }, []);

  const onDragLeave = useCallback(() => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDropping(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;

      // Бандл — не книга и не картинка: это полка целиком, и она встаёт рядом
      // со своей, а не открывается на столе.
      if (file.name.toLowerCase().endsWith(R3AD_EXTENSION)) {
        void importFile(file);
        return;
      }

      // Над раскрытой тетрадью картинка ложится на страницу, а не открывается
      // книгой: перетащить скриншот в конспект — обычное движение, а «открыть
      // png томом» не значит ничего.
      if (flat && file.type.startsWith('image/')) void insertImage(file).catch(() => undefined);
      else void open(file);
    },
    [flat, importFile, insertImage, open],
  );

  return (
    <div
      className="flex h-dvh w-full flex-col bg-ink-950"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/*
        Первая остановка табуляции. Сцена с клавиатуры не читается ничем —
        книга в ней это пиксели, — и человеку, пришедшему сюда с клавиатуры или
        со скринридером, первым делом нужен выход в текст (§17).
      */}
      {mode === 'scene' ? (
        <button type="button" className="skip" onClick={() => useShell.getState().setMode('plain')}>
          Read this book as text
        </button>
      ) : null}

      {mode === 'plain' ? <PlainReader /> : <SceneWorkspace boot={boot} />}

      {dropping && (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-brass-500/70 bg-ink-950/70 backdrop-blur-sm">
          <span className="text-[12.5px] text-brass-400">
            {flat ? 'Drop an image onto the page' : 'Drop an EPUB, TXT, Markdown or .r3ad file'}
          </span>
        </div>
      )}

      <ShareDialog />
      <Palette />
    </div>
  );
}
