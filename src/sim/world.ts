// Pure, deterministic simulation of the alien-biology sandbox.
// MUST NOT import Pixi, jsPsych, or touch the DOM. All randomness via ./rng.

import { dcos, dhypot, dsin } from './dmath';
import { type RngState, gauss, makeRng, rand, randInt, randRange } from './rng';

// ---------------------------------------------------------------- types

export type Tier = 0 | 1 | 2;

export interface SimConfig {
  hier: boolean;
  eps: number;
  seed: number;
}

/** One struct for every tier keeps hashing/serialisation trivial. Unused fields stay 0. */
export interface Entity {
  id: number;
  tier: Tier;
  /** cell type (T0), species (T1) or herd kind (T2) */
  type: number;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** composites: slot-ring orientation and heading */
  angle: number;
  /** -1 = belongs to nothing */
  parent: number;
  children: number[];
  /** T0: crowding by cells of other organisms (smoothed) */
  stress: number;
  /** T0: noisy read of own organism's hormone. T1: noisy read of own herd's density. */
  signal: number;
  /** T1: mean stress of its cells (smoothed) */
  hormone: number;
  /** T1: 0..1 */
  health: number;
  /** T2: packing of its organisms (1 = nominal) */
  density: number;
  /** T1/T2: which recipe realises this species / herd kind */
  realisation: number;
}

export interface Grammar {
  /** species[s][r] = multiset (sorted) of cell types */
  species: number[][][];
  /** herds[k][r] = multiset (sorted) of species */
  herds: number[][][];
}

export interface Laws {
  /** per-tier same-tier interaction matrices ("laws of the tier") */
  K0: number[][];
  K1: number[][];
  K2: number[][];
  /** flat condition: one uniform matrix for all cells */
  Kflat: number[][];
  cruise1: number[];
  cruise2: number[];
  spin1: number[];
  spin2: number[];
}

/** Flat condition only: health attached to fixed regions of the world. */
export interface Region {
  x: number;
  y: number;
  r: number;
  stress: number;
  health: number;
}

export interface WorldState {
  config: SimConfig;
  tick: number;
  rng: RngState;
  nextId: number;
  /** index === id; dead entities stay in place with alive=false */
  entities: Entity[];
  grammar: Grammar;
  laws: Laws;
  regions: Region[];
  /** id of isolated entity, or -1 */
  isolated: number;
  drag: { id: number; x: number; y: number } | null;
}

export type Action =
  | { kind: 'select'; id: number | null }
  | { kind: 'dragStart'; id: number; x: number; y: number }
  | { kind: 'dragMove'; id: number; x: number; y: number }
  | { kind: 'dragEnd'; id: number }
  | { kind: 'detach'; id: number }
  | { kind: 'join'; id: number; parent: number }
  | { kind: 'isolate'; id: number | null }
  | { kind: 'speed'; speed: number }
  | { kind: 'swap'; id: number };

export type SimEvent =
  | { kind: 'organism_death'; id: number; cause: 'health' | 'empty'; cells: number[] }
  | { kind: 'herd_dissolved'; id: number }
  | { kind: 'region_depleted'; index: number }
  | { kind: 'swapped'; id: number; realisation: number; removed: number[]; added: number[] };

// ---------------------------------------------------------------- parameters

export const P = {
  dt: 1 / 30,
  ticksPerSecond: 30,
  worldW: 2400,
  worldH: 1600,
  cellR: 5,
  damping: 0.9,
  maxSpeed: 400,
  nCellTypes: 3,
  nSpecies: 3,
  nHerdKinds: 2,
  orgSize: [4, 7] as const,
  herdSize: [3, 6] as const,
  nHerds: 5,
  nLoneOrganisms: 6,
  targetCells: 175,
  maxCells: 200,
  minFreeCells: 15,
  maxFreeCells: 70,
  // same-tier interactions: [T0, T1, T2]
  rmin: [11, 58, 220],
  rmax: [45, 220, 800],
  repel: [600, 400, 300],
  gain: [150, 60, 70],
  // springs member -> parent slot, indexed by parent tier
  springK: [0, 70, 10],
  springC: [0, 4, 2],
  // downward causation
  stressR: 20,
  stressRate: 0.15,
  hormoneRate: 0.1,
  hormoneNoise: 0.08,
  hormoneThr: 0.25,
  jitter: 220,
  stressRepelR: 24,
  stressRepel: 260,
  densityRate: 0.1,
  densityNoise: 0.08,
  densityGain: 80,
  // light goal
  healthDecay: 0.15,
  healthRecover: 0.03,
  // misc
  freeNoise: 30,
  flatNoise: 60,
  // flat: uniform matrix value. Any attraction > 0 makes clumps that persist; 0 keeps groupings transient.
  flatUniform: 0,
  wallK: 20,
  joinMargin: 25,
  nRegions: 6,
  regionR: 230,
  regionCrowdThr: 1.5,
};

