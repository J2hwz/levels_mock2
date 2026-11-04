import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simConfigOf } from '../src/config';
import { isTaskSuccess } from '../src/experiment/generalisation';
import { replay } from '../src/replay';
import { hashWorld } from '../src/sim/hash';
import { COMPOSITION, DYNAMICS, type Dynamics, type Entity, P, PAIR_RULES, type SimEvent, type WorldState, applyAction, band, canCombine, canJoin, combineKind, createWorld, findCombineGroup, findJoinTarget, lockOn, memberTargets, pairKey, chanceOf, RULE_CAT, RULE_LOCK, type ChanceMode, naturalRadius, ringUnits, step } from '../src/sim/world';
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
  it.each(['?seed=42', '?seed=42&move=0', '?seed=42&laws=0', '?seed=5&hier=0', '?seed=9&eps=0.3&size=irrelevant', '?seed=42&lock=all&catalysis=all&similar=all', '?seed=42&lock=0&catalysis=0', '?seed=42&chance=uniform', '?seed=42&chance=none', '?seed=5&hier=0&lock=0&catalysis=0&similar=0'])(
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
    expect([...kinds]).toEqual(expect.arrayContaining(['select', 'dragStart', 'dragMove', 'dragEnd', 'detach', 'join', 'combine', 'isolate', 'speed']));
    const res = replay(log);
    expect(res.mismatches).toEqual([]);
    expect(res.actualHash).toBe(res.expectedHash);
    // the participant notepad: opened / hidden, text reported, and the last reported text is the final notes
    const types = new Set(log.events.map((e: { type: string }) => e.type));
    expect([...types]).toEqual(expect.arrayContaining(['notepad', 'notepad_toggle']));
    const notes = log.events.filter((e: { type: string }) => e.type === 'notepad');
    const final = log.events.find((e: { type: string }) => e.type === 'final_state');
    expect(final.payload.notes).toBe(notes[notes.length - 1].payload.text);
    // the report phase: three steps in order, open answers, and rules built from picture tokens
    const steps = log.events.filter((e: { type: string; payload: { op: string } }) => e.type === 'report' && e.payload.op === 'step').map((e: { payload: { step: number } }) => e.payload.step);
    expect(steps).toEqual([0, 1, 2]);
    const report = final.payload.report;
    expect(report.describe.length).toBeGreaterThan(0);
    expect(report.organise.length).toBeGreaterThan(0);
    expect(report.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'interaction', a: { tier: 0, type: 1 }, b: { tier: 0, type: 3 } }),
      expect.objectContaining({ kind: 'makeup', n: 4, member: { tier: 1, type: 0 }, whole: { tier: 2, type: 0 } }),
      expect.objectContaining({ kind: 'other' }),
    ]));
    // generalisation: one replayable log per task, each with its drops and an end record
    expect(log.generalisation.map((g: { header: { config: { task: string } } }) => g.header.config.task)).toEqual(['lock', 'catalysis']);
    for (const g of log.generalisation) {
      const r = replay(g);
      expect(r.mismatches).toEqual([]);
      expect(r.ok).toBe(true);
      expect(g.events.some((e: { type: string; payload: { kind?: string } }) => e.type === 'action' && e.payload.kind === 'spawn')).toBe(true);
      expect(g.events.find((e: { type: string }) => e.type === 'task_end').payload).toMatchObject({ task: g.header.config.task, success: true });
    }
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
    // P.freeCells loose cells, plus at most P.maxComposedCells inside organisms
    expect(h.entities.filter((e) => e.tier === 0 && e.parent < 0).length).toBe(P.freeCells);
    expect(h.entities.filter((e) => e.tier === 0 && e.parent >= 0).length).toBeLessThanOrEqual(P.maxComposedCells);
    expect(f.entities.every((e) => e.tier === 0 && e.parent < 0)).toBe(true);
    expect(h.entities.filter((e) => e.tier === 2).length).toBe(P.nHerds);
  });

  it.each([
    [undefined, undefined],
    [[4, 9], [2, 5]],
  ] as const)('generated composites sit inside their size band (org %j, herd %j)', (org, herd) => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42, org, herd });
    const [omin, ounst] = band(s.config, 1);
    const [hmin, hunst] = band(s.config, 2);
    for (const e of s.entities) {
      if (e.tier === 1) expect(e.children.length).toBeGreaterThanOrEqual(omin), expect(e.children.length).toBeLessThan(ounst);
      if (e.tier === 2) expect(e.children.length).toBeGreaterThanOrEqual(hmin), expect(e.children.length).toBeLessThan(hunst);
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

describe('combining', () => {
  const world = (hier = true) => createWorld({ hier, eps: 0.05, seed: 42 });
  const free = (s: WorldState, tier: number) => s.entities.filter((e) => e.alive && e.tier === tier && e.parent < 0);
  const combinable = (s: WorldState, tier: number) => {
    const fs = free(s, tier);
    for (const a of fs) for (const b of fs) if (canCombine(s, [a.id, b.id])) return [a, b] as const;
    throw new Error('no combinable pair');
  };

  it('two loose cells found a new organism of a species that accepts both', () => {
    const s = world();
    const [a, b] = combinable(s, 0);
    const evs = applyAction(s, { kind: 'combine', ids: [a.id, b.id] });
    const ev = evs.find((e): e is Extract<SimEvent, { kind: 'founded' }> => e.kind === 'founded')!;
    expect(ev).toBeDefined();
    const o = s.entities[ev.id];
    expect(o.tier).toBe(1);
    expect(o.children).toEqual([a.id, b.id]);
    expect(a.parent).toBe(o.id);
    expect(b.parent).toBe(o.id);
    expect(o.type).toBe(combineKind(s, 0, [a.type, b.type])!.type);
    // further loose cells can then join it the usual way
    const third = free(s, 0).find((c) => canJoin(s, c.id, o.id));
    expect(third).toBeDefined();
  });

  it('two loose organisms found a new herd', () => {
    const s = world();
    const [a, b] = combinable(s, 1);
    applyAction(s, { kind: 'combine', ids: [a.id, b.id] });
    const h = s.entities[a.parent];
    expect(h.tier).toBe(2);
    expect(h.children).toEqual([a.id, b.id]);
  });

  it('refuses combinations the grammar or the situation does not allow', () => {
    const s = world();
    const [a, b] = combinable(s, 0);
    const member = s.entities.find((e) => e.alive && e.tier === 0 && e.parent >= 0)!;
    const lone = free(s, 1)[0];
    const herds = s.entities.filter((e) => e.tier === 2);
    expect(canCombine(s, [a.id, a.id])).toBe(false);
    expect(canCombine(s, [a.id, member.id])).toBe(false);
    expect(canCombine(s, [a.id, lone.id])).toBe(false);
    expect(canCombine(s, [herds[0].id, herds[1].id])).toBe(false);
    // a type no species uses
    s.grammar.species = s.grammar.species.map((rs) => rs.map((rc) => rc.filter((t) => t !== b.type)));
    expect(canCombine(s, [a.id, b.id])).toBe(false);
    const t = world();
    applyAction(t, { kind: 'isolate', id: a.id });
    expect(canCombine(t, [a.id, b.id])).toBe(false);
    const f = world(false);
    expect(canCombine(f, [f.entities[0].id, f.entities[1].id])).toBe(false);
    const n = f.entities.length;
    applyAction(f, { kind: 'combine', ids: [0, 1] });
    expect(f.entities.length).toBe(n);
  });

  it('a founded organism holds together over 10 s of sim time', () => {
    const s = world();
    const [a, b] = combinable(s, 0);
    applyAction(s, { kind: 'combine', ids: [a.id, b.id] });
    const o = s.entities[a.parent];
    for (let i = 0; i < 300; i++) step(s, []);
    if (!o.alive) return; // it may legitimately die of stress; then its cells are free again
    for (const c of o.children) expect(Math.hypot(s.entities[c].x - o.x, s.entities[c].y - o.y)).toBeLessThan(60);
  });
});

describe('still world (move=0)', () => {
  const still = (seed = 42, hier = true) => createWorld({ hier, eps: 0.05, seed, move: false });
  const run = (s: WorldState, ticks: number, actions: Parameters<typeof step>[1] = []) => {
    step(s, actions);
    for (let i = 1; i < ticks; i++) step(s, []);
  };

  it.each([true, false])('nothing drifts once settled (hier=%s)', (hier) => {
    const s = still(42, hier);
    run(s, 90); // contact repulsion and springs settle the generated layout
    const before = s.entities.map((e) => [e.x, e.y]);
    run(s, 300);
    for (const e of s.entities) {
      if (!e.alive) continue;
      expect(Math.hypot(e.x - before[e.id][0], e.y - before[e.id][1])).toBeLessThan(1);
    }
  });

  it('combined members still settle into their slots', () => {
    const s = still();
    run(s, 90);
    const free = s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0);
    let pair: [number, number] | null = null;
    for (const a of free) for (const b of free) if (!pair && canCombine(s, [a.id, b.id])) pair = [a.id, b.id];
    run(s, 90, [{ kind: 'combine', ids: pair! }]);
    const o = s.entities[s.entities[pair![0]].parent];
    const targets = memberTargets(s, o);
    o.children.forEach((c) => {
      const [tx, ty] = targets.get(c)!;
      expect(Math.hypot(s.entities[c].x - tx, s.entities[c].y - ty)).toBeLessThan(3);
    });
  });

  it('is deterministic', () => {
    const go = () => {
      const s = still(7);
      run(s, 200);
      return hashWorld(s);
    };
    expect(go()).toBe(go());
  });
});

