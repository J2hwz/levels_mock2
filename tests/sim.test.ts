import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simConfigOf } from '../src/config';
import { replay } from '../src/replay';
import { hashWorld } from '../src/sim/hash';
import { createWorld, step } from '../src/sim/world';
import { scriptedActions, testConfig, testSession } from './helpers';

function runScripted(query: string, ticks: number): string {
  const session = testSession(query);
  const script = scriptedActions(session);
  for (let t = 0; t < ticks; t++) {
    for (const a of script.get(session.state.tick) ?? []) session.act(a);
    session.tick();
  }
  return session.end();
}

describe('determinism', () => {
  it('same seed + same actions => identical hashes', () => {
    const a = runScripted('?seed=42', 400);
    const b = runScripted('?seed=42', 400);
    expect(a).toBe(b);
  });

  it('pure step() is deterministic and seed-sensitive', () => {
    const run = (seed: number) => {
      const s = createWorld(simConfigOf(testConfig(`?seed=${seed}`)));
      for (let i = 0; i < 200; i++) step(s, []);
      return hashWorld(s);
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });

  it('flat condition is deterministic too', () => {
    expect(runScripted('?seed=3&hier=0', 200)).toBe(runScripted('?seed=3&hier=0', 200));
  });
});

describe('replay', () => {
  it.each(['?seed=42', '?seed=5&hier=0', '?seed=9&eps=0.3&size=irrelevant'])(
    'replays a recorded log (%s) to the logged final hash',
    (q) => {
      const session = testSession(q);
      const script = scriptedActions(session);
      for (let t = 0; t < 650; t++) {
        for (const a of script.get(session.state.tick) ?? []) session.act(a);
        session.tick();
      }
      // a few actions while "paused" at the final tick
      session.act({ kind: 'speed', speed: 0 });
      session.end();
      // round-trip through JSON exactly like the downloaded file
      const log = JSON.parse(JSON.stringify(session.toJSON()));
      const res = replay(log);
      expect(res.mismatches).toEqual([]);
      expect(res.checkedHashes).toBeGreaterThan(10);
      expect(res.actualHash).toBe(res.expectedHash);
      expect(res.ok).toBe(true);
    },
  );

  // Recorded in Chromium by `npm run screenshots` (real pointer input, real frame timing).
  // If the sim changes, old logs stop replaying: re-run the script to refresh the fixture.
  const fixture = join(__dirname, 'fixtures', 'browser-session.json');
  it.skipIf(!existsSync(fixture))('replays the log recorded in a real browser run-through', () => {
    const log = JSON.parse(readFileSync(fixture, 'utf8'));
    const kinds = new Set(log.events.filter((e: { type: string }) => e.type === 'action').map((e: { payload: { kind: string } }) => e.payload.kind));
    expect([...kinds]).toEqual(expect.arrayContaining(['select', 'dragStart', 'dragMove', 'dragEnd', 'detach', 'join', 'isolate', 'speed']));
    const res = replay(log);
    expect(res.mismatches).toEqual([]);
    expect(res.actualHash).toBe(res.expectedHash);
  });

  it('detects a tampered log', () => {
    const session = testSession('?seed=42');
    const script = scriptedActions(session);
    for (let t = 0; t < 100; t++) {
      for (const a of script.get(session.state.tick) ?? []) session.act(a);
      session.tick();
    }
    session.end();
    const log = JSON.parse(JSON.stringify(session.toJSON()));
    const drag = log.events.find((e: { type: string; payload: { kind: string } }) => e.type === 'action' && e.payload.kind === 'dragMove');
    drag.payload.x += 1;
    expect(replay(log).ok).toBe(false);
  });
});

describe('deterministic math', () => {
  it('dsin/dcos/dhypot match Math to ~1e-13', async () => {
    const { dcos, dhypot, dsin } = await import('../src/sim/dmath');
    for (let i = -2000; i < 2000; i++) {
      const x = i * 0.0731;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-13);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-13);
      expect(Math.abs(dhypot(x, 3) - Math.hypot(x, 3))).toBeLessThan(1e-12);
    }
  });
});

describe('conditions', () => {
  it.each([...Array.from({ length: 30 }, (_, i) => i + 1), 1234, 99999])('hier and flat have the same cells (seed %i)', (seed) => {
    const h = createWorld({ hier: true, eps: 0.05, seed });
    const f = createWorld({ hier: false, eps: 0.05, seed });
    const cells = (s: typeof h) => s.entities.filter((e) => e.tier === 0).map((e) => e.type).sort();
    expect(cells(f)).toEqual(cells(h));
    expect(cells(h).length).toBeGreaterThanOrEqual(150);
    expect(cells(h).length).toBeLessThanOrEqual(200);
    expect(f.entities.every((e) => e.tier === 0 && e.parent < 0)).toBe(true);
    expect(h.entities.filter((e) => e.tier === 2).length).toBe(5);
  });

  it('organisms have 4-7 cells and herds 3-6 organisms', () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42 });
    for (const e of s.entities) {
      if (e.tier === 1) expect(e.children.length).toBeGreaterThanOrEqual(4), expect(e.children.length).toBeLessThanOrEqual(7);
      if (e.tier === 2) expect(e.children.length).toBeGreaterThanOrEqual(3), expect(e.children.length).toBeLessThanOrEqual(6);
    }
  });

  it('organisms stay intact over a minute of sim time', () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42 });
    for (let i = 0; i < 1800; i++) step(s, []);
    for (const o of s.entities.filter((e) => e.alive && e.tier === 1)) {
      for (const c of o.children) {
        const ce = s.entities[c];
        expect(Math.hypot(ce.x - o.x, ce.y - o.y)).toBeLessThan(60);
      }
    }
  });
});

describe('multiple realisation', () => {
  it('swapping a herd realisation leaves the herd trajectory (almost) unchanged', () => {
    const base = createWorld({ hier: true, eps: 0.05, seed: 11 });
    const swapped = createWorld({ hier: true, eps: 0.05, seed: 11 });
    const herd = base.entities.find((e) => e.tier === 2)!;
    step(swapped, [{ kind: 'swap', id: herd.id }]);
    step(base, []);
    const before = swapped.entities.filter((e) => e.tier === 0 && e.alive).map((e) => e.type);
    expect(before).not.toEqual(base.entities.filter((e) => e.tier === 0 && e.alive).map((e) => e.type));
    for (let i = 0; i < 300; i++) {
      step(base, []);
      step(swapped, []);
    }
    const a = base.entities[herd.id];
    const b = swapped.entities[herd.id];
    const travelled = Math.hypot(a.x - herd.x, a.y - herd.y);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(Math.max(30, travelled * 0.3));
  });
});
