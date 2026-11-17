// All experiment dials + URL-param parsing.
// ?hier=1|0&composition=yes|no&movement=random|laws&cross=0..1&skin=biology|abstract&seed=42&eps=0.05&move=1|0&wander=1&reveal=1|0
//  &lock=1|0&catalysis=1|0&similar=0,1,2|all&org=5-8&herd=3-7&free=140&herds=7&lone=18&same=0|1&chance=graded|uniform|none&short=1&debug=1

import { hash01 } from './sim/rng';
import type { ChanceMode, Dynamics, SimConfig } from './sim/world';

export type Movement = 'random' | 'laws';
export type Skin = 'biology' | 'abstract';

export interface Config {
  hier: boolean;
  /** composition condition: false = composites keep their parts but participants can never see, use or break them */
  composition: boolean;
  skin: Skin;
  seed: number;
  eps: number;
  /** things drift on their own (self-propulsion, laws, noise); off = still unless dragged */
  move: boolean;
  /** movement condition: 'laws' = seed-drawn laws (interaction matrices, swimming, turning) decide how each type
   *  moves; 'random' = every free-standing thing does the same random walk */
  movement: Movement;
  /** movement=random only: strength multiplier of the persistent random walk (0 = just jiggle) */
  wander: number;
  /** composites show only their colour; their contents appear while hovered */
  reveal: boolean;
  /** lock & key at every level (purple + green bind; chance per encounter from `chance`) */
  lock: boolean;
  /** catalysis at every level (light blue makes red spin; chance per encounter from `chance`) */
  catalysis: boolean;
  /** similarity per level [cells, organisms, herds] */
  similar: boolean[];
  /** composite size band [min, unstable): outside it a composite drains and falls apart */
  org: [number, number];
  herd: [number, number];
  /** loose cells floating around at the start */
  free: number;
  /** herds (hazes) and lone organisms (membranes) at the start */
  herds: number;
  lone: number;
  /** same-colour cells may attract each other through the seed-drawn laws */
  same: boolean;
  /** how likely lock & key and catalysis are per level: per-level tables / their mean everywhere / never */
  chance: ChanceMode;
  /**
   * who interacts, w in [0, 1]: 0 = only same-size pairs, 1/2 = every size pair, 1 = only different-size pairs.
   * From the link (`cross=`), else DEFAULTS.cross, else drawn uniformly from the seed.
   */
  cross: number;
  short: boolean;
  debug: boolean;
  /** duration of the Explore phase */
  exploreMs: number;
  /** were these values given explicitly in the URL? (seed is random otherwise) */
  seedFromUrl: boolean;
  /** set only for a generalisation task session (empty world): which task it is */
  task?: 'lock' | 'catalysis';
}

// =====================================================================================================
// TUNE: the app's defaults. Each can be overridden for one run in the URL (see README "URL parameters").
//   conditions .......... hier, composition, movement, chance, cross
//   mechanisms on/off ... same, lock, catalysis (similar: see parseConfig, `levels(q.get('similar'))`)
//   chance condition ... chance: 'graded' (DYNAMICS tables) | 'uniform' (mean of each table) | 'none' (no interactions)
//   motion details ..... move (still world), wander (strength of movement=random)
//   size bands ......... org, herd
//   starting world ..... free, herds, lone
// Strengths and exact pairs are in src/sim/world.ts: DYNAMICS, PAIR_RULES and P.
// =====================================================================================================
export const DEFAULTS = {
  hier: true,
  /** composition condition: true = composition=yes (parts visible and usable), false = composition=no */
  composition: true,
  skin: 'biology' as Skin,
  eps: 0.05,
  move: true,
  /** movement condition: 'random' (same random walk for everyone) | 'laws' (seed-drawn laws per type) */
  movement: 'random' as Movement,
  wander: 1,
  reveal: true,
  lock: true,
  catalysis: true,
  /** optimal sizes [min, unstable): organisms keep their health with 4-5 cells, herds with 3-4 organisms */
  org: [4, 6] as [number, number],
  herd: [3, 5] as [number, number],
  free: 140,
  herds: 7,
  lone: 18,
  same: false,
  chance: 'graded' as ChanceMode,
  /**
   * who-interacts value w in [0, 1] (0 = same size only, 1/2 = every size pair, 1 = different sizes only).
   * null = each participant gets w drawn uniformly from their seed (recorded in the header as `cross`).
   */
  cross: null as number | null,
  exploreMs: 6 * 60 * 1000,
  shortExploreMs: 60 * 1000,
};

/** whole number in [lo, hi], else the default */
function count(v: string | null, dflt: number, lo: number, hi: number): number {
  const x = v === null ? NaN : Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.floor(x))) : dflt;
}

function bool(v: string | null, dflt: boolean): boolean {
  if (v === null) return dflt;
  return v === '1' || v.toLowerCase() === 'true';
}

/** "1" | "true" | "all" -> on, anything else given -> off */
function onOff(v: string | null, dflt: boolean): boolean {
  if (v === null) return dflt;
  const t = v.trim().toLowerCase();
  return t === '1' || t === 'true' || t === 'all';
}

