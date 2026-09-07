'use client';

/**
 * Потерянный контекст WebGL.
 *
 * Браузер вправе отобрать контекст в любой момент и без спроса: упал процесс
 * графики, драйвер ушёл на перезапуск, вкладке перестало хватать живых
 * контекстов, началась запись экрана. Для страницы это выглядит как одно
 * событие на холсте — и как чёрный прямоугольник вместо комнаты, если событие
 * не разобрать.
 *
 * Разбирать его обязаны мы, а не three: renderer сам умеет только пережить
 * возврат контекста (он переинициализирует состояние в `webglcontextrestored`).
 * Всё, что было завязано на кадры, при этом остаётся висеть — а завязаны на них
 * не только картинки. Полёт книги и переворот листа доигрывает кадровый цикл, и
 * пока он не доиграл, библиотека не отдаёт ни одной команды: интерфейс молчит,
 * книга не берётся, и объяснить человеку, что случилось, нечем.
 *
 * Поэтому здесь три шага, ровно в этом порядке: отпустить всё, что ждало
 * кадров; подождать, пока контекст вернут сами; попросить его обратно руками. А
 * если и это не помогло — уйти в плоский режим, где книга читается без всякой
 * графики (§17), и оставить человеку кнопку «попробовать снова».
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';
import { useShell } from '@/store/useShell';
import { motion } from './turn';

/**
 * Сколько ждём, пока браузер вернёт контекст сам.
 *
 * После настоящего сбоя он это делает — но не мгновенно: секунда с небольшим
 * уходит на перезапуск процесса графики.
 */
const RESTORE_WAIT = 1400;

/** Сколько всего ждём, прежде чем показать книгу текстом. */
const GIVE_UP = 3600;

export function ContextGuard() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const canvas = gl.domElement;
    let ask = 0;
    let give = 0;

    const onLost = (event: Event) => {
      /*
       * Без этого контекст не вернут вовсе: отмена умолчания и есть просьба
       * его восстановить. three делает то же самое в своём слушателе, но
       * порядок слушателей на элементе — порядок подписки, и полагаться на то,
       * что чужой отработает раньше нашего, незачем.
       */
      event.preventDefault();

      /*
       * Отпускаем всё, что доигрывал кадровый цикл. Полёт досчитывается по
       * месту назначения, переворот — по цели листа: обе анимации были
       * обещанием показать движение, а показывать теперь нечем, и остаётся
       * выполнить обещанное без движения.
       */
      useLibrary.getState().arrived();
      motion.dragging = false;
      if (useBook.getState().turn) useBook.getState().endTurn(motion.target);

      ask = window.setTimeout(() => {
        // Расширение есть не везде, и просьба к живому контексту — ошибка.
        try {
          gl.forceContextRestore();
        } catch {
          /* Не вышло — остаётся плоский режим ниже. */
        }
      }, RESTORE_WAIT);

      give = window.setTimeout(() => {
        useShell.getState().setMode('plain', 'gpu-lost');
      }, GIVE_UP);
    };

    const onRestored = () => {
      window.clearTimeout(ask);
      window.clearTimeout(give);
      // Кадры выдаются по требованию, и первый после возврата надо заказать:
      // сцена не менялась, а нарисована заново обязана быть целиком.
      invalidate();
    };

    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    return () => {
      window.clearTimeout(ask);
      window.clearTimeout(give);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, [gl, invalidate]);

  return null;
}