// ---------------------------------------------------------------- laws off

describe('laws=0', () => {
  const world = (laws: boolean) => createWorld({ hier: true, eps: 0.05, seed: 42, laws });

  it('generates exactly the same starting world as laws=1', () => {
    // (hashes differ by design: laws=0 also hashes the random-walk heading)
    expect(world(false).entities).toEqual(world(true).entities);
  });

  it('zeroes every matrix, swimming speed and turning rate', () => {
    const l = world(false).laws;
    for (const m of [l.K0, l.K1, l.K2, l.Kflat]) expect(m.flat().every((v) => v === 0)).toBe(true);
    for (const v of [l.cruise1, l.cruise2, l.spin1, l.spin2]) expect(v.every((x) => x === 0)).toBe(true);
  });

  it('movement no longer depends on type: relabelling free cells changes nothing', () => {
    const run = (laws: boolean, relabel: boolean) => {
      const s = world(laws);
      if (relabel) for (const e of s.entities) if (e.tier === 0 && e.parent < 0) e.type = (e.type + 1) % 3;
      for (let i = 0; i < 300; i++) step(s, []);
      return s.entities.map((e) => [e.x, e.y]);
    };
    expect(run(false, true)).toEqual(run(false, false));
    expect(run(true, true)).not.toEqual(run(true, false)); // with laws, type matters
  });

  it('the random walk roams far further than plain jiggle (wander=0)', () => {
    const travel = (wander: number) => {
      const s = createWorld({ hier: true, eps: 0.05, seed: 42, laws: false, wander });
      const start = s.entities.map((e) => [e.x, e.y]);
      for (let i = 0; i < 900; i++) step(s, []);
      const free = s.entities.filter((e) => e.alive && e.tier === 1 && e.parent < 0);
      return free.reduce((a, e) => a + Math.hypot(e.x - start[e.id][0], e.y - start[e.id][1]), 0) / free.length;
    };
    expect(travel(1)).toBeGreaterThan(5 * travel(0));
  });

  it('free organisms and herds random-walk instead of swimming and turning', () => {
    const s = world(false);
    const free = s.entities.filter((e) => e.alive && e.tier > 0 && e.parent < 0);
    const start = free.map((e) => ({ x: e.x, y: e.y, angle: e.angle }));
    for (let i = 0; i < 300; i++) step(s, []);
    free.forEach((e, i) => {
      expect(e.angle).toBe(start[i].angle);
      expect(Math.hypot(e.x - start[i].x, e.y - start[i].y)).toBeGreaterThan(1);
    });
  });
});

// ---------------------------------------------------------------- same-level dynamics and size bands

