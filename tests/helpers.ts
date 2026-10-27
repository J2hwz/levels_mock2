import { type Config, parseConfig } from '../src/config';
import { Session } from '../src/log/session';
import type { Action } from '../src/sim/world';

export function testConfig(query: string): Config {
  return parseConfig(query, () => 1);
}

export function testSession(query: string): Session {
  let fake = 0;
  return new Session(
    testConfig(query),
    {
      userAgent: 'vitest',
      screen: { width: 1920, height: 1080, dpr: 1, viewport_w: 1920, viewport_h: 1080 },
      startedAt: '2026-01-01T00:00:00.000Z',
    },
    () => (fake += 1),
  );
}

/** A scripted action list exercising every action kind, keyed by tick. */
export function scriptedActions(session: Session): Map<number, Action[]> {
  const s = session.state;
  // in the flat condition there are only cells; fall back to cells for every role
  const find = (pred: (e: (typeof s.entities)[number]) => boolean, k = 0) =>
    s.entities.filter((e) => e.alive && pred(e))[k] ?? s.entities.filter((e) => e.alive)[k + 1];
  const org = find((e) => e.tier === 1 && e.parent >= 0);
  const herd = find((e) => e.tier === 2, 2);
  const cell = find((e) => e.tier === 0 && e.parent >= 0, 3);
  const free = find((e) => e.tier === 0 && e.parent < 0, 4);
  const lone = find((e) => e.tier === 1 && e.parent < 0, 5);
  // two free cells (and two lone organisms) that may combine; refused harmlessly where they can't
  const freeCells = s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0);
  const pair = freeCells.flatMap((a, i) => freeCells.slice(i + 1).map((b) => [a, b] as const)).find(([a, b]) => a.type !== b.type && a !== free && b !== free) ?? [freeCells[0], freeCells[1]];
  const lones = s.entities.filter((e) => e.alive && e.tier === 1 && e.parent < 0 && e !== lone);
  const m = new Map<number, Action[]>();
  const at = (t: number, ...a: Action[]) => m.set(t, [...(m.get(t) ?? []), ...a]);
  at(5, { kind: 'select', id: cell.id }, { kind: 'speed', speed: 2 });
  at(10, { kind: 'dragStart', id: org.id, x: org.x, y: org.y });
  for (let i = 1; i <= 20; i++) at(10 + i, { kind: 'dragMove', id: org.id, x: org.x + i * 5, y: org.y - i * 3 });
  at(31, { kind: 'dragEnd', id: org.id });
  at(40, { kind: 'detach', id: cell.id });
  at(60, { kind: 'dragStart', id: free.id, x: free.x, y: free.y });
  at(61, { kind: 'dragMove', id: free.id, x: lone.x, y: lone.y });
  at(62, { kind: 'dragEnd', id: free.id }, { kind: 'join', id: free.id, parent: lone.id });
  at(70, { kind: 'combine', ids: [pair[0].id, pair[1].id] });
  if (lones.length >= 2) at(72, { kind: 'combine', ids: [lones[0].id, lones[1].id] });
  at(80, { kind: 'isolate', id: herd.id });
  at(120, { kind: 'isolate', id: null });
  at(130, { kind: 'swap', id: org.id });
  at(150, { kind: 'swap', id: herd.id });
  return m;
}
