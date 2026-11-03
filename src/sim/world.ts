// Pure, deterministic simulation of the alien-biology sandbox.
// MUST NOT import Pixi, jsPsych, or touch the DOM. All randomness via ./rng.

import { dcos, dhypot, dsin } from './dmath';
import { type RngState, gauss, hash01, makeRng, rand, randInt, randRange } from './rng';

// ---------------------------------------------------------------- types

export type Tier = 0 | 1 | 2;

export interface SimConfig {
  hier: boolean;
  eps: number;
  seed: number;
  /** false = still world: no self-propulsion, laws, noise or spin; only springs, contact and walls. Missing = true. */
  move?: boolean;
  /**
   * false = no laws: interaction matrices, self-propulsion and turning are zeroed, and every free-standing
   * entity (not just free cells) random-walks. Contact, springs, downward causation and `dyn` still apply.
   * Missing = true.
   */
  laws?: boolean;
  /** laws=0 only: strength multiplier of the persistent random walk. Missing = 1. */
  wander?: number;
  /** same-level dynamics switched on per tier. Missing = all off. */
  dyn?: Dynamics;
  /** size bands [min, unstable) for organisms / herds. Missing = DEFAULT_ORG / DEFAULT_HERD. */
  org?: readonly [number, number];
  herd?: readonly [number, number];
  /** number of loose cells at the start. Missing = P.freeCells. */
  free?: number;
  /** number of herds / lone organisms at the start. Missing = P.nHerds / P.nLoneOrganisms. */
  herds?: number;
  lone?: number;
  /** false = same-type cells never attract through the laws (positive diagonal of K0 set to 0). Missing = true. */
  sameAttract?: boolean;
}

/**
 * Same-level dynamics. Lock & key acts only between cells and catalysis only between organisms
 * (DYNAMICS.lockTier / catalysisTier); herds have neither. Similarity is switched per tier [cells, organisms, herds].
 */
export interface Dynamics {
  lock: boolean;
  catalysis: boolean;
  similar: readonly boolean[];
}

export const DEFAULT_ORG: readonly [number, number] = [5, 8];
export const DEFAULT_HERD: readonly [number, number] = [3, 7];

// =====================================================================================================
// TUNE: within-level mechanisms. Which pairs bind / catalyse, and how strong every mechanism is.
// Switch mechanisms on/off in DEFAULTS (src/config.ts) or the URL. See README "Tuning the interactions".
// Types: cells 0 mint, 1 violet, 2 amber · organisms 0 sky-blue, 1 rose, 2 lime · herds 0 pale-blue, 1 pale-pink
// =====================================================================================================

/**
 * The fixed (deterministic) rules of the same-level dynamics, and their strengths per tier.
 * Types are cell types (T0), species (T1) and herd kinds (T2); the same tables apply at every level.
 */
export const DYNAMICS = {
  /** lock & key acts between cells only */
  lockTier: 0,
  /** catalysis acts between organisms only */
  catalysisTier: 1,
  /** lock & key: unordered pairs of cell types that bind (mint + violet) */
  lockPairs: [[0, 1]] as readonly (readonly [number, number])[],
  /** catalysis: [catalyst, target] species: the target spins while the catalyst touches it (sky-blue -> rose) */
  catalysis: [[0, 1]] as readonly (readonly [number, number])[],
  /** bond spring strength / damping */
  bondK: 60,
  bondC: 6,
  /** a pair binds when closer than rA + rB + bindMargin */
  bindMargin: 4,
  /** a bound cell pushes every cell except its partner within this range ... */
  lockRepelR: 30,
  /** ... with this strength at contact, fading to 0 at the range (collision is 600, laws <= 150) */
  lockRepel: 100,
  /** before binding: a free mint and a free violet within this range pull gently toward each other ... */
  lockAttractR: 40,
  /** ... with this strength at contact, fading to 0 at the range (free-cell noise 30, laws <= 150) */
  lockAttract: 50,
  /** "touching" for catalysis: closer than rA + rB + catMargin */
  catMargin: 12,
  /** catalysed spin, rad/s (~1 turn per 2 s) */
  catSpin: 3.0,
  /** without contact the spin decays by this factor per tick (3.0 -> 0.3 rad/s in ~1.9 s) ... */
  catDecay: 0.96,
  /** ... and stops below this (~2 s after contact ends) */
  catStop: 0.2,
  /** gap between the two organisms of a catalyst-target pair placed together in a herd */
  pairGap: 6,
  /** "touching" for combining a group with C: gap below this, per tier [cells, organisms] */
  combineMargin: [8, 20],
  /** similarity: like types attract, unlike repel (same kernel as the laws) */
  simGain: [45, 18, 20],
  /** health lost per second while a composite is outside its size band */
  sizeDecay: 0.05,
};

