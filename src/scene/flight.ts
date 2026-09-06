'use client';

/**
 * Полёт книги между столом и полкой.
 *
 * Здесь только состояние и время: ни одной строчки three. Причина не в чистоте
 * слоёв, а в весе — на этот модуль ссылается библиотека (`store/useLibrary`),
 * чтобы объявить полёт, а на библиотеку ссылается вся оболочка. Пока THREE
 * лежал здесь, он приезжал в первую загрузку даже тому, кто открыл сайт в
 * плоском режиме и сцены не увидит вовсе. Геометрия пути — в flightPath.ts,
 * рядом с теми, кто её рисует.
 *
 * Устроено так же, как переворот страницы (см. turn.ts): изменяемый объект,
 * который читает и пишет кадровый цикл, и ни одного числа этой анимации в
 * сторе. Причина та же — шестьдесят реконсиляций в секунду ради трёх float'ов
 * не нужны никому.
 *
 * Анимация двухтактная, и такты не смешиваются: сначала книга закрывается на
 * столе, потом летит. В обратную сторону — сначала долетает, потом
 * раскрывается. Смешать их означало бы показать раскрытую книгу, кувыркающуюся
 * в воздухе, — ровно то, чего с книгами не бывает.
 */
import { motionPrefs } from './motionPrefs';

export type FlightKind = 'shelve' | 'take';

export interface FlightMotion {
  active: boolean;
  kind: FlightKind;
  /** Закрытость книги: 0 — раскрыта на столе, 1 — закрыта. */
  close: number;
  /** Положение на пути: 0 — стол, 1 — полка. */
  path: number;
}

export const flight: FlightMotion = {
  active: false,
  kind: 'shelve',
  close: 0,
  path: 0,
};

/**
 * Показывает ли кто-нибудь сцену.
 *
 * Полёт книги — единственная анимация проекта, у которой есть последствия в
 * состоянии: пока она не доиграла, книга не считается ни на столе, ни на полке,
 * и досчитывает её кадровый цикл. В плоском режиме кадрового цикла нет вовсе, и
 * без этого флага «снять книгу с полки» там означало бы книгу, зависшую в
 * воздухе навсегда.
 */
export const stage = { mounted: false };

export function setStageMounted(mounted: boolean) {
  stage.mounted = mounted;
}

/** Закрыть или раскрыть книгу. Крышка идёт медленнее полёта: это жест, а не бросок. */
const CLOSE_SECONDS = 0.52;

/** Полёт. Величина из SPEC §7.3. */
const FLY_SECONDS = 0.9;

export function startFlight(kind: FlightKind) {
  flight.active = true;
  flight.kind = kind;
  flight.close = kind === 'shelve' ? 0 : 1;
  flight.path = kind === 'shelve' ? 0 : 1;
}

export function stopFlight() {
  flight.active = false;
}

/** Шаг анимации. true — долетели и доигрались. */
export function stepFlight(dt: number): boolean {
  if (!flight.active) return false;

  // «Поменьше движения» не отменяет действие, а убирает промежуточные кадры:
  // книга оказывается там, куда летела, сразу (см. motionPrefs).
  if (motionPrefs.instant) {
    flight.close = flight.kind === 'shelve' ? 1 : 0;
    flight.path = flight.kind === 'shelve' ? 1 : 0;
    return true;
  }

  const step = Math.min(dt, 1 / 30);

  if (flight.kind === 'shelve') {
    if (flight.close < 1) {
      flight.close = Math.min(1, flight.close + step / CLOSE_SECONDS);
      return false;
    }
    flight.path = Math.min(1, flight.path + step / FLY_SECONDS);
    return flight.path >= 1;
  }

  if (flight.path > 0) {
    flight.path = Math.max(0, flight.path - step / FLY_SECONDS);
    return false;
  }
  flight.close = Math.max(0, flight.close - step / CLOSE_SECONDS);
  return flight.close <= 0;
}

export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Микроотскок при посадке.
 *
 * Том не прилипает к полке: он осаживается и подбирается обратно. Полсантиметра
 * и полтора десятка кадров — ровно столько, чтобы движение читалось как вес, а
 * не как ошибка.
 */
export function landingBounce(path: number, kind: FlightKind): number {
  const landing = kind === 'shelve' ? path : 1 - path;
  if (landing < 0.86) return 0;
  const u = (landing - 0.86) / 0.14;
  return -Math.sin(u * Math.PI * 2) * 0.35 * (1 - u);
}

if (process.env.NODE_ENV !== 'production') {
  (globalThis as { __r3adFlight?: FlightMotion }).__r3adFlight = flight;
}
