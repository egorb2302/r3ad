/**
 * Цвет переплёта.
 *
 * У книги на полке нет ассетов: ни текстуры обложки, ни картинки корешка. Всё,
 * из чего можно взять цвет, — это сама книга. Отсюда два источника, в порядке
 * убывания достоверности:
 *
 * 1. Обложка из EPUB, если она есть: берём её доминанту. Тогда том на полке
 *    узнаётся по цвету — так же, как узнаётся бумажный.
 * 2. Название и автор. Хэш строки → тон из переплётной палитры. Не «случайный
 *    цвет»: генератор ограничен теми красками, которыми книги действительно
 *    кроют, иначе полка выглядит как коробка с фломастерами.
 *
 * Второй путь детерминирован. Одна и та же книга обязана получить один и тот же
 * корешок между перезагрузками, иначе полка перестаёт быть местом, где вещи
 * лежат там, где их оставили.
 *
 * **Уточнено на M6.** Отсюда выходит один цвет — краска крышки, — а не вся
 * палитра корешка: остальное (накладка, тиснение, каптал) выводится из темы,
 * которую человек волен переписать (`core/theme.ts`). Разделение не косметика:
 * пока палитра собиралась целиком здесь, у неё не было владельца — цвет крышки
 * в одном месте, цвет корешка в другом, и «покрасить книгу» означало бы
 * согласовать два независимых числа.
 */

export interface SpinePalette {
  /** Крышка и корешок — основной цвет тома. */
  cloth: string;
  /** Накладка под название: у переплёта она темнее или светлее основного поля. */
  panel: string;
  /** Тиснение. Золото на тёмном, блинт на светлом. */
  foil: string;
  /** Каптал — цветная тесьма у головки корешка. Мелочь, но её видно. */
  head: string;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/**
 * Переплётные тона.
 *
 * Список короткий и намеренно скучный: оксблад, лес, индиго, охра, сланец,
 * слива, песок, бутылка. Ровно те краски, которые переживают сорок томов в
 * одном ряду, не превращая полку в радугу.
 */
const CLOTH_HUES = [355, 12, 28, 42, 96, 152, 178, 205, 224, 258, 292, 328];

/** Дешёвый строковый хэш. Нужен для выбора тона, не для криптографии. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hslToHex({ h, s, l }: Hsl): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * Привести любой тон к переплётному.
 *
 * Доминанта обложки может оказаться чем угодно — от белой бумаги до ядовитого
 * пурпура. Насыщенность и светлота зажимаются в диапазон, в котором ткань или
 * кожа вообще бывают: слишком светлый корешок теряет тиснение, слишком яркий
 * выбивается из ряда.
 */
function toCloth(hsl: Hsl): Hsl {
  return {
    h: ((hsl.h % 360) + 360) % 360,
    s: Math.min(Math.max(hsl.s, 0.14), 0.52),
    l: Math.min(Math.max(hsl.l, 0.15), 0.44),
  };
}

/**
 * Краска крышки по названию и автору. Детерминирована.
 *
 * Хэш отдаётся наружу вместе с цветом: из него же тема выводит материал и
 * потёртость (`core/theme.ts`). Считать его там второй раз можно, но тогда
 * «одна книга — одно зерно» держалось бы на том, что оба места не забыли взять
 * одну и ту же строку.
 */
export function clothFor(seed: string): { cloth: string; hash: number } {
  const hash = hashString(seed);
  return {
    hash,
    cloth: hslToHex(
      toCloth({
        h: CLOTH_HUES[hash % CLOTH_HUES.length],
        // Разброс внутри тона — чтобы два тома одного цвета всё же различались.
        s: 0.2 + ((hash >>> 8) % 22) / 100,
        l: 0.19 + ((hash >>> 16) % 20) / 100,
      }),
    ),
  };
}

/** Краска крышки по доминанте обложки издания. */
export function clothFromColor(hsl: Hsl): string {
  return hslToHex(toCloth(hsl));
}

/**
 * Цвет из строки `#rrggbb` обратно в тон.
 *
 * Нужен там, где цвет уже выбран и его надо разложить: теме — чтобы вывести из
 * краски крышки накладку, тиснение и каптал, и ссылке-полке (§11.1), где
 * корешок с обложки едет готовым цветом, а не обложкой — она в полтора
 * килобайта не помещается. Через `clothFromColor` тон вернётся в тот же
 * переплётный диапазон, из которого вышел, поэтому оборот туда-обратно
 * устойчив.
 */
export function hexToHsl(hex: string): Hsl {
  const value = parseInt(hex.replace('#', ''), 16) || 0;
  return rgbToHsl((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;

  return { h: (h * 60 + 360) % 360, s, l };
}

/** Сторона уменьшенной копии обложки, по которой ищется доминанта. */
const SAMPLE = 48;

/**
 * Доминанта обложки.
 *
 * Не средний цвет: усреднение обложки даёт грязно-серый почти всегда. Считаем
 * гистограмму по крупным корзинам тона и берём самую весомую, причём вес
 * пикселя тем больше, чем он насыщеннее. Иначе на любой обложке победил бы фон
 * — белая бумага или чёрная плашка, — а узнаётся книга как раз по краске.
 */
export async function dominantColor(url: string): Promise<Hsl | null> {
  try {
    const response = await fetch(url);
    const bitmap = await createImageBitmap(await response.blob(), {
      resizeWidth: SAMPLE,
      resizeHeight: SAMPLE,
      resizeQuality: 'low',
    });

    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);

    // 24 корзины по тону плюс отдельная для всего ненасыщенного.
    const BUCKETS = 24;
    const weight = new Float64Array(BUCKETS);
    const sumS = new Float64Array(BUCKETS);
    const sumL = new Float64Array(BUCKETS);
    let grayWeight = 0;
    let grayL = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const hsl = rgbToHsl(data[i], data[i + 1], data[i + 2]);

      if (hsl.s < 0.12) {
        grayWeight += 1;
        grayL += hsl.l;
        continue;
      }

      const bucket = Math.floor((hsl.h / 360) * BUCKETS) % BUCKETS;
      // Насыщенный пиксель весит больше: краска важнее фона.
      const w = hsl.s * hsl.s;
      weight[bucket] += w;
      sumS[bucket] += hsl.s * w;
      sumL[bucket] += hsl.l * w;
    }

    let best = -1;
    let bestWeight = 0;
    for (let i = 0; i < BUCKETS; i++) {
      if (weight[i] > bestWeight) {
        bestWeight = weight[i];
        best = i;
      }
    }

    // Обложка может быть и честно ахроматичной — тогда отдаём серый как есть.
    if (best < 0 || bestWeight < grayWeight * 0.05) {
      if (grayWeight === 0) return null;
      return { h: 30, s: 0.05, l: grayL / grayWeight };
    }

    return {
      h: (best + 0.5) * (360 / BUCKETS),
      s: sumS[best] / weight[best],
      l: sumL[best] / weight[best],
    };
  } catch {
    return null;
  }
}