/**
 * TUNE: exactly which elements within a level interact, per level [cells, organisms, herds].
 *
 * laws[level][i][j]: how strongly type i is pulled toward type j (row = the one that moves, column = the one it
 *   reacts to). null = drawn by the seed (default). A number in -1..1 fixes it: + attract, - repel, 0 no interaction.
 *   It is multiplied by P.gain[level]. Applied after `same=0`, so an explicit entry wins; ignored when `laws=0`;
 *   the flat condition keeps its all-zero laws.
 * similarTypes[level]: types that take part in similarity (when `similar` is on at that level). Two listed types of
 *   the same kind attract; two different listed types repel; unlisted types ignore similarity entirely.
 * similarRepel[level]: false = keep only the "like attracts like" half (different listed types don't repel).
 */
export const PAIR_RULES = {
  laws: [
    // cells: rows/columns mint, violet, amber
    [
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ],
    // organisms: rows/columns sky-blue, rose, lime
    [
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ],
    // herds: rows/columns pale-blue, pale-pink
    [
      [null, null],
      [null, null],
    ],
  ] as (number | null)[][][],
  similarTypes: [
    [0, 1, 2],
    [0, 1, 2],
    [0, 1],
  ] as number[][],
  similarRepel: [true, true, true],
};

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
  /** T1/T2: 0..1 */
  health: number;
  /** lock & key partner (free entities only), -1 = none */
  bond: number;
  /** T2: packing of its organisms (1 = nominal) */
  density: number;
  /** T1/T2: which recipe realises this species / herd kind */
  realisation: number;
  /** laws=0 only: direction of the persistent random walk (separate from `angle`, which catalysis turns) */
  heading: number;
  /** T1: catalysed spin, rad/s; set on contact with a catalyst, decays after */
  spin: number;
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
  /** free same-tier entities (2+) found a new parent one tier up; ids[0] is the dragged one */
  | { kind: 'combine'; ids: number[] }
  | { kind: 'isolate'; id: number | null }
  | { kind: 'speed'; speed: number }
  | { kind: 'swap'; id: number };

export type SimEvent =
  | { kind: 'organism_death'; id: number; cause: 'health' | 'empty' | 'size'; cells: number[] }
  | { kind: 'herd_dissolved'; id: number; cause?: 'size'; organisms?: number[] }
  | { kind: 'region_depleted'; index: number }
  | { kind: 'swapped'; id: number; realisation: number; removed: number[]; added: number[] }
  | { kind: 'founded'; id: number; tier: Tier; type: number; realisation: number; members: number[] };

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
  // TUNE: starting world (the app's defaults are in DEFAULTS in src/config.ts; these are the fallbacks)
  /** starting herds (SimConfig.herds overrides) */
  nHerds: 7,
  /** starting lone organisms (SimConfig.lone overrides) */
  nLoneOrganisms: 18,
  /** cap on cells inside organisms (generated herds + lone organisms) */
  maxComposedCells: 380,
  /** loose cells floating around at the start (SimConfig.free overrides) */
  freeCells: 140,
  // TUNE: same-tier interactions, per level [T0, T1, T2]: core range (rmin), reach (rmax),
  // contact repulsion strength (repel) and overall strength of the laws (gain)
  rmin: [11, 58, 220],
  rmax: [45, 220, 800],
  repel: [600, 400, 300],
  gain: [150, 60, 70],
  // TUNE: springs member -> parent slot, indexed by parent tier (how tightly parts are held)
  springK: [0, 70, 10],
  springC: [0, 4, 2],
  // TUNE: downward causation (hormone / herd density)
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
  // laws=0: persistent random walk of free-standing things, per tier [cells, organisms, herds].
  // Force along `heading` (top speed ~ force/3 u/s); heading turns by gauss * wanderTurn per tick
  // (direction persists for ~3 s). Same for every type, so it is random, not a law.
  // organisms and herds are set so they meet about as often as with laws on (probe: ~13 vs ~17 meetings / 2 min)
  wander: [30, 90, 90],
  wanderTurn: 0.15,
  // flat: uniform matrix value. Any attraction > 0 makes clumps that persist; 0 keeps groupings transient.
  flatUniform: 0,
  wallK: 20,
  /** collision between free-standing things of different levels: push per unit of overlap */
  crossK: 40,
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

/**
 * A parent's children grouped into places on its ring. A pair shares one place, its two members touching:
 * in an organism, a lock & key pair of its own cells; in a herd (catalysis on), a catalyst + target organism,
 * matched greedily in child order. Everything else gets a place of its own.
 */
