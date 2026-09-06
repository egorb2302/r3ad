/**
 * Демонстрационная библиотека.
 *
 * Пустой стеллаж — плохая первая страница: смотреть не на что, а вся затея
 * ровно про то, как выглядит ряд книг. До того как появится загрузка реальных
 * томов из общественного достояния (SPEC §21.2), полку населяет синтетика.
 *
 * Тома здесь — не картинки и не заглушки. У каждого свой текст, свой объём и
 * свой корешок, и любой можно снять с полки и читать: сгенерированная книга
 * проходит тот же конвейер, что и EPUB с диска. Отличается только то, откуда
 * взялись знаки.
 *
 * Объём задан страницами при наборе по умолчанию — так таблицу можно читать
 * глазами. В знаки он переводится тут же: числом знаков оперирует оценка
 * толщины, и она обязана ехать вместе с кеглем.
 */
import { computeMetrics, DEFAULT_TYPOGRAPHY } from '../typography';
import { optionsForExtent } from '../text/synthetic';
import { demoJournal } from '../journal/demo';
import { hashString, paletteFor } from './palette';
import { charsPerPage, journalRecord, type VolumeRecord } from './volume';

/** Название, автор, объём в страницах при кегле 10.5 pt. */
const CATALOGUE: [title: string, author: string, pages: number][] = [
  ['The Composed Page', 'H. Nordbeck', 288],
  ['Leading and Its Discontents', 'M. Ferrer', 196],
  ['A History of the Fore-Edge', 'J. Halloway', 512],
  ['Papers of the Low Countries', 'S. van Dijk', 640],
  ['On Widows', 'E. Marchetti', 128],
  ['The Quarto Question', 'P. Ashgrove', 352],
  ['Foil, Blind, Relief', 'T. Okonkwo', 224],
  ['Casebound', 'R. Lindqvist', 408],
  ["The Compositor's Year", 'A. Beaumont', 296],
  ['Ink Under Glass', 'N. Sarraf', 176],
  ['Sixty Grams', 'D. Weiss', 240],
  ['The Signature and the Fold', 'L. Petrakis', 384],
  ['Marginalia', 'C. Ravenscroft', 160],
  ['Notes on Hyphenation', 'M. Duplessis', 112],
  ['The Long Gutter', 'K. Ostrowski', 320],
  ['Bindings of the North', 'I. Lehtinen', 576],
  ['Colophon', 'G. Amari', 144],
  ['Sorts and Spaces', 'B. Whitlock', 264],
  ["The Type Founder's Manual", 'F. Guerrero', 448],
  ['Endpapers', 'V. Solberg', 192],
  ['A Grammar of the Spread', 'H. Ito', 336],
  ['Rivers', 'O. Delacroix', 208],
  ['The Trimmed Edge', 'W. Karlsson', 272],
  ['Impression and Bite', 'Y. Nakamura', 424],
  ['Cloth, Buckram, Calf', 'R. Achebe', 360],
  ["The Reader's Thumb", 'S. Nowak', 152],
  ['Point Size', 'A. Fournier', 232],
  ['Loose Leaves', 'M. Bergström', 184],
  ['The Head Band', 'T. Vasquez', 120],
  ['Kerning Pairs', 'J. Mbeki', 216],
  ["The Printer's Devil", 'E. Thornbury', 480],
  ['Spine Label', 'N. Kowalczyk', 136],
  ['Ligature', 'P. Sandoval', 168],
  ['The Uncut Book', 'L. Farkas', 392],
  ['Grain Direction', 'H. Tanaka', 256],
  ['Deckle', 'C. Mihailović', 200],
  ['The Shelf Mark', 'A. Rasmussen', 304],
  ['Gathering and Sewing', 'D. Oyelaran', 344],
  ['Ascender, Descender', 'M. Rinaldi', 176],
  ['The Last Impression', 'K. Sørensen', 528],
];

/**
 * Знаков на странице при наборе по умолчанию.
 *
 * Считается, а не вписывается числом: поменяются поля или кегль по умолчанию —
 * и таблица выше поедет вместе с ними, оставаясь верной в страницах.
 */
const REFERENCE_CHARS_PER_PAGE = charsPerPage(computeMetrics(DEFAULT_TYPOGRAPHY, 'desktop'));

export function demoLibrary(): VolumeRecord[] {
  const volumes: VolumeRecord[] = CATALOGUE.map(([title, author, pages], index) => {
    const id = `demo-${String(index + 1).padStart(2, '0')}`;
    const charCount = pages * REFERENCE_CHARS_PER_PAGE;

    return {
      id,
      kind: 'volume' as const,
      title,
      author,
      format: 'synthetic' as const,
      language: 'en',
      charCount,
      pages: null,
      pagesKey: null,
      palette: paletteFor(`${title}|${author}`),
      source: {
        kind: 'synthetic' as const,
        options: optionsForExtent(charCount, { seed: hashString(id), title, author }),
      },
      // Порядок поступления держим осмысленным: полка заполнялась слева направо.
      addedAt: index,
    };
  });

  // Тетрадь стоит там же, где книги: на полке между ними разницы нет.
  volumes.push(journalRecord(demoJournal()));
  return volumes;
}
