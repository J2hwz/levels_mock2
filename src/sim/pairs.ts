// Drawn size-pair chances (README "Drawn size-pair chances"): six whole numbers that add up to `total`, each in [0, L],
// with every such split equally likely, dealt at random to the six size pairs. A number is that pair's chance per
// encounter in percent. Pure and deterministic: its own seeded stream, never the world's.

import { makeRng, rand, type RngState } from './rng';

/** the six size pairs, in the order the numbers are stored: cell-cell, org-org, herd-herd, cell-org, cell-herd, org-herd */
export const PAIR_ORDER = ['cc', 'oo', 'hh', 'co', 'ch', 'oh'] as const;

export interface PairChances {
  /** whole percentages per pair, in PAIR_ORDER */
  lock: readonly number[];
  catalysis: readonly number[];
}

/** index into PAIR_ORDER of the unordered size pair (ta, tb), sizes 0 cells, 1 organisms, 2 herds */
export function pairIndex(ta: number, tb: number): number {
  if (ta === tb) return ta;
  const lo = Math.min(ta, tb);
  const hi = Math.max(ta, tb);
  return lo === 0 ? (hi === 1 ? 3 : 4) : 5;
}

/**
 * N(k, s): ways to split s into k whole numbers, each 0..L. Returned as a table n[k][s] for k <= parts, s <= total.
 * For 6 parts and totals up to 600 the counts stay far below 2^53, so doubles are exact.
 */
export function countSplits(parts: number, total: number, L: number): number[][] {
  const n: number[][] = [Array.from({ length: total + 1 }, (_, s) => (s === 0 ? 1 : 0))];
  for (let k = 1; k <= parts; k++) {
    const row = new Array<number>(total + 1).fill(0);
    for (let s = 0; s <= total; s++) {
      let sum = 0;
      for (let v = 0; v <= Math.min(L, s); v++) sum += n[k - 1][s - v];
      row[s] = sum;
    }
    n.push(row);
  }
  return n;
}

/**
 * Step 1: six numbers adding up to `total`, drawn one at a time. y_k = v has weight N(m, R_k - v) / N(m + 1, R_k)
 * (m = numbers still to come), so every valid split is equally likely and nothing is thrown away. The last is forced.
 * Requires 0 <= total <= 6 L.
 */
export function drawSix(r: RngState, total: number, L: number): number[] {
  const parts = 6;
  const n = countSplits(parts, total, L);
  const ys: number[] = [];
  let R = total;
  for (let k = 0; k < parts - 1; k++) {
    const m = parts - 1 - k;
    const lo = Math.max(0, R - L * m);
    const hi = Math.min(L, R);
    let u = rand(r) * n[m + 1][R];
    let v = lo;
    for (; v < hi; v++) {
      u -= n[m][R - v];
      if (u < 0) break;
    }
    ys.push(v);
    R -= v;
  }
  ys.push(R);
  return ys;
}

/** Step 2: deal the numbers to the six pairs by a random ordering (Fisher-Yates). */
export function deal(r: RngState, ys: readonly number[]): number[] {
  const xs = ys.slice();
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand(r) * (i + 1));
    const t = xs[i];
    xs[i] = xs[j];
    xs[j] = t;
  }
  return xs;
}

/** salt for the pair-chance stream (independent of the world's stream and of `cross`) */
const PAIRS_SALT = 0x9a125;

/** Independent draws for lock & key and catalysis from the seed: the same seed always gives the same matrices. */
export function drawPairChances(seed: number, total: number, L: number): PairChances {
  const r = makeRng((Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(PAIRS_SALT, 0x85ebca77)) >>> 0);
  rand(r);
  const lock = deal(r, drawSix(r, total, L));
  const catalysis = deal(r, drawSix(r, total, L));
  return { lock, catalysis };
}