const OFF = [false, false, false];
function dynWorld(dyn: Partial<Dynamics>, opts: { seed?: number; hier?: boolean; move?: boolean } = {}): WorldState {
  return createWorld({
    hier: opts.hier ?? true,
    eps: 0.05,
    seed: opts.seed ?? 42,
    move: opts.move ?? true,
    dyn: { lock: false, catalysis: false, similar: OFF, ...dyn },
  });
}
const lvl = (t: number) => [0, 1, 2].map((i) => i === t);
/** a point with nothing alive within `clear` units */
function emptySpot(s: WorldState, clear = 120): [number, number] {
  // the world is crowded: settle for less room if needed (never below 100 units)
  for (let c = clear; c >= 100; c -= 10) {
    for (let y = 150; y < 1500; y += 25) {
      for (let x = 150; x < 2300; x += 25) {
        if (s.entities.every((e) => !e.alive || Math.hypot(e.x - x, e.y - y) > c)) return [x, y];
      }
    }
  }
  throw new Error('no empty spot');
}
/** move an entity (and its parts) like a drag-and-drop would */
function place(s: WorldState, id: number, x: number, y: number): void {
  applyAction(s, { kind: 'dragStart', id, x, y });
  applyAction(s, { kind: 'dragEnd', id });
}
const ticks = (s: WorldState, n: number, evs: SimEvent[] = []) => {
  for (let i = 0; i < n; i++) evs.push(...step(s, []));
  return evs;
};

/** run with DYNAMICS / COMPOSITION fields temporarily changed, always restored */
function withSettings<T>(change: () => void, run: () => T): T {
  const savedD = JSON.parse(JSON.stringify(DYNAMICS));
  const savedC = JSON.parse(JSON.stringify(COMPOSITION));
  try {
    change();
    return run();
  } finally {
    Object.assign(DYNAMICS, savedD);
    Object.assign(COMPOSITION, savedC);
  }
}
/** a small, still world: cheap to step, nothing drifts, so placed things stay where they are put */
const smallWorld = (dyn: Partial<Dynamics>, chance: ChanceMode = 'graded') =>
  createWorld({ hier: true, eps: 0.05, seed: 42, move: false, free: 40, herds: 2, lone: 6, chance, dyn: { lock: false, catalysis: false, similar: OFF, ...dyn } });
/** ticks until a roll made now has taken effect */
const REVEAL = DYNAMICS.revealTicks + 1;
/** two free things of `tier`, recoloured to types ta / tb, placed in an empty spot `gap` apart (edge to edge) */
function meetPair(s: WorldState, tier: number, ta: number, tb: number, gap: number) {
  const free = s.entities.filter((e) => e.alive && e.tier === tier && e.parent < 0 && e.bond < 0);
  const a = tier === 0 ? free.find((e) => e.type === ta)! : free[0];
  const b = tier === 0 ? free.find((e) => e.type === tb && e !== a)! : free[1];
  a.type = ta;
  b.type = tb;
  const [x, y] = emptySpot(s, tier === 2 ? 100 : 120);
  place(s, a.id, x, y);
  place(s, b.id, x + naturalRadius(s, a) + naturalRadius(s, b) + gap, y);
  return [a, b] as const;
}
/** move b far from a (ending the encounter) and step once so the encounter is forgotten */
function separate(s: WorldState, a: Entity, b: Entity) {
  applyAction(s, { kind: 'detach', id: a.id });
  place(s, b.id, a.x + naturalRadius(s, a) + naturalRadius(s, b) + 400, a.y);
  ticks(s, 1);
}
/** fraction of `n` fresh encounters at `tier` for which `fired` holds once the roll has taken effect */
function successRate(s: WorldState, tier: number, ta: number, tb: number, n: number, fired: (a: Entity, b: Entity) => boolean) {
  const [a, b] = meetPair(s, tier, ta, tb, 400);
  ticks(s, 1);
  let hits = 0;
  for (let i = 0; i < n; i++) {
    place(s, b.id, a.x + naturalRadius(s, a) + naturalRadius(s, b) + 1, a.y);
    b.spin = 0;
    ticks(s, REVEAL);
    if (fired(a, b)) hits++;
    separate(s, a, b);
  }
  return hits / n;
}
/** bonds are only ever between two things of the same level that are both free or share a parent */
const bondsValid = (s: WorldState) =>
  s.entities.every((e) => {
    if (!e.alive || e.bond < 0) return true;
    const b = s.entities[e.bond];
    return b.alive && b.bond === e.id && b.tier === e.tier && e.parent === b.parent;
  });
const ALWAYS = [1, 1, 1];
const PURPLE = 1;
const GREEN = 3;
const LIGHT_BLUE = 0;
const RED = 2;

