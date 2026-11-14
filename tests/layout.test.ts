import { describe, expect, it } from 'vitest';
import { actionableChain, computeLayout, hitChain, openRoots } from '../src/render/layout';
import { createWorld } from '../src/sim/world';
import { PALETTE_SALT, shuffledTokens } from '../src/ui/tokens';

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** radius vs tier over free-standing (top-level) entities, pooled across seeds */
function topLevelCorrelation(): number {
  const r: number[] = [];
  const t: number[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const s = createWorld({ hier: true, eps: 0.05, seed });
    const layout = computeLayout(s);
    for (const e of s.entities) {
      if (!e.alive || e.parent >= 0) continue;
      r.push(layout[e.id]!.r);
      t.push(e.tier);
    }
  }
  return pearson(r, t);
}

describe('size', () => {
  it('on-screen radius of free-standing things is strongly correlated with level', () => {
    expect(topLevelCorrelation()).toBeGreaterThan(0.7);
  });
});

describe('hit testing', () => {
  it('clicking a cell inside a herd returns cell -> organism -> herd', () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42 });
    const layout = computeLayout(s);
    const cell = s.entities.find((e) => e.tier === 0 && e.parent >= 0 && s.entities[e.parent].parent >= 0)!;
    const chain = hitChain(s, layout, cell.x, cell.y, 2);
    expect(chain[0]).toBe(cell.id);
    expect(chain.map((id) => s.entities[id].tier)).toEqual([0, 1, 2]);
    expect(actionableChain(s, chain)).toEqual(chain);
  });

  it('composition=no: the same click only ever reaches the whole herd, never a part', () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42, compose: false });
    const layout = computeLayout(s);
    const cell = s.entities.find((e) => e.tier === 0 && e.parent >= 0 && s.entities[e.parent].parent >= 0)!;
    const chain = actionableChain(s, hitChain(s, layout, cell.x, cell.y, 2));
    expect(chain.map((id) => s.entities[id].tier)).toEqual([2]);
  });
});

describe('reveal on hover', () => {
  it('opens the top-level thing around whatever is hovered', () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42 });
    const herd = s.entities.find((e) => e.tier === 2)!;
    const cell = s.entities[s.entities[herd.children[0]].children[0]];
    const free = s.entities.find((e) => e.tier === 0 && e.parent < 0)!;
    expect([...openRoots(s, [cell.id, free.id, -1])]).toEqual([herd.id, free.id]);
  });
});

describe('palette order (shuffledTokens)', () => {
  const keys = (ts: { tier: number; type: number }[]) => ts.map((t) => `${t.tier}:${t.type}`);

  it('is a permutation of all 12 elements (4 cells in the flat condition)', () => {
    expect(keys(shuffledTokens(42, PALETTE_SALT.report, 3)).sort()).toEqual(keys([0, 1, 2].flatMap((tier) => [0, 1, 2, 3].map((type) => ({ tier, type })))).sort());
    expect(keys(shuffledTokens(42, PALETTE_SALT.lock, 1)).sort()).toEqual(['0:0', '0:1', '0:2', '0:3']);
  });

  it('is reproducible from seed and salt, and differs between palettes and seeds', () => {
    expect(shuffledTokens(42, PALETTE_SALT.report, 3)).toEqual(shuffledTokens(42, PALETTE_SALT.report, 3));
    expect(keys(shuffledTokens(42, PALETTE_SALT.report, 3))).not.toEqual(keys(shuffledTokens(42, PALETTE_SALT.lock, 3)));
    expect(keys(shuffledTokens(42, PALETTE_SALT.lock, 3))).not.toEqual(keys(shuffledTokens(42, PALETTE_SALT.catalysis, 3)));
    expect(keys(shuffledTokens(42, PALETTE_SALT.report, 3))).not.toEqual(keys(shuffledTokens(43, PALETTE_SALT.report, 3)));
  });

  it('puts each element first about 1 time in 12 (1200 seeds) and keeps no size order', () => {
    const first = new Map<string, number>();
    let sizeSorted = 0;
    for (let seed = 1; seed <= 1200; seed++) {
      const order = shuffledTokens(seed, PALETTE_SALT.report, 3);
      const k = keys(order)[0];
      first.set(k, (first.get(k) ?? 0) + 1);
      if (order.every((t, i) => i === 0 || order[i - 1].tier <= t.tier)) sizeSorted++;
    }
    expect(first.size).toBe(12);
    for (const n of first.values()) expect(Math.abs(n / 1200 - 1 / 12)).toBeLessThan(0.04);
    expect(sizeSorted).toBeLessThan(5);
  });
});