// ---------------------------------------------------------------- geometry helpers

export function ringRadius(tier: Tier, n: number): number {
  if (tier === 1) return 6 + 2.4 * n;
  if (tier === 2) return 34 + 13 * n;
  return 0;
}

/** Physical ("proxy") radius of an entity in world units. */
export function naturalRadius(s: WorldState, e: Entity): number {
  if (e.tier === 0) return P.cellR;
  if (e.tier === 1) return ringRadius(1, e.children.length) + P.cellR + 4;
  let maxChild = 0;
  for (const c of e.children) maxChild = Math.max(maxChild, naturalRadius(s, s.entities[c]));
  return ringRadius(2, e.children.length) + maxChild + 8;
}

export function slotPos(parent: Entity, k: number, n: number): [number, number] {
  const R = ringRadius(parent.tier, n);
  const a = parent.angle + (2 * Math.PI * k) / n;
  return [parent.x + R * dcos(a), parent.y + R * dsin(a)];
}

export function descendants(s: WorldState, id: number, out: number[] = []): number[] {
  for (const c of s.entities[id].children) {
    out.push(c);
    descendants(s, c, out);
  }
  return out;
}

export function ancestors(s: WorldState, id: number): number[] {
  const out: number[] = [];
  let p = s.entities[id].parent;
  while (p >= 0) {
    out.push(p);
    p = s.entities[p].parent;
  }
  return out;
}

export function aliveEntities(s: WorldState): Entity[] {
  return s.entities.filter((e) => e.alive);
}

// ---------------------------------------------------------------- grammar & generation

function recipe(r: RngState, n: number, dominant: number, kinds: number): number[] {
  const out: number[] = [];
  const nDom = Math.ceil(n * 0.6);
  for (let i = 0; i < nDom; i++) out.push(dominant);
  for (let i = nDom; i < n; i++) out.push(randInt(r, 0, kinds - 1));
  return out.sort((a, b) => a - b);
}

function makeGrammar(r: RngState): Grammar {
  const species: number[][][] = [];
  for (let s = 0; s < P.nSpecies; s++) {
    const r0 = recipe(r, randInt(r, P.orgSize[0], P.orgSize[1]), s, P.nCellTypes);
    // second realisation: different dominant cell type, so it looks different but behaves the same
    const r1 = recipe(r, randInt(r, P.orgSize[0], P.orgSize[1]), (s + 1) % P.nCellTypes, P.nCellTypes);
    species.push([r0, r1]);
  }
  const herds: number[][][] = [];
  for (let k = 0; k < P.nHerdKinds; k++) {
    // the generated realisation is capped one below max so 5 herds stay within the cell budget
    const r0 = recipe(r, randInt(r, P.herdSize[0], P.herdSize[1] - 1), k, P.nSpecies);
    const r1 = recipe(r, randInt(r, P.herdSize[0] + 1, P.herdSize[1]), (k + 2) % P.nSpecies, P.nSpecies);
    herds.push([r0, r1]);
  }
  return { species, herds };
}

function matrix(r: RngState, n: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) row.push(Math.round(randRange(r, -1, 1) * 100) / 100);
    m.push(row);
  }
  return m;
}