describe('lock & key (purple + green, every level, chance per encounter)', () => {
  it('free purple and green cells in contact bind, drag as one, and Shift-drag separates them', () =>
    withSettings(
      () => (DYNAMICS.lockChance = ALWAYS),
      () => {
        const s = dynWorld({ lock: true });
        const [a, b] = meetPair(s, 0, PURPLE, GREEN, 0);
        ticks(s, REVEAL);
        expect(a.bond).toBe(b.id);
        expect(b.bond).toBe(a.id);
        ticks(s, 120);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(14); // held touching through drift
        const [bx, by] = [b.x, b.y];
        applyAction(s, { kind: 'dragStart', id: a.id, x: a.x + 100, y: a.y + 40 });
        expect(b.x - bx).toBeCloseTo(100, 6);
        expect(b.y - by).toBeCloseTo(40, 6);
        applyAction(s, { kind: 'dragEnd', id: a.id });
        applyAction(s, { kind: 'detach', id: a.id });
        expect(a.bond).toBe(-1);
        expect(b.bond).toBe(-1);
      },
    ));

  it('only purple + green bind, and only with lock on', () =>
    withSettings(
      () => (DYNAMICS.lockChance = ALWAYS),
      () => {
        const s = smallWorld({ lock: true });
        const [a] = meetPair(s, 0, PURPLE, RED, 0);
        ticks(s, 30);
        expect(a.bond).toBe(-1);
        const off = smallWorld({});
        meetPair(off, 0, PURPLE, GREEN, 0);
        ticks(off, 30);
        expect(off.entities.every((e) => e.bond === -1)).toBe(true);
      },
    ));

  it('organisms and herds bind too, but never across levels', () =>
    withSettings(
      () => (DYNAMICS.lockChance = ALWAYS),
      () => {
        for (const tier of [1, 2]) {
          const s = smallWorld({ lock: true });
          const [a, b] = meetPair(s, tier, PURPLE, GREEN, 1);
          ticks(s, REVEAL);
          expect(a.bond).toBe(b.id);
        }
        // a purple cell against a green organism: different levels, so nothing happens
        const s = smallWorld({ lock: true });
        const cell = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === PURPLE)!;
        const org = s.entities.find((e) => e.alive && e.tier === 1 && e.parent < 0)!;
        org.type = GREEN;
        const [x, y] = emptySpot(s, 150);
        place(s, org.id, x, y);
        place(s, cell.id, x + naturalRadius(s, org) + P.cellR, y);
        ticks(s, 30);
        expect(cell.bond).toBe(-1);
        expect(org.bond).toBe(-1);
      },
    ));

  it('binds at about the configured rate per level (90% cells, 40% organisms, 10% herds)', () => {
    const s = smallWorld({ lock: true });
    DYNAMICS.lockChance.forEach((chance, tier) => {
      const rate = successRate(s, tier, PURPLE, GREEN, 300, (a, b) => a.bond === b.id);
      expect(Math.abs(rate - chance)).toBeLessThan(0.08);
    });
  });

  it('one roll per encounter: no new roll while they stay near or wiggle, a new one after they move apart', () =>
    withSettings(
      () => (DYNAMICS.lockChance = [1e-12, 0.4, 0.1]), // (exactly 0 would switch the level off: no roll at all)
      () => {
        const s = smallWorld({ lock: true });
        const [a, b] = meetPair(s, 0, PURPLE, GREEN, 0);
        ticks(s, REVEAL); // rolled at a ~0 chance: fails
        const first = s.contacts.get(pairKey(a.id, b.id))!;
        expect(first.rules).toBe(RULE_LOCK);
        expect(first.ok).toBe(0);
        DYNAMICS.lockChance[0] = 1;
        ticks(s, 30);
        expect(a.bond).toBe(-1); // still the same encounter: no new roll
        // wiggle out of range but not apart, and back
        const touch = naturalRadius(s, a) + naturalRadius(s, b);
        place(s, b.id, a.x + touch + DYNAMICS.apartMargin[0] - 2, a.y);
        ticks(s, 2);
        place(s, b.id, a.x + touch + 1, a.y);
        ticks(s, REVEAL);
        expect(a.bond).toBe(-1);
        expect(s.contacts.get(pairKey(a.id, b.id))!.tick).toBe(first.tick);
        // properly apart, then back: a new encounter rolls again
        place(s, b.id, a.x + 400, a.y);
        ticks(s, 1);
        expect(s.contacts.has(pairKey(a.id, b.id))).toBe(false);
        place(s, b.id, a.x + touch + 1, a.y);
        ticks(s, REVEAL);
        expect(a.bond).toBe(b.id);
      },
    ));

  it('dragged into range, a roll happens during the drag; on success the partner snaps on and follows the drag', () =>
    withSettings(
      () => (DYNAMICS.lockChance = ALWAYS),
      () => {
        const s = smallWorld({ lock: true });
        const [a, b] = meetPair(s, 0, PURPLE, GREEN, 300);
        const near = b.x - (naturalRadius(s, a) + naturalRadius(s, b) + DYNAMICS.rangeMargin[0] - 2);
        applyAction(s, { kind: 'dragStart', id: a.id, x: a.x, y: a.y });
        applyAction(s, { kind: 'dragMove', id: a.id, x: near, y: b.y });
        const evs = ticks(s, REVEAL);
        expect(a.bond).toBe(b.id); // bound while still held
        expect(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 2 * P.cellR)).toBeLessThan(0.5); // snapped to touching
        expect(evs.filter((e) => e.kind === 'encounter')).toEqual([{ kind: 'encounter', rule: 'lock', tier: 0, a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), ok: true }]);
        const bx = b.x;
        applyAction(s, { kind: 'dragMove', id: a.id, x: a.x + 80, y: a.y });
        expect(b.x - bx).toBeCloseTo(80, 6);
        applyAction(s, { kind: 'dragEnd', id: a.id });
      },
    ));

  it('loose purple and green near each other pull together and bind', () =>
    withSettings(
      () => (DYNAMICS.lockChance = ALWAYS),
      () => {
        const binds = (tb: number, pull: boolean) => {
          const s = dynWorld({ lock: true });
          if (!pull) DYNAMICS.lockAttract[0] = 0;
          s.laws.K0[PURPLE][tb] = 0; // isolate the pull from the seed's laws
          s.laws.K0[tb][PURPLE] = 0;
          const [a, b] = meetPair(s, 0, PURPLE, tb, 20);
          ticks(s, 60);
          DYNAMICS.lockAttract[0] = 50;
          return a.bond === b.id;
        };
        expect(binds(GREEN, true)).toBe(true);
        expect(binds(RED, true)).toBe(false); // red is not purple's key
        expect(binds(GREEN, false)).toBe(false); // without the pull they stay apart
      },
    ));

  it('a bound pair of cells mildly pushes other cells away, so pairs do not clump', () =>
    withSettings(
      () => (DYNAMICS.lockChance = ALWAYS),
      () => {
        const s = dynWorld({ lock: true }, { move: false });
        const [a, b] = meetPair(s, 0, PURPLE, GREEN, 0);
        ticks(s, 1);
        const c = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === RED)!;
        place(s, c.id, a.x, a.y + 13);
        ticks(s, 60);
        expect(Math.min(Math.hypot(c.x - a.x, c.y - a.y), Math.hypot(c.x - b.x, c.y - b.y))).toBeGreaterThan(20);
      },
    ));

  it('bonds stay within a level and within a whole (2 min of a busy world)', () => {
    const s = dynWorld({ lock: true });
    for (let i = 0; i < 30 * 120; i++) {
      step(s, []);
      if (i % 300 === 0) expect(bondsValid(s)).toBe(true);
    }
    expect(bondsValid(s)).toBe(true);
  });

  it('with mixed recipes, purple + green members of a whole pair up and stay attached when Shift-dragged out', () =>
    withSettings(
      () => {
        DYNAMICS.lockChance = ALWAYS;
        COMPOSITION.mode = 'custom';
        COMPOSITION.custom.organism[PURPLE] = [[0, 3, 0, 2], [0, 4, 0, 3]];
      },
      () => {
        const s = dynWorld({ lock: true });
        const purpleOrgs = s.entities.filter((e) => e.tier === 1 && e.type === PURPLE);
        expect(purpleOrgs.length).toBeGreaterThan(0);
        for (const o of purpleOrgs) {
          const bound = o.children.filter((c) => s.entities[c].bond >= 0).length / 2;
          expect(bound).toBe(2);
        }
        const a = s.entities[purpleOrgs[0].children.find((c) => s.entities[c].bond >= 0)!];
        const b = s.entities[a.bond];
        applyAction(s, { kind: 'detach', id: a.id });
        expect(a.parent).toBe(-1);
        expect(b.parent).toBe(-1);
        expect(a.bond).toBe(b.id);
        expect(bondsValid(s)).toBe(true);
      },
    ));
});

