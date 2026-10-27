import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simConfigOf } from '../src/config';
import { replay } from '../src/replay';
import { hashWorld } from '../src/sim/hash';
import { DYNAMICS, type Dynamics, P, type SimEvent, type WorldState, applyAction, band, canCombine, canJoin, combineKind, createWorld, findCombineGroup, findJoinTarget, memberTargets, naturalRadius, ringUnits, step } from '../src/sim/world';
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
  it.each(['?seed=42', '?seed=42&move=0', '?seed=42&laws=0', '?seed=5&hier=0', '?seed=9&eps=0.3&size=irrelevant', '?seed=42&lock=all&catalysis=all&similar=all', '?seed=42&lock=0&catalysis=0', '?seed=5&hier=0&lock=0&catalysis=0&similar=0'])(
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
    expect(h.entities.filter((e) => e.tier === 0 && e.parent < 0).length).toBe(120);
    expect(h.entities.filter((e) => e.tier === 0 && e.parent >= 0).length).toBeLessThanOrEqual(185);
    expect(f.entities.every((e) => e.tier === 0 && e.parent < 0)).toBe(true);
    expect(h.entities.filter((e) => e.tier === 2).length).toBe(5);
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
  for (let y = 150; y < 1500; y += 25) {
    for (let x = 150; x < 2300; x += 25) {
      if (s.entities.every((e) => !e.alive || Math.hypot(e.x - x, e.y - y) > clear)) return [x, y];
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

describe('lock & key (cells only)', () => {
  const pairUp = (s: WorldState, typeB: number) => {
    const a = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 0 && e.bond < 0)!;
    const b = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === typeB && e.bond < 0 && e !== a)!;
    const [x, y] = emptySpot(s);
    place(s, a.id, x, y);
    place(s, b.id, x + 10, y);
    ticks(s, 1);
    return [a, b] as const;
  };
  /** bonds are only ever between two free cells or two cells of the same organism */
  const bondsValid = (s: WorldState) =>
    s.entities.every((e) => {
      if (!e.alive || e.bond < 0) return true;
      const b = s.entities[e.bond];
      return e.tier === 0 && b.alive && b.bond === e.id && e.parent === b.parent;
    });

  it('free mint and violet cells in contact bind, drag as one, and Shift-drag separates them', () => {
    const s = dynWorld({ lock: true });
    const [a, b] = pairUp(s, 1);
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
  });

  it('only mint + violet bind, and only with lock on', () => {
    const amber = dynWorld({ lock: true });
    const [a1] = pairUp(amber, 2);
    ticks(amber, 30);
    expect(a1.bond).toBe(-1);
    const off = dynWorld({});
    pairUp(off, 1);
    ticks(off, 30);
    expect(off.entities.every((e) => e.bond === -1)).toBe(true);
  });

  it('organisms never bond: lock & key is a cell-level mechanism', () => {
    const s = dynWorld({ lock: true }, { move: false });
    const [o1, o2] = s.entities.filter((e) => e.alive && e.tier === 1 && e.parent < 0);
    o1.type = 0;
    o2.type = 1;
    const [x, y] = emptySpot(s, 200);
    place(s, o1.id, x, y);
    place(s, o2.id, x + naturalRadius(s, o1) + naturalRadius(s, o2) + 2, y);
    ticks(s, 30);
    expect(o1.bond).toBe(-1);
    expect(o2.bond).toBe(-1);
  });

  it('organisms start with their mint and violet cells paired up, touching, and stay so', () => {
    const s = dynWorld({ lock: true });
    let pairs = 0;
    for (const o of s.entities.filter((e) => e.tier === 1)) {
      const kids = o.children.map((c) => s.entities[c]);
      const expected = Math.min(kids.filter((c) => c.type === 0).length, kids.filter((c) => c.type === 1).length);
      const bound = kids.filter((c) => c.bond >= 0 && s.entities[c.bond].parent === o.id).length / 2;
      expect(bound).toBe(expected);
      pairs += bound;
    }
    expect(pairs).toBeGreaterThan(0);
    const touching = () =>
      s.entities.filter((e) => e.alive && e.tier === 0 && e.parent >= 0 && e.bond > e.id).map((e) => Math.hypot(e.x - s.entities[e.bond].x, e.y - s.entities[e.bond].y));
    expect(Math.max(...touching())).toBeLessThan(2 * P.cellR + 1);
    ticks(s, 300);
    expect(Math.max(...touching())).toBeLessThan(2 * P.cellR + 3);
    expect(bondsValid(s)).toBe(true);
  });

  it('a bound pair stays attached when combined into a new organism, and is never split by combining', () => {
    const s = dynWorld({ lock: true }, { move: false });
    const [a, b] = pairUp(s, 1);
    const c = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 2 && e.bond < 0)!;
    place(s, c.id, b.x + 10, b.y);
    expect(canCombine(s, [a.id, c.id])).toBe(false); // would split the pair
    const group = findCombineGroup(s, a.id);
    expect(group.slice().sort()).toEqual([a.id, b.id, c.id].sort());
    applyAction(s, { kind: 'combine', ids: group });
    expect(a.parent).toBeGreaterThanOrEqual(0);
    expect(new Set([a.parent, b.parent, c.parent]).size).toBe(1);
    expect(a.bond).toBe(b.id);
  });

  it('a bound pair joins an organism together and stays attached; an unpaired mint inside pairs with a violet that joins', () => {
    const s = dynWorld({ lock: true }, { move: false });
    const [a, b] = pairUp(s, 1);
    const o = s.entities.find((e) => e.alive && e.tier === 1 && e.parent < 0 && canJoin(s, a.id, e.id))!;
    applyAction(s, { kind: 'join', id: a.id, parent: o.id });
    expect(a.parent).toBe(o.id);
    expect(b.parent).toBe(o.id);
    expect(a.bond).toBe(b.id);

    const t = dynWorld({ lock: true }, { move: false });
    const mint = t.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 0 && e.bond < 0)!;
    const amber = t.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 2)!;
    applyAction(t, { kind: 'combine', ids: [mint.id, amber.id] });
    const org = t.entities[mint.parent];
    expect(mint.bond).toBe(-1);
    const violet = t.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 1 && e.bond < 0 && canJoin(t, e.id, org.id))!;
    applyAction(t, { kind: 'join', id: violet.id, parent: org.id });
    expect(mint.bond).toBe(violet.id);
  });

  it('Shift-drag on a member takes its partner along, still attached', () => {
    const s = dynWorld({ lock: true });
    const a = s.entities.find((e) => e.alive && e.tier === 0 && e.parent >= 0 && e.bond >= 0)!;
    const b = s.entities[a.bond];
    applyAction(s, { kind: 'detach', id: a.id });
    expect(a.parent).toBe(-1);
    expect(b.parent).toBe(-1);
    expect(a.bond).toBe(b.id);
    expect(bondsValid(s)).toBe(true);
  });

  it('bonds never cross organisms or tie a free cell to a member (2 min of a busy world)', () => {
    const s = dynWorld({ lock: true });
    for (let i = 0; i < 30 * 120; i++) {
      step(s, []);
      if (i % 300 === 0) expect(bondsValid(s)).toBe(true);
    }
    expect(bondsValid(s)).toBe(true);
  });

  it('a bound pair mildly pushes other cells away, so pairs do not clump', () => {
    const s = dynWorld({ lock: true }, { move: false });
    const [a, b] = pairUp(s, 1);
    const c = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 2)!;
    place(s, c.id, a.x, a.y + 13);
    ticks(s, 60);
    const gap = Math.min(Math.hypot(c.x - a.x, c.y - a.y), Math.hypot(c.x - b.x, c.y - b.y));
    expect(gap).toBeGreaterThan(20);
    // without lock & key, nothing pushes it beyond contact
    const t = dynWorld({}, { move: false });
    const [ta] = pairUp(t, 1);
    const tc = t.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 2)!;
    place(t, tc.id, ta.x, ta.y + 13);
    ticks(t, 60);
    expect(Math.hypot(tc.x - ta.x, tc.y - ta.y)).toBeLessThan(15);
  });
});

