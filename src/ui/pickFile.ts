'use client';

/**
 * Диалог выбора файла без разметки.
 *
 * Скрытый `<input type=file>` в компоненте работает ровно до тех пор, пока
 * компонент жив: палитра закрывается тем же движением, которым команду
 * запустили, а событие `change` от узла, выброшенного из документа, до React
 * уже не доходит — обработчики висят на корне. Поэтому поле заводится на
 * лету, живёт в body и убирается за собой.
 */
const ACCEPT = '.epub,.txt,.md,.markdown,.r3ad,application/epub+zip';

export function pickFile(onPick: (file: File) => void, accept = ACCEPT) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.display = 'none';

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (file) onPick(file);
  });

  /*
   * «Отмена» в системном диалоге приходит не всем браузерам, и убирать поле
   * только по `change` значило бы оставлять по узлу на каждый передуманный
   * выбор. Отмена ловится через `cancel`, а где его нет — узел переживёт
   * вкладку, но останется один.
   */
  input.addEventListener('cancel', () => input.remove());

  document.body.append(input);
  input.click();
}