describe('catalysis (light blue makes red spin, every level, chance per encounter)', () => {
  it('a red organism spins while a light blue one touches it, keeps spinning for a while after, then stops', () =>
    withSettings(
      () => (DYNAMICS.catChance = ALWAYS),
      () => {
        const s = smallWorld({ catalysis: true });
        const [cat, target] = meetPair(s, 1, LIGHT_BLUE, RED, 4);
        ticks(s, REVEAL); // the line shows, then the spin starts
        const a0 = target.angle;
        ticks(s, 30);
        expect(target.spin).toBeCloseTo(DYNAMICS.catSpin[1], 6);
        expect(target.angle - a0).toBeGreaterThan(DYNAMICS.catSpin[1] - 0.5);
        expect(cat.spin).toBe(0); // one-way
        place(s, cat.id, cat.x + 400, cat.y);
        ticks(s, 15);
        expect(target.spin).toBeGreaterThan(1);
        expect(target.spin).toBeLessThan(DYNAMICS.catSpin[1]);
        ticks(s, 90);
        expect(target.spin).toBe(0);
      },
    ));

  it('cells and herds spin too; never across levels; nothing with catalysis off', () =>
    withSettings(
      () => (DYNAMICS.catChance = ALWAYS),
      () => {
        for (const tier of [0, 2]) {
          const s = smallWorld({ catalysis: true });
          const [, target] = meetPair(s, tier, LIGHT_BLUE, RED, 1);
          ticks(s, REVEAL + 2);
          expect(target.spin).toBeCloseTo(DYNAMICS.catSpin[tier], 6);
        }
        const off = smallWorld({});
        const [, t] = meetPair(off, 1, LIGHT_BLUE, RED, 1);
        ticks(off, REVEAL + 2);
        expect(t.spin).toBe(0);
        // a light blue cell against a red organism: different levels
        const s = smallWorld({ catalysis: true });
        const cell = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === LIGHT_BLUE)!;
        const org = s.entities.find((e) => e.alive && e.tier === 1 && e.parent < 0)!;
        org.type = RED;
        const [x, y] = emptySpot(s, 150);
        place(s, org.id, x, y);
        place(s, cell.id, x + naturalRadius(s, org) + P.cellR, y);
        ticks(s, REVEAL + 2);
        expect(org.spin).toBe(0);
      },
    ));

  it('a catalyst dragged into range rolls during the drag, and the target spins while it is still held', () =>
    withSettings(
      () => (DYNAMICS.catChance = ALWAYS),
      () => {
        for (const tier of [0, 1, 2]) {
          const s = smallWorld({ catalysis: true });
          const [cat, target] = meetPair(s, tier, LIGHT_BLUE, RED, 400);
          const touch = naturalRadius(s, cat) + naturalRadius(s, target);
          applyAction(s, { kind: 'dragStart', id: cat.id, x: cat.x, y: cat.y });
          applyAction(s, { kind: 'dragMove', id: cat.id, x: target.x - touch - DYNAMICS.rangeMargin[tier] + 2, y: target.y });
          ticks(s, 1);
          const enc = s.contacts.get(pairKey(cat.id, target.id))!;
          expect(enc.rules).toBe(RULE_CAT);
          expect(target.spin).toBe(0); // the line shows first
          ticks(s, REVEAL);
          expect(target.spin).toBeGreaterThan(0); // spinning while the catalyst is still held
          // wiggling within the apart band never rolls again
          applyAction(s, { kind: 'dragMove', id: cat.id, x: target.x - touch - DYNAMICS.apartMargin[tier] + 2, y: target.y });
          ticks(s, 3);
          applyAction(s, { kind: 'dragMove', id: cat.id, x: target.x - touch - 1, y: target.y });
          ticks(s, 3);
          expect(s.contacts.get(pairKey(cat.id, target.id))!.tick).toBe(enc.tick);
          applyAction(s, { kind: 'dragEnd', id: cat.id });
        }
      },
    ));

  it('fires at about the configured rate per level (40% cells, 90% organisms, 10% herds)', () => {
    const s = smallWorld({ catalysis: true });
    DYNAMICS.catChance.forEach((chance, tier) => {
      const rate = successRate(s, tier, LIGHT_BLUE, RED, 300, (_a, b) => b.spin > 0);
      expect(Math.abs(rate - chance)).toBeLessThan(0.08);
    });
  });

  it('with mixed recipes, a catalyst and its target sit together in a herd and the target keeps spinning', () =>
    withSettings(
      () => {
        DYNAMICS.catChance = ALWAYS;
        COMPOSITION.mode = 'custom';
        COMPOSITION.custom.herd[LIGHT_BLUE] = [[2, 0, 2, 0], [3, 0, 2, 0]];
      },
      () => {
        const s = dynWorld({ catalysis: true });
        const herd = s.entities.find((h) => h.tier === 2 && h.type === LIGHT_BLUE)!;
        const pair = ringUnits(s, herd).find((u) => u.length === 2)!;
        const [c, t] = pair.map((id) => s.entities[id]);
        expect([c.type, t.type]).toEqual([LIGHT_BLUE, RED]);
        ticks(s, 90);
        expect(Math.hypot(c.x - t.x, c.y - t.y) - naturalRadius(s, c) - naturalRadius(s, t)).toBeLessThan(DYNAMICS.rangeMargin[1]);
        expect(t.spin).toBeCloseTo(DYNAMICS.catSpin[1], 6);
      },
    ));
});