/** "0,2" | "all" | "" -> per-level flags */
function levels(v: string | null): boolean[] {
  const out = [false, false, false];
  if (v === null) return out;
  if (v.trim().toLowerCase() === 'all') return [true, true, true];
  for (const part of v.split(',')) {
    const t = Number(part.trim());
    if (Number.isInteger(t) && t >= 0 && t <= 2) out[t] = true;
  }
  return out;
}

/** "5-8" -> [5, 8]; requires 2 <= min < unstable, else the default */
function band(v: string | null, dflt: [number, number]): [number, number] {
  const m = v === null ? null : /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(v);
  if (!m) return [dflt[0], dflt[1]];
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return lo >= 2 && lo < hi ? [lo, hi] : [dflt[0], dflt[1]];
}

/** salt for drawing the who-interacts value w from the seed (independent of the world's own random stream) */
const CROSS_SALT = 0x2c055;

/** w drawn uniformly in [0, 1) from the seed: the same seed always gives the same w */
export function crossFromSeed(seed: number): number {
  return hash01(seed, CROSS_SALT);
}

export function parseConfig(search: string, randomSeed: () => number = () => Math.floor(Math.random() * 1e9)): Config {
  const q = new URLSearchParams(search);
  const comp = q.get('composition')?.trim().toLowerCase();
  const mv = q.get('movement')?.trim().toLowerCase();
  const skin = q.get('skin') === 'abstract' ? 'abstract' : DEFAULTS.skin;
  const seedRaw = q.get('seed');
  const seedNum = seedRaw === null ? NaN : Number(seedRaw);
  const seedFromUrl = Number.isFinite(seedNum);
  const epsNum = Number(q.get('eps'));
  const short = bool(q.get('short'), false);
  const seed = seedFromUrl ? Math.floor(seedNum) >>> 0 : randomSeed();
  const crossNum = q.get('cross') === null ? NaN : Number(q.get('cross'));
  const cross = Number.isFinite(crossNum) ? Math.min(1, Math.max(0, crossNum)) : DEFAULTS.cross ?? crossFromSeed(seed);
  return {
    hier: bool(q.get('hier'), DEFAULTS.hier),
    composition: comp === 'no' || comp === '0' || comp === 'false' ? false : comp === 'yes' || comp === '1' || comp === 'true' ? true : DEFAULTS.composition,
    skin,
    seed,
    eps: q.get('eps') !== null && Number.isFinite(epsNum) ? Math.min(1, Math.max(0, epsNum)) : DEFAULTS.eps,
    move: bool(q.get('move'), DEFAULTS.move),
    movement: mv === 'laws' || mv === 'random' ? mv : DEFAULTS.movement,
    wander: q.get('wander') !== null && Number.isFinite(Number(q.get('wander'))) ? Math.min(5, Math.max(0, Number(q.get('wander')))) : DEFAULTS.wander,
    reveal: bool(q.get('reveal'), DEFAULTS.reveal),
    lock: onOff(q.get('lock'), DEFAULTS.lock),
    catalysis: onOff(q.get('catalysis'), DEFAULTS.catalysis),
    similar: levels(q.get('similar')),
    org: band(q.get('org'), DEFAULTS.org),
    herd: band(q.get('herd'), DEFAULTS.herd),
    free: count(q.get('free'), DEFAULTS.free, 0, 600),
    herds: count(q.get('herds'), DEFAULTS.herds, 0, 12),
    lone: count(q.get('lone'), DEFAULTS.lone, 0, 40),
    same: bool(q.get('same'), DEFAULTS.same),
    chance: (['graded', 'uniform', 'none'] as const).find((m) => m === q.get('chance')) ?? DEFAULTS.chance,
    cross,
    short,
    debug: bool(q.get('debug'), false),
    exploreMs: short ? DEFAULTS.shortExploreMs : DEFAULTS.exploreMs,
    seedFromUrl,
  };
}

/**
 * The sim's part of a config. The sim keeps its own names: movement -> `laws`, composition -> `compose`.
 * Headers of logs recorded before the rename carry `laws` (boolean) instead of `movement`; it is honoured so they replay.
 */
export function simConfigOf(c: Pick<Config, 'hier' | 'eps' | 'seed'> & Partial<Config> & { laws?: boolean }): SimConfig {
  const laws = c.movement !== undefined ? c.movement === 'laws' : (c.laws ?? true);
  const dyn: Dynamics = { lock: c.lock ?? DEFAULTS.lock, catalysis: c.catalysis ?? DEFAULTS.catalysis, similar: c.similar ?? [false, false, false] };
  return { hier: c.hier, eps: c.eps, seed: c.seed, move: c.move ?? true, laws, compose: c.composition ?? true, wander: c.wander ?? DEFAULTS.wander, dyn, org: c.org ?? DEFAULTS.org, herd: c.herd ?? DEFAULTS.herd, free: c.free ?? DEFAULTS.free, herds: c.herds ?? DEFAULTS.herds, lone: c.lone ?? DEFAULTS.lone, sameAttract: c.same ?? true, chance: c.chance ?? DEFAULTS.chance, cross: c.cross };
}