describe('catalysis (organisms only)', () => {
  /** two free organisms set to catalyst (sky-blue, 0) and target (rose, 1), placed just touching */
  const meet = (s: WorldState) => {
    const [cat, target] = s.entities.filter((e) => e.alive && e.tier === 1 && e.parent < 0);
    cat.type = 0;
    target.type = 1;
    const [x, y] = emptySpot(s, 250);
    place(s, target.id, x, y);
    place(s, cat.id, x + naturalRadius(s, target) + naturalRadius(s, cat) + 4, y);
    return [cat, target] as const;
  };

  it('a rose organism spins fast while a sky-blue one touches it, keeps spinning for a while after, then stops', () => {
    const s = dynWorld({ catalysis: true }, { move: false });
    const [cat, target] = meet(s);
    const a0 = target.angle;
    ticks(s, 30);
    expect(target.spin).toBeCloseTo(DYNAMICS.catSpin, 6);
    expect(target.angle - a0).toBeGreaterThan(3.5); // ~4.2 rad in 1 s
    expect(cat.spin).toBe(0); // one-way
    place(s, cat.id, cat.x + 400, cat.y);
    ticks(s, 15);
    expect(target.spin).toBeGreaterThan(1);
    expect(target.spin).toBeLessThan(DYNAMICS.catSpin);
    ticks(s, 90);
    expect(target.spin).toBe(0);
  });

  it('nothing spins with catalysis off, and cells never catalyse', () => {
    const off = dynWorld({}, { move: false });
    const [, target] = meet(off);
    ticks(off, 30);
    expect(target.spin).toBe(0);

    const s = dynWorld({ catalysis: true }, { move: false });
    const mint = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 0)!;
    const violet = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 1)!;
    const [x, y] = emptySpot(s);
    place(s, violet.id, x, y);
    place(s, mint.id, x + 11, y);
    const a0 = violet.angle;
    ticks(s, 30);
    expect(violet.angle).toBe(a0);
    expect(violet.spin).toBe(0);
  });

  it('in a herd, a catalyst and its target sit together and the target keeps spinning', () => {
    const s = dynWorld({ catalysis: true });
    const herd = s.entities.find((h) => h.tier === 2 && h.children.some((c) => s.entities[c].type === 0) && h.children.some((c) => s.entities[c].type === 1))!;
    expect(herd).toBeDefined();
    const pair = ringUnits(s, herd).find((u) => u.length === 2)!;
    const [c, t] = pair.map((id) => s.entities[id]);
    expect([c.type, t.type]).toEqual([0, 1]);
    ticks(s, 90);
    expect(Math.hypot(c.x - t.x, c.y - t.y) - naturalRadius(s, c) - naturalRadius(s, t)).toBeLessThan(DYNAMICS.catMargin);
    expect(t.spin).toBeCloseTo(DYNAMICS.catSpin, 6);
    // members in different places on the ring are kept well apart (no clumping)
    const units = ringUnits(s, herd);
    for (let i = 0; i < units.length; i++)
      for (let j = i + 1; j < units.length; j++)
        for (const p of units[i])
          for (const q of units[j]) {
            const A = s.entities[p];
            const B = s.entities[q];
            expect(Math.hypot(A.x - B.x, A.y - B.y) - naturalRadius(s, A) - naturalRadius(s, B)).toBeGreaterThan(DYNAMICS.catMargin);
          }
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
    const cells = s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0).slice(0, 3);
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
