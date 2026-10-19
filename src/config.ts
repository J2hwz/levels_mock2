// All experiment dials + URL-param parsing.
// ?hier=1|0&size=proxy|irrelevant&skin=biology|abstract&seed=42&eps=0.05&short=1&debug=1

import type { SimConfig } from './sim/world';

export type SizeMode = 'proxy' | 'irrelevant';
export type Skin = 'biology' | 'abstract';

export interface Config {
  hier: boolean;
  size: SizeMode;
  skin: Skin;
  seed: number;
  eps: number;
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
  exploreMs: 6 * 60 * 1000,
  shortExploreMs: 60 * 1000,
};

function bool(v: string | null, dflt: boolean): boolean {
  if (v === null) return dflt;
  return v === '1' || v.toLowerCase() === 'true';
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
    short,
    debug: bool(q.get('debug'), false),
    exploreMs: short ? DEFAULTS.shortExploreMs : DEFAULTS.exploreMs,
    seedFromUrl,
  };
}

export function simConfigOf(c: Pick<Config, 'hier' | 'eps' | 'seed'>): SimConfig {
  return { hier: c.hier, eps: c.eps, seed: c.seed };
}
