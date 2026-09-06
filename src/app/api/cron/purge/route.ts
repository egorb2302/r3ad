/**
 * Уборка протухших снапшотов — Vercel Cron, раз в сутки (§14).
 *
 * TTL у снапшота 90 дней и продлевается при каждом открытии, поэтому истекает
 * ровно то, на что никто не заходил четверть года. Вместе с записью уходит
 * манифест и те ассеты, на которые больше нет ссылок; дедупликация (§11.3)
 * означает, что «нет ссылок» — это вопрос к реестру, а не к хранилищу байтов.
 *
 * Расписание объявляется в `vercel.json`. Cron ходит по HTTP, как обычный
 * посетитель, поэтому маршрут закрыт секретом: без него дневную уборку мог бы
 * запускать кто угодно и сколько угодно.
 */
import { purgeExpired } from '@/server/share';

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  /*
   * Без объявленного секрета маршрут закрыт вовсе, а не открыт всем. Ошибка в
   * эту сторону стоит несостоявшейся уборки; в обратную — чужой рукой на
   * кнопке удаления.
   */
  if (!secret) return new Response('cron is not configured', { status: 404 });

  const offered = request.headers.get('authorization');
  if (offered !== `Bearer ${secret}`) return new Response('no', { status: 401 });

  const result = await purgeExpired();
  return Response.json(result, { headers: { 'cache-control': 'no-store' } });
}
