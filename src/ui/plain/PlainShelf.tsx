'use client';

/**
 * Полка в плоском режиме — список.
 *
 * Тот же стеллаж, только словами: название, автор, объём, толщина. Это и путь
 * доступности (корешок в 3D скринридеру не читается ничем), и то единственное,
 * что видно у публичной ссылки без WebGL, и заодно текст, по которому чужой
 * снимок вообще можно найти поиском по странице.
 *
 * Толщина показана в миллиметрах не для красоты: это главное свойство тома в
 * этом проекте и единственное, что на полке видно глазами. Список, в котором её
 * нет, был бы списком чего-то другого.
 */
import { useMemo } from 'react';
import { volumeExtent } from '@/core/library/volume';
import { typographyKey } from '@/core/paginate/paginate';
import { useBook } from '@/store/useBook';
import { useLibrary } from '@/store/useLibrary';

export function PlainShelf() {
  const volumes = useLibrary((s) => s.volumes);
  const take = useLibrary((s) => s.take);
  const metrics = useBook((s) => s.metrics);
  const typography = useBook((s) => s.typography);

  const typeKey = useMemo(() => typographyKey(metrics, typography), [metrics, typography]);

  return (
    <div tabIndex={0} aria-label="The shelf" className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[46em] px-5 py-8">
        <h1 className="mb-1 text-[19px] font-medium">The shelf</h1>
        <p className="mb-6 text-[12.5px] opacity-55">
          {volumes.length} {volumes.length === 1 ? 'volume' : 'volumes'}
        </p>

        <ul className="flex flex-col">
          {volumes.map((volume) => {
            const extent = volumeExtent(volume, metrics, typeKey);
            return (
              <li key={volume.id} className="border-t border-black/10 last:border-b">
                <button
                  type="button"
                  onClick={() => take(volume.id)}
                  className="flex w-full items-baseline gap-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{volume.title}</span>
                    <span className="block truncate text-[12px] opacity-55">
                      {volume.author}
                      {volume.kind === 'journal' ? ' · notebook' : ''}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-[12px] opacity-55">
                    {/* Оценка, пока книга не свёрстана этим набором, — про это и «≈». */}
                    {extent.exact ? '' : '≈'}
                    {extent.pages} pp · {extent.thicknessMm.toFixed(1)} mm
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
