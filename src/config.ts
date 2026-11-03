// All experiment dials + URL-param parsing.
// ?hier=1|0&size=proxy|irrelevant&skin=biology|abstract&seed=42&eps=0.05&move=1|0&laws=1|0&wander=1&reveal=1|0
//  &lock=1|0&catalysis=1|0&similar=0,1,2|all&org=5-8&herd=3-7&free=140&herds=7&lone=18&same=0|1&short=1&debug=1

import type { Dynamics, SimConfig } from './sim/world';

export type SizeMode = 'proxy' | 'irrelevant';
export type Skin = 'biology' | 'abstract';

export interface Config {
  hier: boolean;
  size: SizeMode;
  skin: Skin;
  seed: number;
  eps: number;
  /** things drift on their own (self-propulsion, laws, noise); off = still unless dragged */
  move: boolean;
  /** seed-drawn laws (interaction matrices, swimming, turning); off = every free-standing thing just random-walks */
  laws: boolean;
  /** laws=0 only: strength multiplier of the persistent random walk (0 = just jiggle) */
  wander: number;
  /** composites show only their colour; their contents appear while hovered */
  reveal: boolean;
  /** lock & key between cells (mint + violet bind) */
  lock: boolean;
  /** catalysis between organisms (sky-blue makes rose spin) */
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
  short: boolean;
  debug: boolean;
  /** duration of the Explore phase */
  exploreMs: number;
  /** were these values given explicitly in the URL? (seed is random otherwise) */
  seedFromUrl: boolean;
}

// =====================================================================================================
// TUNE: the app's defaults. Each can be overridden for one run in the URL (see README "URL parameters").
//   mechanisms on/off ... laws, same, lock, catalysis (similar: see parseConfig, `levels(q.get('similar'))`)
//   movement ........... move, wander
//   size bands ......... org, herd
//   starting world ..... free, herds, lone
// Strengths and exact pairs are in src/sim/world.ts: DYNAMICS, PAIR_RULES and P.
// =====================================================================================================
export const DEFAULTS = {
  hier: true,
  size: 'proxy' as SizeMode,
  skin: 'biology' as Skin,
  eps: 0.05,
  move: true,
  laws: false,
  wander: 1,
  reveal: true,
  lock: true,
  catalysis: true,
  org: [5, 8] as [number, number],
  herd: [3, 7] as [number, number],
  free: 140,
  herds: 7,
  lone: 18,
  same: false,
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

export function parseConfig(search: string, randomSeed: () => number = () => Math.floor(Math.random() * 1e9)): Config {
  const q = new URLSearchParams(search);
  const size = q.get('size') === 'irrelevant' ? 'irrelevant' : DEFAULTS.size;
  const skin = q.get('skin') === 'abstract' ? 'abstract' : DEFAULTS.skin;
  const seedRaw = q.get('seed');
  const seedNum = seedRaw === null ? NaN : Number(seedRaw);
  const seedFromUrl = Number.isFinite(seedNum);
  const epsNum = Number(q.get('eps'));
  const short = bool(q.get('short'), false);
  return {
    hier: bool(q.get('hier'), DEFAULTS.hier),
    size,
    skin,
    seed: seedFromUrl ? Math.floor(seedNum) >>> 0 : randomSeed(),
    eps: q.get('eps') !== null && Number.isFinite(epsNum) ? Math.min(1, Math.max(0, epsNum)) : DEFAULTS.eps,
    move: bool(q.get('move'), DEFAULTS.move),
    laws: bool(q.get('laws'), DEFAULTS.laws),
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
    short,
    debug: bool(q.get('debug'), false),
    exploreMs: short ? DEFAULTS.shortExploreMs : DEFAULTS.exploreMs,
    seedFromUrl,
  };
}

export function simConfigOf(c: Pick<Config, 'hier' | 'eps' | 'seed'> & Partial<Config>): SimConfig {
  const dyn: Dynamics = { lock: c.lock ?? DEFAULTS.lock, catalysis: c.catalysis ?? DEFAULTS.catalysis, similar: c.similar ?? [false, false, false] };
  return { hier: c.hier, eps: c.eps, seed: c.seed, move: c.move ?? true, laws: c.laws ?? true, wander: c.wander ?? DEFAULTS.wander, dyn, org: c.org ?? DEFAULTS.org, herd: c.herd ?? DEFAULTS.herd, free: c.free ?? DEFAULTS.free, herds: c.herds ?? DEFAULTS.herds, lone: c.lone ?? DEFAULTS.lone, sameAttract: c.same ?? true };
}