describe('chance conditions (chance=graded|uniform|none)', () => {
  it('uniform: every level gets the mean of its table', () => {
    const c = { hier: true, eps: 0.05, seed: 1, chance: 'uniform' as ChanceMode };
    for (const tier of [0, 1, 2]) {
      expect(chanceOf(c, 'lock', tier)).toBeCloseTo((0.9 + 0.4 + 0.1) / 3, 12);
      expect(chanceOf(c, 'catalysis', tier)).toBeCloseTo((0.4 + 0.9 + 0.1) / 3, 12);
    }
    const s = smallWorld({ lock: true }, 'uniform');
    for (const tier of [0, 1, 2]) {
      const rate = successRate(s, tier, PURPLE, GREEN, 300, (a, b) => a.bond === b.id);
      expect(Math.abs(rate - 0.467)).toBeLessThan(0.08);
    }
  });

  it('none: no rolls, no bonds, no spin, no pre-binding pull at any level', () => {
    for (const tier of [0, 1, 2]) {
      const s = smallWorld({ lock: true, catalysis: true }, 'none');
      const [a, b] = meetPair(s, tier, PURPLE, GREEN, 1);
      const [c, t] = meetPair(s, tier, LIGHT_BLUE, RED, 1);
      ticks(s, REVEAL + 5);
      expect(s.contacts.size).toBe(0);
      expect(a.bond).toBe(-1);
      expect(t.spin).toBe(0);
      expect([b.bond, c.spin]).toEqual([-1, 0]);
    }
    expect(lockOn({ hier: true, eps: 0.05, seed: 1, chance: 'none', dyn: { lock: true, catalysis: true, similar: OFF } }, 0)).toBe(false);
  });

  it('every roll is logged once, as an encounter event with its result', () =>
    withSettings(
      () => (DYNAMICS.lockChance = [1e-12, 1, 1]),
      () => {
        const s = smallWorld({ lock: true });
        meetPair(s, 0, PURPLE, GREEN, 1);
        const evs = ticks(s, REVEAL + 20).filter((e) => e.kind === 'encounter');
        expect(evs).toHaveLength(1);
        expect(evs[0]).toMatchObject({ rule: 'lock', tier: 0, ok: false });
      },
    ));
});

describe('composition (COMPOSITION)', () => {
  it("'same' (default): every organism is made of its own colour, every herd of its own colour, recipes 5/7 and 4/6", () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42 });
    s.grammar.species.forEach((rs, k) => expect(rs).toEqual([Array(5).fill(k), Array(7).fill(k)]));
    s.grammar.herds.forEach((rs, k) => expect(rs).toEqual([Array(4).fill(k), Array(6).fill(k)]));
    for (const e of s.entities) if (e.tier > 0) for (const c of e.children) expect(s.entities[c].type).toBe(e.type);
    expect(new Set(s.entities.filter((e) => e.tier === 2).map((e) => e.type)).size).toBe(4); // all four colours appear
  });

  it("'pairs': own colour plus its partner, 3:2 in a recipe of 5", () =>
    withSettings(
      () => (COMPOSITION.mode = 'pairs'),
      () => {
        const s = createWorld({ hier: true, eps: 0.05, seed: 42 });
        expect(s.grammar.species[PURPLE][0]).toEqual([PURPLE, PURPLE, PURPLE, RED, RED]);
        expect(s.grammar.species[LIGHT_BLUE][0]).toEqual([LIGHT_BLUE, LIGHT_BLUE, LIGHT_BLUE, GREEN, GREEN]);
      },
    ));

  it("'custom': exactly the given counts", () =>
    withSettings(
      () => {
        COMPOSITION.mode = 'custom';
        COMPOSITION.custom.organism[GREEN] = [[1, 0, 0, 4], [0, 2, 0, 4]];
      },
      () => {
        const s = createWorld({ hier: true, eps: 0.05, seed: 42 });
        expect(s.grammar.species[GREEN]).toEqual([[0, 3, 3, 3, 3], [1, 1, 3, 3, 3, 3]]);
        expect(s.grammar.species[RED][0]).toEqual([2, 2, 2, 2, 2]);
      },
    ));

  it('only same-colour things join or combine by default', () => {
    const s = dynWorld({}, { move: false });
    const org = s.entities.find((e) => e.alive && e.tier === 1 && e.parent < 0 && e.children.length < 7)!;
    const same = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === org.type)!;
    const other = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type !== org.type)!;
    expect(canJoin(s, same.id, org.id)).toBe(true);
    expect(canJoin(s, other.id, org.id)).toBe(false);
    const purples = s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === PURPLE);
    const green = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === GREEN)!;
    expect(canCombine(s, [purples[0].id, purples[1].id])).toBe(true);
    expect(canCombine(s, [purples[0].id, green.id])).toBe(false);
    expect(combineKind(s, 0, [PURPLE, PURPLE])).toEqual({ type: PURPLE, realisation: 0 });
  });

  it('swap toggles a same-colour organism between its two sizes', () => {
    const s = dynWorld({}, { move: false });
    const o = s.entities.find((e) => e.alive && e.tier === 1 && e.parent < 0)!;
    expect(o.children.length).toBe(5);
    applyAction(s, { kind: 'swap', id: o.id });
    expect(o.children.length).toBe(7);
    expect(o.children.every((c) => s.entities[c].type === o.type)).toBe(true);
  });
});

describe('combining a touching group (the C key)', () => {
  it('collects everything touching, transitively, and nothing else', () => {
    const s = dynWorld({}, { move: false });
    const ambers = s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 2).slice(0, 4);
    const [x, y] = emptySpot(s, 200);
    place(s, ambers[0].id, x, y);
    place(s, ambers[1].id, x + 12, y);
    place(s, ambers[2].id, x + 24, y);
    place(s, ambers[3].id, x + 120, y);
    expect(findCombineGroup(s, ambers[0].id)).toEqual([ambers[0].id, ambers[1].id, ambers[2].id]);
  });

  it('three touching cells become one organism of three', () => {
    const s = dynWorld({}, { move: false });
    const cells = s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 2).slice(0, 3);
    const [x, y] = emptySpot(s, 200);
    cells.forEach((c, i) => place(s, c.id, x + 12 * i, y));
    const group = findCombineGroup(s, cells[0].id);
    expect(canCombine(s, group)).toBe(true);
    applyAction(s, { kind: 'combine', ids: group });
    const o = s.entities[cells[0].parent];
    expect(o.tier).toBe(1);
    expect(o.children.slice().sort()).toEqual(cells.map((c) => c.id).sort());
  });
});

