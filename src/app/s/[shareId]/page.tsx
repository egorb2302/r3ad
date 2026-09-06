/**
 * `/s/:id` — чужой снимок, открытый по ссылке.
 *
 * Серверный компонент здесь ровно за одним: сказать поисковикам не заходить.
 * Снапшоты unlisted (§11.2, §18), и `noindex` — это не настройка приватности, а
 * обещание: ссылку прислали одному человеку, и она не должна оказаться в
 * выдаче.
 *
 * Всё остальное — в браузере: тело снимка может быть зашифровано ключом,
 * которого у сервера нет и не должно быть (§11.3), так что отрисовать его на
 * сервере невозможно в принципе. Это не ограничение, а свойство схемы.
 */
import type { Metadata } from 'next';
import { SnapshotView } from '@/ui/share/SnapshotView';

export const metadata: Metadata = {
  title: 'r3ad — a shared shelf',
  robots: { index: false, follow: false },
};

export default async function SnapshotPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  return <SnapshotView id={shareId} />;
}