export function ringUnits(s: WorldState, p: Entity): number[][] {
  const partner = new Map<number, number>();
  if (p.tier === 1) {
    for (const c of p.children) {
      const b = s.entities[c].bond;
      if (b >= 0 && s.entities[b].parent === p.id) partner.set(c, b);
    }
  } else if (p.tier === 2 && catalysisOn(s.config, 1)) {
    for (const c of p.children) {
      if (partner.has(c)) continue;
      for (const t of p.children) {
        if (t !== c && !partner.has(t) && catalyses(s.entities[c].type, s.entities[t].type)) {
          partner.set(c, t);
          partner.set(t, c);
          break;
        }
      }
    }
  }
  const units: number[][] = [];
  const placed = new Set<number>();
  for (const c of p.children) {
    if (placed.has(c)) continue;
    placed.add(c);
    const q = partner.get(c);
    if (q !== undefined && !placed.has(q)) {
      placed.add(q);
      units.push([c, q]);
    } else {
      units.push([c]);
    }
  }
  return units;
}

/**
 * Where each child of `p` is held: places spread evenly round the ring; the two members of a pair sit either
 * side of their place along the ring, touching (cells) or just apart (organisms, inside catalysis contact).
 */
export function memberTargets(s: WorldState, p: Entity): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  const units = ringUnits(s, p);
  const R = ringRadius(p.tier, p.children.length);
  units.forEach((u, k) => {
    const a = p.angle + (2 * Math.PI * k) / units.length;
    const cx = p.x + R * dcos(a);
    const cy = p.y + R * dsin(a);
    if (u.length === 1) {
      out.set(u[0], [cx, cy]);
      return;
    }
    // tangent along the ring
    const tx = -dsin(a);
    const ty = dcos(a);
    const [m0, m1] = u.map((id) => s.entities[id]);
    const half = p.tier === 1 ? [P.cellR, P.cellR] : [naturalRadius(s, m0) + DYNAMICS.pairGap / 2, naturalRadius(s, m1) + DYNAMICS.pairGap / 2];
    out.set(m0.id, [cx - tx * half[0], cy - ty * half[0]]);
    out.set(m1.id, [cx + tx * half[1], cy + ty * half[1]]);
  });
  return out;
}

/** Move each child (with its parts) straight onto its place, e.g. right after building. */
function settle(s: WorldState, p: Entity): void {
  for (const [id, [x, y]] of memberTargets(s, p)) {
    const c = s.entities[id];
    translateTree(s, id, x - c.x, y - c.y);
  }
}