function makeLaws(r: RngState): Laws {
  const sign = () => (rand(r) < 0.5 ? -1 : 1);
  const K0 = matrix(r, P.nCellTypes);
  const K1 = matrix(r, P.nSpecies);
  const K2 = matrix(r, P.nHerdKinds);
  const Kflat = K0.map((row) => row.map(() => P.flatUniform));
  return {
    K0,
    K1,
    K2,
    Kflat,
    cruise1: Array.from({ length: P.nSpecies }, () => randRange(r, 40, 80)),
    cruise2: Array.from({ length: P.nHerdKinds }, () => randRange(r, 40, 70)),
    spin1: Array.from({ length: P.nSpecies }, () => sign() * randRange(r, 0.1, 0.4)),
    spin2: Array.from({ length: P.nHerdKinds }, () => sign() * randRange(r, 0.04, 0.12)),
  };
}

function newEntity(s: WorldState, tier: Tier, type: number, x: number, y: number): Entity {
  const e: Entity = {
    id: s.nextId++,
    tier,
    type,
    alive: true,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    parent: -1,
    children: [],
    stress: 0,
    signal: 0,
    hormone: 0,
    health: tier === 1 ? 1 : 0,
    density: tier === 2 ? 1 : 0,
    realisation: 0,
  };
  s.entities.push(e);
  return e;
}

function adopt(parent: Entity, child: Entity): void {
  child.parent = parent.id;
  parent.children.push(child.id);
}

function buildOrganism(s: WorldState, species: number, realisation: number, x: number, y: number, angle: number): Entity {
  const o = newEntity(s, 1, species, x, y);
  o.angle = angle;
  o.realisation = realisation;
  const cells = s.grammar.species[species][realisation];
  cells.forEach((t, k) => {
    const [cx, cy] = slotPos(o, k, cells.length);
    adopt(o, newEntity(s, 0, t, cx, cy));
  });
  return o;
}

function buildHerd(s: WorldState, kind: number, realisation: number, x: number, y: number, angle: number): Entity {
  const h = newEntity(s, 2, kind, x, y);
  h.angle = angle;
  h.realisation = realisation;
  const members = s.grammar.herds[kind][realisation];
  members.forEach((sp, k) => {
    const [ox, oy] = slotPos(h, k, members.length);
    adopt(h, buildOrganism(s, sp, 0, ox, oy, rand(s.rng) * Math.PI * 2));
  });
  return h;
}

function emptyState(config: SimConfig, rng: RngState, grammar: Grammar, laws: Laws): WorldState {
  return { config, tick: 0, rng, nextId: 0, entities: [], grammar, laws, regions: [], isolated: -1, drag: null };
}

function placeAwayFrom(r: RngState, pts: [number, number][], minD: number, margin: number): [number, number] {
  let best: [number, number] = [P.worldW / 2, P.worldH / 2];
  let bestD = -1;
  for (let tries = 0; tries < 60; tries++) {
    const x = randRange(r, margin, P.worldW - margin);
    const y = randRange(r, margin, P.worldH - margin);
    let d = Infinity;
    for (const [px, py] of pts) d = Math.min(d, dhypot(px - x, py - y));
    if (d >= minD) return [x, y];
    if (d > bestD) {
      bestD = d;
      best = [x, y];
    }
  }
  return best;
}

export function createWorld(config: SimConfig): WorldState {
  const rng = makeRng(config.seed);
  const grammar = makeGrammar(rng);
  const laws = makeLaws(rng);
  const s = emptyState(config, rng, grammar, laws);

  // Always generate the hierarchical world first, so the flat condition gets the same cells.
  const herdPts: [number, number][] = [];
  for (let h = 0; h < P.nHerds; h++) {
    const [x, y] = placeAwayFrom(rng, herdPts, 480, 260);
    herdPts.push([x, y]);
    const kind = h < 4 ? h % 2 : randInt(rng, 0, P.nHerdKinds - 1);
    buildHerd(s, kind, 0, x, y, rand(rng) * Math.PI * 2);
  }
  const lonePts = herdPts.slice();
  const countCells = () => s.entities.filter((e) => e.tier === 0).length;
  for (let i = 0; i < P.nLoneOrganisms; i++) {
    const [x, y] = placeAwayFrom(rng, lonePts, 240, 80);
    lonePts.push([x, y]);
    const sp = randInt(rng, 0, P.nSpecies - 1);
    if (countCells() + s.grammar.species[sp][0].length > P.maxCells - P.minFreeCells) continue;
    buildOrganism(s, sp, 0, x, y, rand(rng) * Math.PI * 2);
  }
  const nFree = Math.max(P.minFreeCells, Math.min(P.maxFreeCells, P.targetCells - countCells()));
  for (let i = 0; i < nFree; i++) {
    newEntity(s, 0, randInt(rng, 0, P.nCellTypes - 1), randRange(rng, 40, P.worldW - 40), randRange(rng, 40, P.worldH - 40));
  }

  if (config.hier) return s;

  // Flat: same cells and types, scattered, no parents, plus fixed health regions.
  const flat = emptyState(config, rng, grammar, laws);
  for (const e of s.entities) {
    if (e.tier !== 0) continue;
    newEntity(flat, 0, e.type, randRange(rng, 40, P.worldW - 40), randRange(rng, 40, P.worldH - 40));
  }
  const cols = 3;
  for (let i = 0; i < P.nRegions; i++) {
    const cx = ((i % cols) + 0.5) * (P.worldW / cols);
    const cy = (Math.floor(i / cols) + 0.5) * (P.worldH / 2);
    flat.regions.push({ x: cx, y: cy, r: P.regionR, stress: 0, health: 1 });
  }
  return flat;
}