describe('collision between levels', () => {
  it('a loose cell pushed into a herd ends up outside it', () => {
    const s = dynWorld({}, { move: false });
    const herd = s.entities.find((e) => e.tier === 2)!;
    const cell = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0)!;
    const rH = naturalRadius(s, herd);
    place(s, cell.id, herd.x + rH - 3, herd.y);
    ticks(s, 90);
    expect(Math.hypot(cell.x - herd.x, cell.y - herd.y)).toBeGreaterThan(rH + P.cellR - 1.5);
  });

  it('a lone organism pushed into a herd ends up outside it', () => {
    const s = dynWorld({}, { move: false });
    const herd = s.entities.find((e) => e.tier === 2)!;
    const o = s.entities.find((e) => e.alive && e.tier === 1 && e.parent < 0)!;
    const rH = naturalRadius(s, herd);
    const rO = naturalRadius(s, o);
    place(s, o.id, herd.x + rH + rO - 10, herd.y);
    ticks(s, 120);
    expect(Math.hypot(o.x - herd.x, o.y - herd.y)).toBeGreaterThan(rH + rO - 2);
  });

  it('something stopped at an edge can still join', () => {
    const s = dynWorld({}, { move: false });
    const o = s.entities.find((e) => e.alive && e.tier === 1 && e.parent < 0)!;
    const cell = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && canJoin(s, e.id, o.id))!;
    place(s, cell.id, o.x + naturalRadius(s, o) + P.cellR + 1, o.y);
    ticks(s, 30);
    expect(findJoinTarget(s, cell.id)).toBe(o.id);
  });
});

describe('similarity', () => {
  it('like cells gather (flat world, where nothing else attracts)', () => {
    // share of close pairs (< 30 units) that are the same colour, sampled over 10-40 s
    const likeShare = (on: boolean) => {
      const s = dynWorld({ similar: on ? lvl(0) : OFF }, { hier: false, seed: 3 });
      let same = 0;
      let all = 0;
      for (let t = 0; t < 1200; t++) {
        step(s, []);
        if (t < 300 || t % 30) continue;
        const cells = s.entities.filter((e) => e.alive);
        for (let i = 0; i < cells.length; i++) {
          for (let j = i + 1; j < cells.length; j++) {
            if (Math.hypot(cells[i].x - cells[j].x, cells[i].y - cells[j].y) >= 30) continue;
            all++;
            if (cells[i].type === cells[j].type) same++;
          }
        }
      }
      return same / all;
    };
    expect(likeShare(false)).toBeLessThan(0.6);
    expect(likeShare(true)).toBeGreaterThan(0.9);
  });
});

describe('size band', () => {
  const founded = (s: WorldState, tier: number) => {
    const free = s.entities.filter((e) => e.alive && e.tier === tier && e.parent < 0);
    for (const a of free) for (const b of free) if (canCombine(s, [a.id, b.id])) {
      applyAction(s, { kind: 'combine', ids: [a.id, b.id] });
      return s.entities[a.parent];
    }
    throw new Error('nothing to combine');
  };

  it('a 2-cell founding drains and falls apart unless grown to the minimum', () => {
    const s = dynWorld({}, { move: false });
    const o = founded(s, 0);
    const evs = ticks(s, 30 * 25);
    expect(o.alive).toBe(false);
    expect(evs).toContainEqual(expect.objectContaining({ kind: 'organism_death', id: o.id, cause: 'size' }));

    const t = dynWorld({}, { move: false });
    const g = founded(t, 0);
    for (const c of t.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0)) {
      if (g.children.length >= 5) break;
      if (canJoin(t, c.id, g.id)) applyAction(t, { kind: 'join', id: c.id, parent: g.id });
    }
    expect(g.children.length).toBe(5);
    ticks(t, 30 * 30);
    expect(g.alive).toBe(true);
  });

  it('over-filling to the unstable size makes it drain', () => {
    const s = dynWorld({}, { move: false });
    const o = s.entities.find((e) => e.tier === 1 && e.parent < 0)!;
    for (const c of s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0)) {
      if (o.children.length >= 8) break;
      if (canJoin(s, c.id, o.id)) applyAction(s, { kind: 'join', id: c.id, parent: o.id });
    }
    expect(o.children.length).toBe(8);
    const free = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && canJoin(s, e.id, o.id));
    expect(free).toBeUndefined(); // no joins past the unstable size
    ticks(s, 60);
    expect(o.health).toBeLessThan(0.95);
  });

  it('a 2-organism herd dissolves and frees its organisms', () => {
    const s = dynWorld({}, { move: false });
    const h = founded(s, 1);
    const members = h.children.slice();
    const evs = ticks(s, 30 * 25);
    expect(h.alive).toBe(false);
    expect(evs).toContainEqual(expect.objectContaining({ kind: 'herd_dissolved', id: h.id, cause: 'size', organisms: members }));
    for (const m of members) expect(s.entities[m].parent).toBe(-1);
  });
});

describe('loose cells', () => {
  it('the free parameter sets how many loose cells float around', () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42, free: 40 });
    expect(s.entities.filter((e) => e.tier === 0 && e.parent < 0).length).toBe(40);
  });
});

describe('starting counts', () => {
  it('herds and lone set how many hazes and lone membranes the world starts with', () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42, herds: 3, lone: 4 });
    expect(s.entities.filter((e) => e.tier === 2).length).toBe(3);
    expect(s.entities.filter((e) => e.tier === 1 && e.parent < 0).length).toBe(4);
  });
});

describe('same-colour attraction', () => {
  it('sameAttract=false removes attraction between same-type cells and nothing else', () => {
    const on = createWorld({ hier: true, eps: 0.05, seed: 42 });
    const off = createWorld({ hier: true, eps: 0.05, seed: 42, sameAttract: false });
    on.laws.K0.forEach((row, i) =>
      row.forEach((v, j) => expect(off.laws.K0[i][j]).toBe(i === j ? Math.min(0, v) : v)),
    );
    expect(on.laws.K0.some((row, i) => row[i] > 0)).toBe(true); // seed 42 has some, so the test has teeth
    expect(off.entities.length).toBe(on.entities.length);
  });
});

