'use client';

/**
 * Текстуры страниц тетради.
 *
 * Тот же контракт, что и у текстур тома (usePageTextures), — доступ по номеру
 * страницы, — и та же причина держать живыми единицы: страница тетради весит
 * столько же, сколько страница книги. Разница в одном: страницу тетради не надо
 * ни верстать, ни растеризовать через SVG, она печатается на холст напрямую и
 * за миллисекунды. Поэтому здесь нет ни очереди, ни фонового прогрева.
 *
 * Ключ кэша — сам объект страницы, а не её номер. Команды тетради возвращают
 * новый документ и новую страницу только там, где что-то изменилось (см.
 * core/journal/commands), так что несовпадение ссылки и есть точный признак
 * «эту надо перепечатать».
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { paintPage } from '@/core/journal/paint';
import { imageFor, imageSize } from '@/core/assets';
import { PAGE_W, type JournalDoc, type PageDoc } from '@/core/journal/types';
import type { PaperTint } from '@/core/theme';
import { useBook } from '@/store/useBook';
import { useJournal } from '@/store/useJournal';
import { clippingFor } from '@/store/useClips';
import type { PageTextures } from '../usePageTextures';

/** Столько же, сколько у тома: на экране разворот, рядом ещё один. */
const MAX_LIVE = 6;

interface Entry {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
}

/**
 * Отпустить страницу.
 *
 * Холст обнуляем размером, а не просто теряем ссылку: за элементом стоит
 * буфер в полтора мегапикселя, и сборщик добирается до него не сразу — а
 * страниц за сеанс перепечатываются сотни.
 */
function release(entry: Entry) {
  entry.texture.dispose();
  entry.canvas.width = 0;
  entry.canvas.height = 0;
}

function paintTexture(
  page: PageDoc,
  widthPx: number,
  heightPx: number,
  paper: { tint: PaperTint; rule?: number },
): Entry {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;

  const ctx = canvas.getContext('2d')!;
  // Холст переводится в миллиметры страницы: документ не знает про пиксели.
  const scale = widthPx / PAGE_W;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  paintPage(ctx, page, {
    image: imageFor,
    size: imageSize,
    clipping: clippingFor,
    tint: paper.tint,
    rule: paper.rule,
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  return { texture, canvas };
}

export function useJournalTextures(tint: PaperTint): PageTextures {
  const openId = useJournal((s) => s.openId);
  const docs = useJournal((s) => s.docs);
  const journal: JournalDoc | null = openId ? docs[openId] ?? null : null;
  const rule = journal?.ruleMm;

  const widthPx = useBook((s) => s.metrics.pageWidthPx);
  const heightPx = useBook((s) => s.metrics.pageHeightPx);

  const cache = useRef(new Map<PageDoc, Entry>());
  const [, bump] = useState(0);

  /*
   * Смена разрешения обесценивает всё напечатанное: масштаб в текстурах разный.
   * Бумага и разлиновка — то же самое: они запечены в холст, а ключ кэша —
   * объект страницы, который от смены тона не меняется.
   */
  useEffect(() => {
    const live = cache.current;
    return () => {
      for (const entry of live.values()) release(entry);
      live.clear();
    };
  }, [widthPx, heightPx, tint, rule]);

  const pageAt = useCallback(
    (index: number | null | undefined): PageDoc | null => {
      if (typeof index !== 'number' || index < 0 || !journal) return null;
      return journal.pages[index] ?? null;
    },
    [journal],
  );

  const get = useCallback(
    (index: number | null | undefined) => {
      const page = pageAt(index);
      if (!page) return null;
      return cache.current.get(page)?.texture ?? null;
    },
    [pageAt],
  );

  const request = useCallback(
    (needed: (number | null | undefined)[]) => {
      if (!journal) return;

      let painted = false;
      for (const index of needed) {
        const page = pageAt(index);
        if (!page || cache.current.has(page)) continue;
        cache.current.set(page, paintTexture(page, widthPx, heightPx, { tint, rule }));
        painted = true;
      }

      // Map хранит порядок вставки — вытесняем самую давнюю.
      while (cache.current.size > MAX_LIVE) {
        const oldest = cache.current.keys().next().value as PageDoc | undefined;
        if (!oldest) break;
        release(cache.current.get(oldest)!);
        cache.current.delete(oldest);
      }

      if (painted) bump((v) => v + 1);
    },
    [heightPx, journal, pageAt, rule, tint, widthPx],
  );

  return { get, request };
}
