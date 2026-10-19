// Replay a saved session log through sim/ and verify the state hashes.
// Live ordering (see log/session.ts): actions logged at tick t were applied while
// state.tick === t, i.e. before the step that takes the world from t to t+1.
// Hash events at tick t are logged right after that step, before tick-t actions.

import { simConfigOf } from './config';
import type { Config } from './config';
import type { SessionLog } from './log/logger';
import { hashWorld } from './sim/hash';
import { type Action, applyAction, createWorld, step } from './sim/world';

export interface ReplayResult {
  ok: boolean;
  finalTick: number;
  expectedHash: string;
  actualHash: string;
  checkedHashes: number;
  mismatches: { tick: number; expected: string; actual: string }[];
}

export function replay(log: SessionLog): ReplayResult {
  const cfg = log.header.config as unknown as Config;
  const state = createWorld(simConfigOf(cfg));

  const actionsAt = new Map<number, Action[]>();
  const hashAt = new Map<number, string>();
  let end: { tick: number; hash: string } | null = null;
  for (const ev of log.events) {
    if (ev.type === 'action') {
      const list = actionsAt.get(ev.t_tick) ?? [];
      list.push(ev.payload as Action);
      actionsAt.set(ev.t_tick, list);
    } else if (ev.type === 'hash') {
      hashAt.set(ev.t_tick, (ev.payload as { hash: string }).hash);
    } else if (ev.type === 'session_end') {
      end = ev.payload as { tick: number; hash: string };
    }
  }
  if (!end) throw new Error('log has no session_end event');

  const mismatches: ReplayResult['mismatches'] = [];
  let checked = 0;
  for (let t = 0; t < end.tick; t++) {
    step(state, actionsAt.get(t) ?? []);
    const expected = hashAt.get(state.tick);
    if (expected !== undefined) {
      checked++;
      const actual = hashWorld(state);
      if (actual !== expected) mismatches.push({ tick: state.tick, expected, actual });
    }
  }
  for (const a of actionsAt.get(end.tick) ?? []) applyAction(state, a);
  const actualHash = hashWorld(state);
  return {
    ok: actualHash === end.hash && mismatches.length === 0,
    finalTick: state.tick,
    expectedHash: end.hash,
    actualHash,
    checkedHashes: checked,
    mismatches,
  };
}