// ---------------------------------------------------------------- structural edits

function isActiveSet(s: WorldState): Uint8Array | null {
  if (s.isolated < 0) return null;
  const a = new Uint8Array(s.entities.length);
  a[s.isolated] = 1;
  for (const d of descendants(s, s.isolated)) a[d] = 1;
  return a;
}

function removeChild(parent: Entity, childId: number): void {
  const i = parent.children.indexOf(childId);
  if (i >= 0) parent.children.splice(i, 1);
}

function kill(s: WorldState, e: Entity): void {
  e.alive = false;
  e.children = [];
  if (s.isolated === e.id) s.isolated = -1;
  if (s.drag && s.drag.id === e.id) s.drag = null;
}

/** Remove entity from its parent; cascade dissolution of empty parents. */
function unparent(s: WorldState, e: Entity, events: SimEvent[]): void {
  if (e.parent < 0) return;
  const p = s.entities[e.parent];
  e.parent = -1;
  removeChild(p, e.id);
  if (p.children.length === 0) {
    if (p.tier === 1) {
      events.push({ kind: 'organism_death', id: p.id, cause: 'empty', cells: [] });
    } else {
      events.push({ kind: 'herd_dissolved', id: p.id });
    }
    unparent(s, p, events);
    kill(s, p);
  }
}

function dissolveOrganism(s: WorldState, o: Entity, events: SimEvent[]): void {
  const cells = o.children.slice();
  for (const c of cells) {
    const ce = s.entities[c];
    ce.parent = -1;
    ce.signal = 0;
    const dx = ce.x - o.x;
    const dy = ce.y - o.y;
    const d = dhypot(dx, dy) || 1;
    ce.vx += (dx / d) * 40;
    ce.vy += (dy / d) * 40;
  }
  o.children = [];
  events.push({ kind: 'organism_death', id: o.id, cause: 'health', cells });
  unparent(s, o, events);
  kill(s, o);
}

function translateTree(s: WorldState, id: number, dx: number, dy: number): void {
  const e = s.entities[id];
  e.x += dx;
  e.y += dy;
  for (const c of e.children) translateTree(s, c, dx, dy);
}

export function canJoin(s: WorldState, childId: number, parentId: number): boolean {
  if (!s.config.hier) return false;
  const c = s.entities[childId];
  const p = s.entities[parentId];
  if (!c || !p || !c.alive || !p.alive || c.parent >= 0 || p.tier !== c.tier + 1) return false;
  const max = p.tier === 1 ? P.orgSize[1] : P.herdSize[1];
  if (p.children.length >= max) return false;
  const recipes = p.tier === 1 ? s.grammar.species[p.type] : s.grammar.herds[p.type];
  return recipes.some((rc) => rc.includes(c.type));
}

/** Nearest compatible parent the entity was dropped onto, or -1. */
export function findJoinTarget(s: WorldState, id: number): number {
  const c = s.entities[id];
  if (!c || !c.alive || c.parent >= 0 || c.tier >= 2) return -1;
  let best = -1;
  let bestD = Infinity;
  for (const p of s.entities) {
    if (!p.alive || p.tier !== c.tier + 1 || !canJoin(s, id, p.id)) continue;
    const d = dhypot(p.x - c.x, p.y - c.y);
    if (d < naturalRadius(s, p) + P.joinMargin && d < bestD) {
      best = p.id;
      bestD = d;
    }
  }
  return best;
}

