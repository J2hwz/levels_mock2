import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simConfigOf } from '../src/config';
import { replay } from '../src/replay';
import { hashWorld } from '../src/sim/hash';
import { type Dynamics, type SimEvent, type WorldState, applyAction, band, canCombine, canJoin, combineKind, createWorld, slotPos, step } from '../src/sim/world';
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
  it.each(['?seed=42', '?seed=42&move=0', '?seed=42&laws=0', '?seed=5&hier=0', '?seed=9&eps=0.3&size=irrelevant', '?seed=42&lock=all&catalysis=all&similar=all', '?seed=5&hier=0&lock=0&catalysis=0&similar=0'])(
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
    for (const a of fs) for (const b of fs) if (canCombine(s, a.id, b.id)) return [a, b] as const;
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
    expect(canCombine(s, a.id, a.id)).toBe(false);
    expect(canCombine(s, a.id, member.id)).toBe(false);
    expect(canCombine(s, a.id, lone.id)).toBe(false);
    expect(canCombine(s, herds[0].id, herds[1].id)).toBe(false);
    // a type no species uses
    s.grammar.species = s.grammar.species.map((rs) => rs.map((rc) => rc.filter((t) => t !== b.type)));
    expect(canCombine(s, a.id, b.id)).toBe(false);
    const t = world();
    applyAction(t, { kind: 'isolate', id: a.id });
    expect(canCombine(t, a.id, b.id)).toBe(false);
    const f = world(false);
    expect(canCombine(f, f.entities[0].id, f.entities[1].id)).toBe(false);
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
    for (const a of free) for (const b of free) if (!pair && canCombine(s, a.id, b.id)) pair = [a.id, b.id];
    run(s, 90, [{ kind: 'combine', ids: pair! }]);
    const o = s.entities[s.entities[pair![0]].parent];
    o.children.forEach((c, k) => {
      const [tx, ty] = slotPos(o, k, o.children.length);
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
    dyn: { lock: OFF, catalysis: OFF, similar: OFF, ...dyn },
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
const freeOfType = (s: WorldState, tier: number, type: number, k = 0) =>
  s.entities.filter((e) => e.alive && e.tier === tier && e.parent < 0 && e.type === type)[k];
const ticks = (s: WorldState, n: number, evs: SimEvent[] = []) => {
  for (let i = 0; i < n; i++) evs.push(...step(s, []));
  return evs;
};

describe('lock & key', () => {
  const pairUp = (s: WorldState, typeB: number) => {
    const a = freeOfType(s, 0, 0);
    const b = freeOfType(s, 0, typeB);
    const [x, y] = emptySpot(s);
    place(s, a.id, x, y);
    place(s, b.id, x + 10, y);
    ticks(s, 1);
    return [a, b] as const;
  };

  it('a mint and a violet cell in contact bind, drag as one, and Shift-drag (detach) separates them', () => {
    const s = dynWorld({ lock: lvl(0) });
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

  it('only lock pairs bind, and only where lock is switched on', () => {
    const amber = dynWorld({ lock: lvl(0) });
    const [a1] = pairUp(amber, 2);
    ticks(amber, 30);
    expect(a1.bond).toBe(-1);
    const off = dynWorld({});
    pairUp(off, 1);
    ticks(off, 30);
    expect(off.entities.every((e) => e.bond === -1)).toBe(true);
  });

  it('a lock pair binds instead of combining; combining one half with something else breaks the bond', () => {
    const s = dynWorld({ lock: lvl(0) }, { move: false });
    const [a, b] = pairUp(s, 1);
    expect(a.bond).toBe(b.id);
    expect(canCombine(s, a.id, b.id)).toBe(false);
    const other = s.entities.find((e) => e.alive && e.tier === 0 && e.parent < 0 && e !== a && e !== b && canCombine(s, e.id, a.id))!;
    applyAction(s, { kind: 'combine', ids: [other.id, a.id] });
    expect(a.parent).toBeGreaterThanOrEqual(0);
    expect(a.bond).toBe(-1);
    expect(b.bond).toBe(-1);
  });
});

describe('catalysis', () => {
  const spinOf = (dyn: Partial<Dynamics>, tier: number, catalyst: number) => {
    const s = dynWorld(dyn, { move: false });
    const free = s.entities.filter((e) => e.alive && e.tier === tier && e.parent < 0);
    const [target, cat] = tier === 0 ? [freeOfType(s, 0, 1), freeOfType(s, 0, catalyst)] : [free[0], free[1]];
    if (tier > 0) {
      target.type = 1;
      cat.type = catalyst;
    }
    const [x, y] = emptySpot(s, tier === 0 ? 120 : 200);
    place(s, target.id, x, y);
    place(s, cat.id, x + (tier === 0 ? 12 : 60), y);
    const before = target.angle;
    ticks(s, 60);
    return target.angle - before;
  };

  it('a violet cell turns only while a mint cell touches it', () => {
    expect(spinOf({ catalysis: lvl(0) }, 0, 0)).toBeCloseTo(1.5 * 2, 1);
    expect(spinOf({ catalysis: lvl(0) }, 0, 2)).toBe(0); // amber is not its catalyst
    expect(spinOf({}, 0, 0)).toBe(0); // catalysis off
  });

  it('works at the organism level too', () => {
    expect(spinOf({ catalysis: lvl(1) }, 1, 0)).toBeGreaterThan(2);
    expect(spinOf({ catalysis: lvl(0) }, 1, 0)).toBe(0);
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
    for (const a of free) for (const b of free) if (canCombine(s, a.id, b.id)) {
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