describe('PAIR_RULES', () => {
  /** run with PAIR_RULES temporarily changed, always restored */
  const withRules = <T>(change: () => void, run: () => T): T => {
    const saved = JSON.parse(JSON.stringify(PAIR_RULES));
    try {
      change();
      return run();
    } finally {
      Object.assign(PAIR_RULES, saved);
    }
  };

  it('fixes exactly the law entries it names; the rest stay seed-drawn; laws=0 still zeroes all', () => {
    const base = createWorld({ hier: true, eps: 0.05, seed: 42 });
    withRules(
      () => {
        PAIR_RULES.laws[0][0][1] = 0.8;
        PAIR_RULES.laws[0][1][0] = -0.3;
      },
      () => {
        const s = createWorld({ hier: true, eps: 0.05, seed: 42 });
        s.laws.K0.forEach((row, i) =>
          row.forEach((v, j) => expect(v).toBe(i === 0 && j === 1 ? 0.8 : i === 1 && j === 0 ? -0.3 : base.laws.K0[i][j])),
        );
        expect(s.laws.K1).toEqual(base.laws.K1);
        expect(hashWorld(s)).toBe(hashWorld(base)); // same generated world
        const none = createWorld({ hier: true, eps: 0.05, seed: 42, laws: false });
        expect(none.laws.K0.flat().every((v) => v === 0)).toBe(true);
      },
    );
  });

  /** distance after 1 s between two free cells of types ta, tb placed 20 apart (flat world: laws are all zero) */
  const gapAfter = (ta: number, tb: number, similar: boolean) => {
    const s = dynWorld({ similar: similar ? lvl(0) : OFF }, { hier: false, seed: 3 });
    const a = s.entities.find((e) => e.alive && e.type === ta)!;
    const b = s.entities.find((e) => e.alive && e.type === tb && e !== a)!;
    const [x, y] = emptySpot(s);
    place(s, a.id, x, y);
    place(s, b.id, x + 20, y);
    ticks(s, 30);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  it('similarTypes: only the listed types take part in similarity', () => {
    withRules(
      () => (PAIR_RULES.similarTypes[0] = [0, 2]),
      () => {
        expect(gapAfter(1, 1, true)).toBe(gapAfter(1, 1, false)); // violet unlisted: no pull
        expect(gapAfter(0, 0, true)).toBeLessThan(gapAfter(0, 0, false)); // mint listed: pulled together
        expect(gapAfter(0, 2, true)).toBeGreaterThan(gapAfter(0, 2, false)); // mint and amber listed: pushed apart
      },
    );
  });

  it('similarRepel=false keeps like-attracts-like but drops unlike repulsion', () => {
    withRules(
      () => (PAIR_RULES.similarRepel[0] = false),
      () => {
        expect(gapAfter(0, 2, true)).toBe(gapAfter(0, 2, false));
        expect(gapAfter(0, 0, true)).toBeLessThan(gapAfter(0, 0, false));
      },
    );
  });
});

describe('generalisation tasks (spawn into an empty world)', () => {
  const empty = (hier = true) => createWorld({ hier, eps: 0.05, seed: 42, herds: 0, lone: 0, free: 0, dyn: { lock: true, catalysis: true, similar: OFF } });

  it('the task world is empty but has the same laws and recipes as the exploration world', () => {
    const e = empty();
    const full = createWorld({ hier: true, eps: 0.05, seed: 42, dyn: { lock: true, catalysis: true, similar: OFF } });
    expect(e.entities).toHaveLength(0);
    expect(e.laws).toEqual(full.laws);
    expect(e.grammar).toEqual(full.grammar);
  });

  it('spawn drops a cell, or a composite already made of its recipe-0 parts', () => {
    const s = empty();
    applyAction(s, { kind: 'spawn', tier: 0, type: 1, x: 500, y: 500 });
    applyAction(s, { kind: 'spawn', tier: 1, type: 3, x: 900, y: 500 });
    applyAction(s, { kind: 'spawn', tier: 2, type: 0, x: 1400, y: 800 });
    const tops = s.entities.filter((e) => e.alive && e.parent < 0);
    expect(tops.map((e) => [e.tier, e.type])).toEqual([[0, 1], [1, 3], [2, 0]]);
    const org = tops[1];
    expect(org.children.map((c) => s.entities[c].type)).toEqual(s.grammar.species[3][0]);
    const herd = tops[2];
    expect(herd.children.map((c) => s.entities[c].type)).toEqual(s.grammar.herds[0][0]);
    // nonsense is ignored
    const n = s.entities.length;
    applyAction(s, { kind: 'spawn', tier: 0, type: 9, x: 1, y: 1 });
    expect(s.entities.length).toBe(n);
  });

  it('in the flat condition only cells can be dropped in', () => {
    const s = empty(false);
    applyAction(s, { kind: 'spawn', tier: 1, type: 0, x: 500, y: 500 });
    applyAction(s, { kind: 'spawn', tier: 0, type: 0, x: 500, y: 500 });
    expect(s.entities.map((e) => e.tier)).toEqual([0]);
  });

  it('a task session with spawns replays exactly', () => {
    const session = testSession('?seed=42&herds=0&lone=0&free=0');
    session.act({ kind: 'spawn', tier: 0, type: 1, x: 1200, y: 800 });
    for (let t = 0; t < 20; t++) session.tick();
    session.act({ kind: 'spawn', tier: 0, type: 3, x: 1210, y: 800 });
    session.act({ kind: 'spawn', tier: 1, type: 0, x: 1300, y: 800 });
    for (let t = 0; t < 200; t++) session.tick();
    session.end();
    const res = replay(JSON.parse(JSON.stringify(session.toJSON())));
    expect(res.mismatches).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('task success = the target mechanism at the target scale', () =>
    withSettings(
      () => {
        DYNAMICS.lockChance = ALWAYS;
        DYNAMICS.catChance = ALWAYS;
      },
      () => {
        const s = empty();
        applyAction(s, { kind: 'spawn', tier: 0, type: PURPLE, x: 1200, y: 800 });
        applyAction(s, { kind: 'spawn', tier: 0, type: GREEN, x: 1211, y: 800 });
        const evs = ticks(s, REVEAL + 2);
        expect(evs.some((e) => isTaskSuccess('lock', e))).toBe(true);
        expect(evs.some((e) => isTaskSuccess('catalysis', e))).toBe(false);

        // organisms that bind are lock at the wrong scale: logged, but not a lock-task success
        const t = empty();
        applyAction(t, { kind: 'spawn', tier: 1, type: PURPLE, x: 1200, y: 800 });
        applyAction(t, { kind: 'spawn', tier: 1, type: GREEN, x: 1262, y: 800 });
        const tevs = ticks(t, REVEAL + 2);
        expect(tevs.some((e) => e.kind === 'encounter' && e.rule === 'lock' && e.ok)).toBe(true);
        expect(tevs.some((e) => isTaskSuccess('lock', e))).toBe(false);

        const c = empty();
        applyAction(c, { kind: 'spawn', tier: 1, type: LIGHT_BLUE, x: 1200, y: 800 });
        applyAction(c, { kind: 'spawn', tier: 1, type: RED, x: 1262, y: 800 });
        expect(ticks(c, REVEAL + 2).some((e) => isTaskSuccess('catalysis', e))).toBe(true);
      },
    ));
});