function swapRealisation(s: WorldState, e: Entity, events: SimEvent[]): void {
  if (!s.config.hier || e.tier === 0) return;
  const removed = descendants(s, e.id);
  for (const id of removed) kill(s, s.entities[id]);
  e.children = [];
  const recipes = e.tier === 1 ? s.grammar.species[e.type] : s.grammar.herds[e.type];
  e.realisation = (e.realisation + 1) % recipes.length;
  const rc = recipes[e.realisation];
  const first = s.nextId;
  rc.forEach((t, k) => {
    const [x, y] = slotPos(e, k, rc.length);
    const child = e.tier === 1 ? newEntity(s, 0, t, x, y) : buildOrganism(s, t, k % 2, x, y, rand(s.rng) * Math.PI * 2);
    adopt(e, child);
  });
  const added: number[] = [];
  for (let id = first; id < s.nextId; id++) added.push(id);
  events.push({ kind: 'swapped', id: e.id, realisation: e.realisation, removed, added });
}

function validId(s: WorldState, id: number | null | undefined): id is number {
  return typeof id === 'number' && id >= 0 && id < s.entities.length && s.entities[id].alive;
}

/** Apply one participant action immediately (at the current tick). */
export function applyAction(s: WorldState, a: Action): SimEvent[] {
  const events: SimEvent[] = [];
  switch (a.kind) {
    case 'dragStart': {
      if (!validId(s, a.id)) break;
      s.drag = { id: a.id, x: a.x, y: a.y };
      const e = s.entities[a.id];
      translateTree(s, a.id, a.x - e.x, a.y - e.y);
      e.vx = 0;
      e.vy = 0;
      break;
    }
    case 'dragMove': {
      if (!s.drag || s.drag.id !== a.id || !validId(s, a.id)) break;
      s.drag.x = a.x;
      s.drag.y = a.y;
      const e = s.entities[a.id];
      translateTree(s, a.id, a.x - e.x, a.y - e.y);
      break;
    }
    case 'dragEnd':
      if (s.drag && s.drag.id === a.id) s.drag = null;
      break;
    case 'detach':
      if (validId(s, a.id)) unparent(s, s.entities[a.id], events);
      break;
    case 'join':
      if (canJoin(s, a.id, a.parent)) {
        s.entities[a.id].parent = a.parent;
        s.entities[a.parent].children.push(a.id);
      }
      break;
    case 'isolate':
      s.isolated = validId(s, a.id) ? a.id : -1;
      break;
    case 'swap':
      if (validId(s, a.id)) swapRealisation(s, s.entities[a.id], events);
      break;
    case 'select':
    case 'speed':
      break; // UI-only; logged but no effect on the world
  }
  return events;
}

// ---------------------------------------------------------------- the step

