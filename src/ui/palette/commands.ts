'use client';

/**
 * Что умеет палитра команд (§12.3, §17).
 *
 * Список собирается на открытии из текущего состояния, а не держится готовым:
 * половина команд зависит от того, что на столе, и «перо» в палитре при
 * открытом томе — это пункт, который ничего не делает. Такой пункт хуже
 * отсутствующего: человек нажимает и не понимает, что произошло.
 *
 * Палитра — не украшение. §17 требует, чтобы всё, что делается мышью, делалось
 * и отсюда: это единственный путь для того, кто не может дотянуться до
 * инструмента на тулбаре, и заодно способ узнать сочетание клавиш, не читая
 * документацию.
 */
import { BINDINGS, PRESETS } from '@/core/theme';
import { useBook } from '@/store/useBook';
import { useJournal, type Tool } from '@/store/useJournal';
import { useLibrary } from '@/store/useLibrary';
import { useShare } from '@/store/useShare';
import { useShell } from '@/store/useShell';
import { useTheme } from '@/store/useTheme';
import { pickFile } from '../pickFile';

export interface Command {
  id: string;
  group: string;
  title: string;
  /** Сочетание клавиш или короткое пояснение — справа от названия. */
  hint?: string;
  run: () => void;
}

const TOOLS: { tool: Tool; title: string; hint: string }[] = [
  { tool: 'select', title: 'Select', hint: 'V' },
  { tool: 'pen', title: 'Pen', hint: 'B' },
  { tool: 'marker', title: 'Marker', hint: 'H' },
  { tool: 'eraser', title: 'Eraser', hint: 'E' },
  { tool: 'text', title: 'Text', hint: 'T' },
];

export function buildCommands(): Command[] {
  const shell = useShell.getState();
  const library = useLibrary.getState();
  const book = useBook.getState();
  const journal = useJournal.getState();

  const atShelf = library.view === 'case';
  const writing = library.desk?.kind === 'journal';
  const plain = shell.mode === 'plain';

  const out: Command[] = [
    {
      id: 'view',
      group: 'Go',
      title: atShelf ? 'Back to the desk' : 'Look at the bookcase',
      hint: 'Esc',
      run: () => useLibrary.getState().setView(atShelf ? 'desk' : 'case'),
    },
    {
      id: 'mode',
      group: 'Go',
      title: plain ? 'Back to the book in 3D' : 'Read as text',
      hint: plain ? '' : '?mode=flat',
      run: () => useShell.getState().setMode(plain ? 'scene' : 'plain'),
    },
    {
      id: 'search',
      group: 'Go',
      title: 'Search this book',
      hint: 'Ctrl+F',
      run: () => useShell.getState().openPalette('search'),
    },
    {
      id: 'open',
      group: 'Library',
      title: 'Open a file…',
      hint: 'EPUB, TXT, MD',
      run: () => pickFile((file) => void useBook.getState().open(file)),
    },
    {
      id: 'synthetic',
      group: 'Library',
      title: 'Load the synthetic book',
      run: () => useBook.getState().openSynthetic(),
    },
    {
      id: 'journal',
      group: 'Library',
      title: 'New notebook',
      hint: 'N',
      run: () => useJournal.getState().create(),
    },
    {
      id: 'share',
      group: 'Library',
      title: 'Share this shelf',
      hint: 'Shift+S',
      run: () => useShare.getState().toggle(true),
    },
    {
      id: 'panels',
      group: 'View',
      title: shell.panels ? 'Hide the panels' : 'Show the panels',
      hint: 'Ctrl+\\',
      run: () => useShell.getState().togglePanels(),
    },
    {
      id: 'bigger',
      group: 'Type',
      title: 'Larger type',
      hint: `${book.typography.sizePt} pt`,
      run: () =>
        useBook.getState().setTypography({
          sizePt: Math.min(18, useBook.getState().typography.sizePt + 0.5),
        }),
    },
    {
      id: 'smaller',
      group: 'Type',
      title: 'Smaller type',
      hint: `${book.typography.sizePt} pt`,
      run: () =>
        useBook.getState().setTypography({
          sizePt: Math.max(7, useBook.getState().typography.sizePt - 0.5),
        }),
    },
  ];

  // Книга на столе — значит, её можно закрыть. Пустой стол закрывать нечем.
  if (library.desk && !library.flight) {
    out.splice(1, 0, {
      id: 'shelve',
      group: 'Go',
      title: 'Send the book to the shelf',
      hint: 'S',
      run: () => useLibrary.getState().shelve(),
    });
  }

  if (writing && !plain) {
    for (const entry of TOOLS) {
      out.push({
        id: `tool:${entry.tool}`,
        group: 'Notebook',
        title: entry.title,
        hint: entry.hint,
        run: () => useJournal.getState().setTool(entry.tool),
      });
    }
    out.push({
      id: 'leaf',
      group: 'Notebook',
      title: 'Add a leaf',
      run: () => useJournal.getState().addLeaf(),
    });
    if (journal.flatPage !== null) {
      out.push({
        id: 'leave-flat',
        group: 'Notebook',
        title: 'Back from the page',
        hint: 'Esc',
        run: () => useJournal.getState().exitFlat(),
      });
    }
  }

  /*
   * Внешность — только в сцене. В плоском режиме переплёт не виден вовсе, и
   * «переплести в кожу» там означало бы изменение, которого не показать.
   */
  if (!plain) {
    const desk = library.desk;
    if (desk) {
      for (const binding of BINDINGS) {
        out.push({
          id: `binding:${binding.name}`,
          group: 'Binding',
          title: binding.name,
          hint: 'this book',
          run: () => useLibrary.getState().dress(desk.id, binding.theme),
        });
      }
    }

    for (const preset of PRESETS) {
      out.push({
        id: `light:${preset.value}`,
        group: 'Light',
        title: preset.label,
        run: () => useTheme.getState().setScene({ preset: preset.value }),
      });
    }
  }

  /*
   * Оглавление в палитре — не дубликат навигатора. Панели прячутся (Ctrl+\), на
   * узком экране их нет вовсе, а перейти к главе надо и там.
   */
  // Список берём у книги, а не у разбивки: без WebGL2 её не считают вовсе
  // (см. Workspace), а перейти к главе надо и там. Номер страницы тогда просто
  // нечем показать.
  for (const chapter of book.doc.chapters) {
    const span = book.pagination?.chapters.find((c) => c.id === chapter.id) ?? null;
    out.push({
      id: `chapter:${chapter.id}`,
      group: 'Chapters',
      title: chapter.title,
      hint: span ? `p. ${span.startPage + 1}` : '',
      run: () => goToChapter(chapter.id, span?.startPage ?? null),
    });
  }

  return out;
}

/**
 * Перейти к главе в том режиме, который сейчас на экране.
 *
 * В плоском режиме это смена главы, в сцене — переход на её первую страницу.
 * Обе величины хранятся отдельно и обе назначаются сразу: человек может
 * переключить режим следующим движением, и книга обязана оказаться там же, где
 * он её оставил.
 */
export function goToChapter(chapterId: string, startPage: number | null) {
  useShell.getState().setChapter(chapterId);
  if (startPage !== null) useBook.getState().setSheet(Math.floor(startPage / 2));
}