/** Lock & key inside an organism: its unbound mint and violet cells pair up, greedily in child order. */
function pairWithin(s: WorldState, o: Entity): void {
  if (o.tier !== 1 || !lockOn(s.config, 0)) return;
  for (const c of o.children) {
    const a = s.entities[c];
    if (a.bond >= 0) continue;
    for (const d of o.children) {
      const b = s.entities[d];
      if (d !== c && b.bond < 0 && isLockPair(a.type, b.type)) {
        a.bond = d;
        b.bond = c;
        break;
      }
    }
  }
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

/** Size band [min, unstable) of composites at this tier: outside it they drain and fall apart. */
export function band(c: SimConfig, tier: Tier): readonly [number, number] {
  return tier === 1 ? (c.org ?? DEFAULT_ORG) : (c.herd ?? DEFAULT_HERD);
}

/** Lock & key is on, and this is its level (cells). */
export function lockOn(c: SimConfig, tier: number): boolean {
  return tier === DYNAMICS.lockTier && c.dyn?.lock === true;
}

/** Catalysis is on, and this is its level (organisms). */
export function catalysisOn(c: SimConfig, tier: number): boolean {
  return tier === DYNAMICS.catalysisTier && c.dyn?.catalysis === true;
}

function similarOn(c: SimConfig, tier: number): boolean {
  return c.dyn?.similar[tier] === true;
}

/** Does similarity act between these two types at this level (PAIR_RULES.similarTypes / similarRepel)? */
function similarPair(tier: number, a: number, b: number): boolean {
  const types = PAIR_RULES.similarTypes[tier] ?? [];
  if (!types.includes(a) || !types.includes(b)) return false;
  return a === b || PAIR_RULES.similarRepel[tier] !== false;
}

function makeGrammar(r: RngState, c: SimConfig): Grammar {
  // recipes only use stable sizes
  const [omin, ounst] = band(c, 1);
  const [hmin, hunst] = band(c, 2);
  const species: number[][][] = [];
  for (let s = 0; s < P.nSpecies; s++) {
    const r0 = recipe(r, randInt(r, omin, ounst - 1), s, P.nCellTypes);
    // second realisation: different dominant cell type, so it looks different but behaves the same
    const r1 = recipe(r, randInt(r, omin, ounst - 1), (s + 1) % P.nCellTypes, P.nCellTypes);
    species.push([r0, r1]);
  }
  const herds: number[][][] = [];
  for (let k = 0; k < P.nHerdKinds; k++) {
    // the generated realisation has more than the minimum where the band allows (4-6 organisms by default)
    const r0 = recipe(r, randInt(r, Math.min(hmin + 1, hunst - 1), hunst - 1), k, P.nSpecies);
    const r1 = recipe(r, randInt(r, Math.min(hmin + 1, hunst - 1), hunst - 1), (k + 2) % P.nSpecies, P.nSpecies);
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

/** Overwrite the seed-drawn law entries that PAIR_RULES fixes (non-null entries). */
function applyPairRules(laws: Laws): void {
  [laws.K0, laws.K1, laws.K2].forEach((K, t) =>
    PAIR_RULES.laws[t]?.forEach((row, i) =>
      row.forEach((v, j) => {
        if (v !== null && K[i] && K[i][j] !== undefined) K[i][j] = v;
      }),
    ),
  );
}

// TUNE: the seed draws every law entry from -1..1 (rounded to 0.01), cruise speeds and turning rates from the ranges
// below. Fix individual law entries with PAIR_RULES instead of editing this.
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

/** The same laws with every matrix entry, cruise speed and turning rate set to 0. */
function lawless(l: Laws): Laws {
  const zero = (m: number[][]) => m.map((row) => row.map(() => 0));
  return {
    K0: zero(l.K0),
    K1: zero(l.K1),
    K2: zero(l.K2),
    Kflat: zero(l.Kflat),
    cruise1: l.cruise1.map(() => 0),
    cruise2: l.cruise2.map(() => 0),
    spin1: l.spin1.map(() => 0),
    spin2: l.spin2.map(() => 0),
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
    health: tier > 0 ? 1 : 0,
    bond: -1,
    density: tier === 2 ? 1 : 0,
    realisation: 0,
    heading: 0,
    spin: 0,
  };
  // stateless hash, so generation consumes no extra rng draws and laws=1 worlds are unchanged
  e.heading = hash01(s.config.seed, e.id) * 2 * Math.PI;
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
  pairWithin(s, o);
  settle(s, o);
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
  settle(s, h);
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
  const grammar = makeGrammar(rng, config);
  // laws are always drawn (so the rng stream, and thus the generated world, is the same either way), then zeroed
  const laws = config.laws === false ? lawless(makeLaws(rng)) : makeLaws(rng);
  if (config.sameAttract === false) {
    // no same-colour attraction between cells; same-colour repulsion and all other laws stay
    laws.K0.forEach((row, i) => (row[i] = Math.min(0, row[i])));
  }
  if (config.laws !== false) applyPairRules(laws);
  const s = emptyState(config, rng, grammar, laws);

  // Always generate the hierarchical world first, so the flat condition gets the same cells.
  const herdPts: [number, number][] = [];
  for (let h = 0; h < (config.herds ?? P.nHerds); h++) {
    const [x, y] = placeAwayFrom(rng, herdPts, 480, 260);
    herdPts.push([x, y]);
    const kind = h < 4 ? h % 2 : randInt(rng, 0, P.nHerdKinds - 1);
    buildHerd(s, kind, 0, x, y, rand(rng) * Math.PI * 2);
  }
  const lonePts = herdPts.slice();
  const countCells = () => s.entities.filter((e) => e.tier === 0).length;
  for (let i = 0; i < (config.lone ?? P.nLoneOrganisms); i++) {
    const [x, y] = placeAwayFrom(rng, lonePts, 240, 80);
    lonePts.push([x, y]);
    const sp = randInt(rng, 0, P.nSpecies - 1);
    if (countCells() + s.grammar.species[sp][0].length > P.maxComposedCells) continue;
    buildOrganism(s, sp, 0, x, y, rand(rng) * Math.PI * 2);
  }
  const nFree = config.free ?? P.freeCells;
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

/** Break e's lock & key bond, if any. */
function unbond(s: WorldState, e: Entity): void {
  if (e.bond >= 0) s.entities[e.bond].bond = -1;
  e.bond = -1;
}

function kill(s: WorldState, e: Entity): void {
  unbond(s, e);
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

/** Free a composite's members with an outward kick; returns their ids. */
function releaseMembers(s: WorldState, p: Entity): number[] {
  const members = p.children.slice();
  for (const c of members) {
    const ce = s.entities[c];
    ce.parent = -1;
    ce.signal = 0;
    const dx = ce.x - p.x;
    const dy = ce.y - p.y;
    const d = dhypot(dx, dy) || 1;
    ce.vx += (dx / d) * 40;
    ce.vy += (dy / d) * 40;
  }
  p.children = [];
  return members;
}

function dissolveHerd(s: WorldState, h: Entity, events: SimEvent[]): void {
  const organisms = releaseMembers(s, h);
  events.push({ kind: 'herd_dissolved', id: h.id, cause: 'size', organisms });
  kill(s, h);
}

function dissolveOrganism(s: WorldState, o: Entity, cause: 'health' | 'size', events: SimEvent[]): void {
  const cells = releaseMembers(s, o);
  events.push({ kind: 'organism_death', id: o.id, cause, cells });
  unparent(s, o, events);
  kill(s, o);
}

function translateTree(s: WorldState, id: number, dx: number, dy: number): void {
  const e = s.entities[id];
  e.x += dx;
  e.y += dy;
  for (const c of e.children) translateTree(s, c, dx, dy);
}

/** Drag translation: the entity's tree plus its bond partner's tree (a bound pair moves as one). */
function translateHeld(s: WorldState, id: number, dx: number, dy: number): void {
  translateTree(s, id, dx, dy);
  const b = s.entities[id].bond;
  if (b >= 0) translateTree(s, b, dx, dy);
}

/** A free entity together with its bond partner (if any): a bound pair always joins / combines as one. */
export function withPartner(s: WorldState, id: number): number[] {
  const b = s.entities[id].bond;
  return b >= 0 ? [id, b] : [id];
}

export function canJoin(s: WorldState, childId: number, parentId: number): boolean {
  if (!s.config.hier) return false;
  const c = s.entities[childId];
  const p = s.entities[parentId];
  if (!c || !p || !c.alive || !p.alive || c.parent >= 0 || p.tier !== c.tier + 1) return false;
  const group = withPartner(s, childId).map((id) => s.entities[id]);
  if (group.some((g) => !g.alive || g.parent >= 0)) return false;
  // joins are allowed up to the unstable size: over-filling makes the composite drain
  if (p.children.length + group.length - 1 >= band(s.config, p.tier)[1]) return false;
  const recipes = p.tier === 1 ? s.grammar.species[p.type] : s.grammar.herds[p.type];
  return group.every((g) => recipes.some((rc) => rc.includes(g.type)));
}

/** Nearest compatible parent the entity is touching (or nearly), or -1. */
export function findJoinTarget(s: WorldState, id: number): number {
  const c = s.entities[id];
  if (!c || !c.alive || c.parent >= 0 || c.tier >= 2) return -1;
  const rc = naturalRadius(s, c);
  let best = -1;
  let bestD = Infinity;
  for (const p of s.entities) {
    if (!p.alive || p.tier !== c.tier + 1 || !canJoin(s, id, p.id)) continue;
    const d = dhypot(p.x - c.x, p.y - c.y);
    // + rc: collision between levels stops things at the parent's edge, so measure from there
    if (d < naturalRadius(s, p) + rc + P.joinMargin && d < bestD) {
      best = p.id;
      bestD = d;
    }
  }
  return best;
}

/**
 * Which species / herd kind (and recipe) a new parent of these member types would be, or null.
 * A kind qualifies if every type appears in some recipe of it (the same test as canJoin); among those,
 * the recipe covering the most of the types (counting repeats) wins, ties to the lowest kind then recipe.
 */
export function combineKind(s: WorldState, tier: Tier, types: readonly number[]): { type: number; realisation: number } | null {
  if (tier >= 2) return null;
  const kinds = tier === 0 ? s.grammar.species : s.grammar.herds;
  let best: { type: number; realisation: number } | null = null;
  let bestScore = -1;
  for (let k = 0; k < kinds.length; k++) {
    const recipes = kinds[k];
    if (!types.every((t) => recipes.some((rc) => rc.includes(t)))) continue;
    for (let r = 0; r < recipes.length; r++) {
      const left = recipes[r].slice();
      let score = 0;
      for (const t of types) {
        const i = left.indexOf(t);
        if (i >= 0) {
          left.splice(i, 1);
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = { type: k, realisation: r };
      }
    }
  }
  return best;
}

/**
 * Can these free same-tier entities (2+) found a new parent one tier up? Every bound member's partner must
 * be in the group too (a pair is never split by combining).
 */
export function canCombine(s: WorldState, ids: readonly number[]): boolean {
  if (!s.config.hier || s.isolated >= 0 || ids.length < 2 || new Set(ids).size !== ids.length) return false;
  const ms = ids.map((id) => s.entities[id]);
  if (ms.some((m) => !m || !m.alive || m.parent >= 0)) return false;
  const tier = ms[0].tier;
  if (tier >= 2 || ms.some((m) => m.tier !== tier)) return false;
  if (ms.some((m) => m.bond >= 0 && !ids.includes(m.bond))) return false;
  return combineKind(s, tier, ms.map((m) => m.type)) !== null;
}

/**
 * The group C would combine: the dragged entity, its partner, and every free same-tier entity touching the
 * group (and so on outward), each with its partner. Dragged first, then in order of discovery.
 */
export function findCombineGroup(s: WorldState, id: number): number[] {
  const c = s.entities[id];
  if (!c || !c.alive || c.parent >= 0 || c.tier >= 2) return [];
  const margin = DYNAMICS.combineMargin[c.tier];
  const group: number[] = [];
  const add = (x: number) => {
    for (const m of withPartner(s, x)) if (!group.includes(m)) group.push(m);
  };
  add(id);
  for (let i = 0; i < group.length; i++) {
    const g = s.entities[group[i]];
    const rg = naturalRadius(s, g);
    for (const o of s.entities) {
      if (!o.alive || o.tier !== c.tier || o.parent >= 0 || group.includes(o.id)) continue;
      if (dhypot(o.x - g.x, o.y - g.y) - rg - naturalRadius(s, o) < margin) add(o.id);
    }
  }
  return group;
}

function foundParent(s: WorldState, ids: readonly number[], events: SimEvent[]): void {
  const ms = ids.map((id) => s.entities[id]);
  const kind = combineKind(s, ms[0].tier, ms.map((m) => m.type));
  if (!kind) return;
  const tier = (ms[0].tier + 1) as Tier;
  let x = 0, y = 0, vx = 0, vy = 0;
  for (const m of ms) {
    x += m.x / ms.length;
    y += m.y / ms.length;
    vx += m.vx / ms.length;
    vy += m.vy / ms.length;
  }
  const p = newEntity(s, tier, kind.type, x, y);
  p.vx = vx;
  p.vy = vy;
  p.angle = rand(s.rng) * Math.PI * 2;
  p.realisation = kind.realisation;
  // bonds are kept: a lock & key pair stays attached inside the new organism
  for (const m of ms) {
    adopt(p, m);
    m.signal = 0;
  }
  pairWithin(s, p);
  events.push({ kind: 'founded', id: p.id, tier, type: p.type, realisation: p.realisation, members: [...ids] });
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
  pairWithin(s, e);
  settle(s, e);
  const added: number[] = [];
  for (let id = first; id < s.nextId; id++) added.push(id);
  events.push({ kind: 'swapped', id: e.id, realisation: e.realisation, removed, added });
}

function isLockPair(a: number, b: number): boolean {
  return DYNAMICS.lockPairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function catalyses(catalyst: number, target: number): boolean {
  return DYNAMICS.catalysis.some(([c, t]) => c === catalyst && t === target);
}

function outsideBand(s: WorldState, e: Entity): boolean {
  const [min, unstable] = band(s.config, e.tier);
  return e.children.length < min || e.children.length >= unstable;
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
      translateHeld(s, a.id, a.x - e.x, a.y - e.y);
      e.vx = 0;
      e.vy = 0;
      break;
    }
    case 'dragMove': {
      if (!s.drag || s.drag.id !== a.id || !validId(s, a.id)) break;
      s.drag.x = a.x;
      s.drag.y = a.y;
      const e = s.entities[a.id];
      translateHeld(s, a.id, a.x - e.x, a.y - e.y);
      break;
    }
    case 'dragEnd':
      if (s.drag && s.drag.id === a.id) s.drag = null;
      break;
    case 'detach': {
      // Shift-drag. A member leaves its parent and takes its bond partner along (the pair stays attached);
      // a free bound entity is pulled off its partner.
      if (!validId(s, a.id)) break;
      const e = s.entities[a.id];
      if (e.parent >= 0) {
        const partner = e.bond >= 0 && s.entities[e.bond].parent === e.parent ? s.entities[e.bond] : null;
        if (e.bond >= 0 && !partner) unbond(s, e);
        unparent(s, e, events);
        if (partner) unparent(s, partner, events);
      } else {
        unbond(s, e);
      }
      break;
    }
    case 'join':
      // the entity joins with its bond partner, which stays attached inside
      if (canJoin(s, a.id, a.parent)) {
        const p = s.entities[a.parent];
        for (const id of withPartner(s, a.id)) adopt(p, s.entities[id]);
        pairWithin(s, p);
      }
      break;
    case 'combine':
      if (canCombine(s, a.ids)) foundParent(s, a.ids, events);
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
  const drift = s.config.move !== false;
  const ents = s.entities;
  const n = ents.length;
  const active = isActiveSet(s);
  const on = (e: Entity) => e.alive && (active === null || active[e.id] === 1);
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const crowd = new Float64Array(n);

  const byTier: Entity[][] = [[], [], []];
  for (const e of ents) if (on(e)) byTier[e.tier].push(e);

  // natural radii (contact distances for lock & key and catalysis)
  const rad = new Float64Array(n);
  for (const e of ents) if (on(e)) rad[e.id] = naturalRadius(s, e);
  // the dragged entity and its bond partner are held by the pointer
  const held = new Uint8Array(n);
  if (s.drag && ents[s.drag.id].alive) {
    held[s.drag.id] = 1;
    if (ents[s.drag.id].bond >= 0) held[ents[s.drag.id].bond] = 1;
  }

  // 0. lock & key (cells only). Inside an organism its unbound mint and violet cells pair up; free ones bind
  // when they touch (ascending id order, first match wins). Never across organisms, never free with a member.
  const lock = lockOn(s.config, 0);
  if (lock) {
    for (const o of byTier[1]) pairWithin(s, o);
    const list = byTier[0];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.parent >= 0 || a.bond >= 0 || held[a.id]) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.parent >= 0 || b.bond >= 0 || held[b.id] || !isLockPair(a.type, b.type)) continue;
        if (dhypot(b.x - a.x, b.y - a.y) < rad[a.id] + rad[b.id] + DYNAMICS.bindMargin) {
          a.bond = b.id;
          b.bond = a.id;
          break;
        }
      }
    }
  }
  // organisms touched by a catalyst this tick (catalysis: organisms only, full strength wherever they are)
  const catTouched = new Uint8Array(n);

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
        } else if (drift) {
          // siblings interact fully; non-siblings at the same tier leak through eps.
          // A free cell sits in no unit, so there is no boundary to leak across: it feels everything.
          const free = t === 0 && (a.parent < 0 || b.parent < 0);
          const w = !hier || free || a.parent === b.parent ? 1 : eps;
          const tri = 1 - Math.abs(2 * d - rmax - rmin) / (rmax - rmin);
          fa += P.gain[t] * K[a.type][b.type] * tri * w;
          fb += P.gain[t] * K[b.type][a.type] * tri * w;
          if (similarOn(s.config, t) && similarPair(t, a.type, b.type) && !(lockOn(s.config, t) && isLockPair(a.type, b.type))) {
            // birds of a feather: like types attract, unlike types repel (lock pairs are exempt: they fit)
            const sim = DYNAMICS.simGain[t] * (a.type === b.type ? 1 : -1) * tri * w;
            fa += sim;
            fb += sim;
          }
        }
        if (catalysisOn(s.config, t) && d < rad[a.id] + rad[b.id] + DYNAMICS.catMargin) {
          // catalysis: a touching catalyst makes its target spin
          if (catalyses(a.type, b.type)) catTouched[b.id] = 1;
          if (catalyses(b.type, a.type)) catTouched[a.id] = 1;
        }
        if (t === 0) {
          if (
            lock && drift && d < DYNAMICS.lockAttractR && a.parent < 0 && b.parent < 0 &&
            a.bond < 0 && b.bond < 0 && isLockPair(a.type, b.type)
          ) {
            // two loose, unbound lock-pair cells near each other pull gently together, so they find each other and bind
            const k = DYNAMICS.lockAttract * (1 - d / DYNAMICS.lockAttractR);
            fa += k;
            fb += k;
          }
          if (lock && d < DYNAMICS.lockRepelR) {
            // a bound cell mildly pushes away every cell except its partner, so pairs don't clump
            const k = DYNAMICS.lockRepel * (1 - d / DYNAMICS.lockRepelR);
            if (a.bond >= 0 && a.bond !== b.id) fb -= k;
            if (b.bond >= 0 && b.bond !== a.id) fa -= k;
          }
          if (d < P.stressR && (a.parent < 0 || a.parent !== b.parent)) {
            const c = 1 - d / P.stressR;
            crowd[a.id] += c;
            crowd[b.id] += c;
          }
          if (hier && drift && d < P.stressRepelR) {
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

  // 1b. collision between levels: free-standing things of different levels can't overlap (a loose cell can't
  // pass through an organism or herd, a lone organism can't pass through a herd). Their members are protected
  // by their disc. The push is shared by mass (cells inside), so a cell bounces off a herd rather than shoving it.
  if (hier) {
    const tops = ents.filter((e) => on(e) && e.parent < 0);
    const mass = (e: Entity): number => (e.tier === 0 ? 1 : e.children.reduce((m, c) => m + mass(ents[c]), 0) || 1);
    const m = new Float64Array(n);
    for (const e of tops) m[e.id] = mass(e);
    for (let i = 0; i < tops.length; i++) {
      const a = tops[i];
      for (let j = i + 1; j < tops.length; j++) {
        const b = tops[j];
        if (a.tier === b.tier) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = rad[a.id] + rad[b.id];
        if (dx * dx + dy * dy >= reach * reach) continue;
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const f = P.crossK * (reach - d);
        const ma = m[a.id];
        const mb = m[b.id];
        fx[a.id] -= ((f * mb) / (ma + mb)) * (dx / d);
        fy[a.id] -= ((f * mb) / (ma + mb)) * (dy / d);
        fx[b.id] += ((f * ma) / (ma + mb)) * (dx / d);
        fy[b.id] += ((f * ma) / (ma + mb)) * (dy / d);
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
      if (drift && ex > 0) {
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
      if (!drift) continue;
      const dx = o.x - h.x;
      const dy = o.y - h.y;
      const d = dhypot(dx, dy) || 1;
      const f = P.densityGain * (o.signal - 1);
      fx[o.id] += (f * dx) / d;
      fy[o.id] += (f * dy) / d;
    }
  }

  // 4. springs: members toward their place around the parent (pairs share a place); parent feels eps back-reaction
  const targets = new Map<number, Map<number, [number, number]>>();
  for (const e of ents) {
    if (!on(e) || e.parent < 0) continue;
    const p = ents[e.parent];
    let pt = targets.get(p.id);
    if (!pt) {
      pt = memberTargets(s, p);
      targets.set(p.id, pt);
    }
    const [tx, ty] = pt.get(e.id)!;
    const Fx = P.springK[p.tier] * (tx - e.x) + P.springC[p.tier] * (p.vx - e.vx);
    const Fy = P.springK[p.tier] * (ty - e.y) + P.springC[p.tier] * (p.vy - e.vy);
    fx[e.id] += Fx;
    fy[e.id] += Fy;
    fx[p.id] -= eps * Fx;
    fy[p.id] -= eps * Fy;
  }

  // 4b. lock & key bonds: a spring holds each bound pair touching
  for (const a of ents) {
    if (!on(a) || a.bond < a.id) continue; // each pair once, from its lower id
    const b = ents[a.bond];
    if (!on(b)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = dhypot(dx, dy) || 1e-6;
    const ext = d - (rad[a.id] + rad[b.id]);
    const Fx = DYNAMICS.bondK * ext * (dx / d) + DYNAMICS.bondC * (b.vx - a.vx);
    const Fy = DYNAMICS.bondK * ext * (dy / d) + DYNAMICS.bondC * (b.vy - a.vy);
    fx[a.id] += Fx;
    fy[a.id] += Fy;
    fx[b.id] -= Fx;
    fy[b.id] -= Fy;
  }

  // 5. self-propulsion of free composites, noise for free cells, soft walls
  for (const e of ents) {
    if (!on(e)) continue;
    if (drift && e.parent < 0 && e.tier > 0) {
      const c = e.tier === 1 ? s.laws.cruise1[e.type] : s.laws.cruise2[e.type];
      fx[e.id] += c * dcos(e.angle);
      fy[e.id] += c * dsin(e.angle);
    }
    // random walk: free cells always; with laws off, every free-standing entity
    if (drift && e.parent < 0 && (e.tier === 0 || s.config.laws === false)) {
      const nz = hier ? P.freeNoise : P.flatNoise;
      fx[e.id] += gauss(s.rng) * nz;
      fy[e.id] += gauss(s.rng) * nz;
    }
    const wanders = drift && e.parent < 0 && s.config.laws === false;
    if (wanders) {
      // persistent random walk: keep going roughly the same way, drifting direction at random
      e.heading += gauss(s.rng) * P.wanderTurn;
      const w = P.wander[e.tier] * (s.config.wander ?? 1);
      fx[e.id] += w * dcos(e.heading);
      fy[e.id] += w * dsin(e.heading);
    }
    if (e.parent < 0) {
      const R = naturalRadius(s, e);
      if (e.x < R) fx[e.id] += P.wallK * (R - e.x);
      if (e.x > P.worldW - R) fx[e.id] -= P.wallK * (e.x - (P.worldW - R));
      if (e.y < R) fy[e.id] += P.wallK * (R - e.y);
      if (e.y > P.worldH - R) fy[e.id] -= P.wallK * (e.y - (P.worldH - R));
      if (wanders) {
        // bounce the walk off the walls instead of pressing into them
        if ((e.x < R && dcos(e.heading) < 0) || (e.x > P.worldW - R && dcos(e.heading) > 0)) e.heading = Math.PI - e.heading;
        if ((e.y < R && dsin(e.heading) < 0) || (e.y > P.worldH - R && dsin(e.heading) > 0)) e.heading = -e.heading;
      }
    }
  }

  // 6. integrate (all tiers at the same fixed rate)
  for (const e of ents) {
    if (!on(e)) continue;
    if (e.tier === 1) {
      // catalysed spin: full speed while a catalyst touches, then winding down over ~2 s
      if (catTouched[e.id]) e.spin = Math.max(e.spin, DYNAMICS.catSpin);
      else if (e.spin > 0) e.spin = e.spin * DYNAMICS.catDecay < DYNAMICS.catStop ? 0 : e.spin * DYNAMICS.catDecay;
      e.angle += e.spin * P.dt;
    }
    if (held[e.id]) {
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
    if (drift && e.tier === 1) e.angle += s.laws.spin1[e.type] * P.dt;
    if (drift && e.tier === 2) e.angle += s.laws.spin2[e.type] * P.dt;
  }

  // 7. light goal: organism health, plus the size band of organisms and herds
  if (hier) {
    for (const o of byTier[1]) {
      if (!o.alive) continue;
      const ex = o.hormone - P.hormoneThr;
      const out = outsideBand(s, o);
      let dh = ex > 0 ? -P.healthDecay * ex : out ? 0 : P.healthRecover;
      if (out) dh -= DYNAMICS.sizeDecay;
      o.health = Math.min(1, Math.max(0, o.health + dh * P.dt));
      if (o.health <= 0) dissolveOrganism(s, o, out ? 'size' : 'health', events);
    }
    for (const h of byTier[2]) {
      if (!h.alive) continue;
      const out = outsideBand(s, h);
      h.health = Math.min(1, Math.max(0, h.health + (out ? -DYNAMICS.sizeDecay : P.healthRecover) * P.dt));
      if (h.health <= 0) dissolveHerd(s, h, events);
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
