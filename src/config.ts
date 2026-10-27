// All experiment dials + URL-param parsing.
// ?hier=1|0&size=proxy|irrelevant&skin=biology|abstract&seed=42&eps=0.05&move=1|0&reveal=1|0
//  &lock=0,1,2|all&catalysis=...&similar=...&org=5-8&herd=3-7&free=120&short=1&debug=1

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
  /** composites show only their colour; their contents appear while hovered */
  reveal: boolean;
  /** same-level dynamics, per level [cells, organisms, herds] */
  lock: boolean[];
  catalysis: boolean[];
  similar: boolean[];
  /** composite size band [min, unstable): outside it a composite drains and falls apart */
  org: [number, number];
  herd: [number, number];
  /** loose cells floating around at the start */
  free: number;
  short: boolean;
  debug: boolean;
  /** duration of the Explore phase */
  exploreMs: number;
  /** were these values given explicitly in the URL? (seed is random otherwise) */
  seedFromUrl: boolean;
}

export const DEFAULTS = {
  hier: true,
  size: 'proxy' as SizeMode,
  skin: 'biology' as Skin,
  eps: 0.05,
  move: true,
  reveal: true,
  org: [5, 8] as [number, number],
  herd: [3, 7] as [number, number],
  free: 120,
  exploreMs: 6 * 60 * 1000,
  shortExploreMs: 60 * 1000,
};

function bool(v: string | null, dflt: boolean): boolean {
  if (v === null) return dflt;
  return v === '1' || v.toLowerCase() === 'true';
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
    reveal: bool(q.get('reveal'), DEFAULTS.reveal),
    lock: levels(q.get('lock')),
    catalysis: levels(q.get('catalysis')),
    similar: levels(q.get('similar')),
    org: band(q.get('org'), DEFAULTS.org),
    herd: band(q.get('herd'), DEFAULTS.herd),
    free: q.get('free') !== null && Number.isFinite(Number(q.get('free'))) ? Math.min(600, Math.max(0, Math.floor(Number(q.get('free'))))) : DEFAULTS.free,
    short,
    debug: bool(q.get('debug'), false),
    exploreMs: short ? DEFAULTS.shortExploreMs : DEFAULTS.exploreMs,
    seedFromUrl,
  };
}

export function simConfigOf(c: Pick<Config, 'hier' | 'eps' | 'seed'> & Partial<Config>): SimConfig {
  const dyn: Dynamics = { lock: c.lock ?? [false, false, false], catalysis: c.catalysis ?? [false, false, false], similar: c.similar ?? [false, false, false] };
  return { hier: c.hier, eps: c.eps, seed: c.seed, move: c.move ?? true, dyn, org: c.org ?? DEFAULTS.org, herd: c.herd ?? DEFAULTS.herd, free: c.free ?? DEFAULTS.free };
}