/** Apply this tick's actions, then advance the world by one fixed tick. */
export function step(s: WorldState, actions: readonly Action[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (const a of actions) events.push(...applyAction(s, a));
  advance(s, events);
  return events;
}

function advance(s: WorldState, events: SimEvent[]): void {
  const { hier, eps } = s.config;
  const ents = s.entities;
  const n = ents.length;
  const active = isActiveSet(s);
  const on = (e: Entity) => e.alive && (active === null || active[e.id] === 1);
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const crowd = new Float64Array(n);

  const byTier: Entity[][] = [[], [], []];
  for (const e of ents) if (on(e)) byTier[e.tier].push(e);

  // 1. same-tier interactions (+ crowding for cells)
  for (let t = 0; t < 3; t++) {
    const list = byTier[t];
    const K = !hier ? s.laws.Kflat : t === 0 ? s.laws.K0 : t === 1 ? s.laws.K1 : s.laws.K2;
    const rmin = P.rmin[t];
    const rmax = P.rmax[t];
    const rmax2 = rmax * rmax;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rmax2) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const ux = dx / d;
        const uy = dy / d;
        let fa = 0; // + means a pulled toward b
        let fb = 0; // + means b pulled toward a
        if (d < rmin) {
          const rep = -P.repel[t] * (1 - d / rmin);
          fa += rep;
          fb += rep;
        } else {
          // siblings interact fully; non-siblings at the same tier leak through eps.
          // A free cell sits in no unit, so there is no boundary to leak across: it feels everything.
          const free = t === 0 && (a.parent < 0 || b.parent < 0);
          const w = !hier || free || a.parent === b.parent ? 1 : eps;
          const tri = 1 - Math.abs(2 * d - rmax - rmin) / (rmax - rmin);
          fa += P.gain[t] * K[a.type][b.type] * tri * w;
          fb += P.gain[t] * K[b.type][a.type] * tri * w;
        }
        if (t === 0) {
          if (d < P.stressR && (a.parent < 0 || a.parent !== b.parent)) {
            const c = 1 - d / P.stressR;
            crowd[a.id] += c;
            crowd[b.id] += c;
          }
          if (hier && d < P.stressRepelR) {
            // stressed cells (high hormone signal) become slightly repulsive
            const k = 1 - d / P.stressRepelR;
            const ea = Math.max(0, a.signal - P.hormoneThr);
            const eb = Math.max(0, b.signal - P.hormoneThr);
            fb -= P.stressRepel * ea * k;
            fa -= P.stressRepel * eb * k;
          }
        }
        fx[a.id] += fa * ux;
        fy[a.id] += fa * uy;
        fx[b.id] -= fb * ux;
        fy[b.id] -= fb * uy;
      }
    }
  }

  // 2. cell stress
  for (const c of byTier[0]) c.stress += (crowd[c.id] - c.stress) * P.stressRate;

  if (hier) {
    // 3a. organism hormone = mean stress of its cells
    for (const o of byTier[1]) {
      let sum = 0;
      for (const c of o.children) sum += ents[c].stress;
      const mean = o.children.length ? sum / o.children.length : 0;
      o.hormone += (mean - o.hormone) * P.hormoneRate;
    }
    // 3b. each cell reads a NOISY copy of its own organism's hormone (downward causation)
    for (const c of byTier[0]) {
      if (c.parent < 0) {
        c.signal = 0;
        continue;
      }
      c.signal = Math.max(0, ents[c.parent].hormone + gauss(s.rng) * P.hormoneNoise);
      const ex = c.signal - P.hormoneThr;
      if (ex > 0) {
        fx[c.id] += gauss(s.rng) * P.jitter * ex;
        fy[c.id] += gauss(s.rng) * P.jitter * ex;
      }
    }
    // 3c. herd density = expected spacing / mean nearest-neighbour distance of its organisms
    const orgs = byTier[1];
    for (const h of byTier[2]) {
      const m = h.children.length;
      if (m < 2) {
        h.density += (1 - h.density) * P.densityRate;
        continue;
      }
      const expected = 2 * ringRadius(2, m) * dsin(Math.PI / m);
      let sumNN = 0;
      for (const oid of h.children) {
        const o = ents[oid];
        let nn = Infinity;
        for (const q of orgs) {
          if (q === o) continue;
          nn = Math.min(nn, dhypot(q.x - o.x, q.y - o.y));
        }
        sumNN += Math.min(nn, expected * 3);
      }
      const raw = expected / Math.max(1, sumNN / m);
      h.density += (raw - h.density) * P.densityRate;
    }
    // 3d. each organism reads a NOISY copy of its own herd's density; drifts out when high, in when low
    for (const o of byTier[1]) {
      if (o.parent < 0) {
        o.signal = 0;
        continue;
      }
      const h = ents[o.parent];
      o.signal = Math.max(0, h.density + gauss(s.rng) * P.densityNoise);
      const dx = o.x - h.x;
      const dy = o.y - h.y;
      const d = dhypot(dx, dy) || 1;
      const f = P.densityGain * (o.signal - 1);
      fx[o.id] += (f * dx) / d;
      fy[o.id] += (f * dy) / d;
    }
  }

  // 4. springs: members toward slots around parent; parent feels eps back-reaction
  for (const e of ents) {
    if (!on(e) || e.parent < 0) continue;
    const p = ents[e.parent];
    const k = p.children.indexOf(e.id);
    const [tx, ty] = slotPos(p, k, p.children.length);
    const Fx = P.springK[p.tier] * (tx - e.x) + P.springC[p.tier] * (p.vx - e.vx);
    const Fy = P.springK[p.tier] * (ty - e.y) + P.springC[p.tier] * (p.vy - e.vy);
    fx[e.id] += Fx;
    fy[e.id] += Fy;
    fx[p.id] -= eps * Fx;
    fy[p.id] -= eps * Fy;
  }

  // 5. self-propulsion of free composites, noise for free cells, soft walls
  for (const e of ents) {
    if (!on(e)) continue;
    if (e.parent < 0 && e.tier > 0) {
      const c = e.tier === 1 ? s.laws.cruise1[e.type] : s.laws.cruise2[e.type];
      fx[e.id] += c * dcos(e.angle);
      fy[e.id] += c * dsin(e.angle);
    }
    if (e.tier === 0 && e.parent < 0) {
      const nz = hier ? P.freeNoise : P.flatNoise;
      fx[e.id] += gauss(s.rng) * nz;
      fy[e.id] += gauss(s.rng) * nz;
    }
    if (e.parent < 0) {
      const R = naturalRadius(s, e);
      if (e.x < R) fx[e.id] += P.wallK * (R - e.x);
      if (e.x > P.worldW - R) fx[e.id] -= P.wallK * (e.x - (P.worldW - R));
      if (e.y < R) fy[e.id] += P.wallK * (R - e.y);
      if (e.y > P.worldH - R) fy[e.id] -= P.wallK * (e.y - (P.worldH - R));
    }
  }

  // 6. integrate (all tiers at the same fixed rate)
  const dragId = s.drag ? s.drag.id : -1;
  for (const e of ents) {
    if (!on(e)) continue;
    if (e.id === dragId) {
      e.vx = 0;
      e.vy = 0;
      continue;
    }
    e.vx = e.vx * P.damping + fx[e.id] * P.dt;
    e.vy = e.vy * P.damping + fy[e.id] * P.dt;
    const sp = dhypot(e.vx, e.vy);
    if (sp > P.maxSpeed) {
      e.vx *= P.maxSpeed / sp;
      e.vy *= P.maxSpeed / sp;
    }
    e.x += e.vx * P.dt;
    e.y += e.vy * P.dt;
    if (e.tier === 1) e.angle += s.laws.spin1[e.type] * P.dt;
    if (e.tier === 2) e.angle += s.laws.spin2[e.type] * P.dt;
  }

  // 7. light goal: organism health
  if (hier) {
    for (const o of byTier[1]) {
      if (!o.alive) continue;
      const ex = o.hormone - P.hormoneThr;
      o.health = ex > 0 ? o.health - P.healthDecay * ex * P.dt : o.health + P.healthRecover * P.dt;
      o.health = Math.min(1, Math.max(0, o.health));
      if (o.health <= 0) dissolveOrganism(s, o, events);
    }
  } else {
    // region "stress" = crowding: cells inside relative to the count expected from uniform spread
    const expected = Math.max(1, (byTier[0].length * Math.PI * P.regionR * P.regionR) / (P.worldW * P.worldH));
    s.regions.forEach((r, i) => {
      let cnt = 0;
      for (const c of byTier[0]) if (dhypot(c.x - r.x, c.y - r.y) < r.r) cnt++;
      r.stress += (cnt / expected - r.stress) * P.hormoneRate;
      const before = r.health;
      const ex = r.stress - P.regionCrowdThr;
      r.health = ex > 0 ? r.health - P.healthDecay * ex * P.dt : r.health + P.healthRecover * P.dt;
      r.health = Math.min(1, Math.max(0, r.health));
      if (before > 0 && r.health <= 0) events.push({ kind: 'region_depleted', index: i });
    });
  }

  s.tick++;
}

/** Deep copy as plain JSON (used for snapshots). */
export function snapshotWorld(s: WorldState): unknown {
  // deep copy: the log must not hold live references that keep changing
  return JSON.parse(JSON.stringify({
    tick: s.tick,
    rng: s.rng.s,
    nextId: s.nextId,
    isolated: s.isolated,
    drag: s.drag,
    regions: s.regions,
    entities: s.entities.filter((e) => e.alive),
  }));
}
