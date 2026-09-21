// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flight, setStageMounted } from '@/scene/flight';
import { useLibrary } from '@/store/useLibrary';

/*
 * Полёт книги — единственная анимация с последствиями в состоянии (§7.3, §16):
 * пока он не доиграл, библиотека заперта. Здесь кадров нет вовсе, и именно
 * это проверяется: посадка обязана случиться без единого кадра — мгновенно
 * без сцены и по предельному сроку с ней.
 */
const LIMIT = 4200;

const journalId = () => useLibrary.getState().volumes.find((v) => v.kind === 'journal')!.id;

beforeEach(() => {
  vi.useFakeTimers();
  useLibrary.setState(useLibrary.getInitialState());
  setStageMounted(false);
});

afterEach(() => {
  vi.useRealTimers();
  setStageMounted(false);
});

describe('без сцены', () => {
  it('книга уезжает на полку мгновенно', () => {
    const desk = useLibrary.getState().desk!;
    useLibrary.getState().shelve();

    const state = useLibrary.getState();
    expect(state.flight).toBeNull();
    expect(state.desk).toBeNull();
    expect(state.view).toBe('case');
    expect(state.volumes.at(-1)?.id).toBe(desk.id);
    expect(flight.active).toBe(false);
  });

  it('тетрадь ложится на стол мгновенно', () => {
    useLibrary.getState().shelve();
    const id = journalId();
    useLibrary.getState().take(id);

    const state = useLibrary.getState();
    expect(state.flight).toBeNull();
    expect(state.desk?.id).toBe(id);
    expect(state.view).toBe('desk');
    expect(state.volumes.some((v) => v.id === id)).toBe(false);
  });
});

describe('со сценой, у которой нет кадров', () => {
  beforeEach(() => setStageMounted(true));

  it('полёт кончается по предельному сроку', () => {
    useLibrary.getState().shelve();
    expect(useLibrary.getState().flight).toEqual({ id: expect.any(String), kind: 'shelve' });
    expect(flight.active).toBe(true);

    vi.advanceTimersByTime(LIMIT - 1);
    expect(useLibrary.getState().flight).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(useLibrary.getState().flight).toBeNull();
    expect(useLibrary.getState().desk).toBeNull();
    expect(flight.active).toBe(false);
  });

  it('пока летит, библиотека заперта, а после — отвечает', () => {
    const id = journalId();
    useLibrary.getState().shelve();
    useLibrary.getState().select(id);
    expect(useLibrary.getState().armed).toBeNull();

    vi.advanceTimersByTime(LIMIT);
    useLibrary.getState().select(id);
    expect(useLibrary.getState().armed).toBe(id);
  });

  it('занятый стол: сначала домой едет нынешняя книга, потом прилетает выбранная', () => {
    const id = journalId();
    const previous = useLibrary.getState().desk!.id;
    useLibrary.getState().take(id);

    let state = useLibrary.getState();
    expect(state.pending).toBe(id);
    expect(state.flight?.kind).toBe('shelve');

    vi.advanceTimersByTime(LIMIT);
    state = useLibrary.getState();
    expect(state.pending).toBeNull();
    expect(state.flight).toEqual({ id, kind: 'take' });
    expect(state.desk?.id).toBe(id);

    vi.advanceTimersByTime(LIMIT);
    state = useLibrary.getState();
    expect(state.flight).toBeNull();
    expect(state.desk?.id).toBe(id);
    expect(state.volumes.map((v) => v.id)).toContain(previous);
    expect(state.volumes.map((v) => v.id)).not.toContain(id);
  });

  it('второй щелчок по наклонённому корешку вытаскивает книгу', () => {
    useLibrary.getState().shelve();
    vi.advanceTimersByTime(LIMIT);

    const id = journalId();
    useLibrary.getState().select(id);
    expect(useLibrary.getState().flight).toBeNull();
    useLibrary.getState().select(id);
    expect(useLibrary.getState().flight).toEqual({ id, kind: 'take' });
  });

  it('полёт, снятый снаружи, не досаживается сторожем', () => {
    const desk = useLibrary.getState().desk!;
    useLibrary.getState().shelve();
    // Так делают подъём из базы и снимок по ссылке — мимо arrived().
    useLibrary.setState({ flight: null, desk });
    expect(flight.active).toBe(false);

    vi.advanceTimersByTime(LIMIT * 2);
    expect(useLibrary.getState().desk?.id).toBe(desk.id);
  });
});

describe('ряд', () => {
  it('перестановка держит границы', () => {
    const ids = useLibrary.getState().volumes.map((v) => v.id);
    useLibrary.getState().reorder(ids[0], 999);
    expect(useLibrary.getState().volumes.at(-1)?.id).toBe(ids[0]);
    useLibrary.getState().reorder(ids[0], -5);
    expect(useLibrary.getState().volumes[0].id).toBe(ids[0]);
    useLibrary.getState().reorder('no-such-id', 1);
    expect(useLibrary.getState().volumes.map((v) => v.id)).toEqual(ids);
  });

  it('переодевание достаёт том и на столе, и в ряду разом', () => {
    setStageMounted(true);
    const desk = useLibrary.getState().desk!;
    useLibrary.getState().shelve();
    // В полёте запись есть и в ряду, и на столе.
    const theme = { ...desk.theme, ribbon: '#ff0000' };
    useLibrary.getState().dress(desk.id, theme);

    const state = useLibrary.getState();
    expect(state.desk?.theme).toEqual(theme);
    expect(state.volumes.find((v) => v.id === desk.id)?.theme).toEqual(theme);
  });
});
