import { describe, expect, it } from 'vitest';
import { computeLayout, hitChain, nominalRadius } from '../src/render/layout';
import { createWorld, step } from '../src/sim/world';

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
function topLevelCorrelation(mode: 'proxy' | 'irrelevant'): number {
  const r: number[] = [];
  const t: number[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const s = createWorld({ hier: true, eps: 0.05, seed });
    const layout = computeLayout(s, mode);
    for (const e of s.entities) {
      if (!e.alive || e.parent >= 0) continue;
      r.push(layout[e.id]!.r);
      t.push(e.tier);
    }
  }
  return pearson(r, t);
}

describe('size dial', () => {
  it('size=irrelevant: on-screen radius of free-standing entities is uncorrelated with tier', () => {
    expect(Math.abs(topLevelCorrelation('irrelevant'))).toBeLessThan(0.1);
  });

  it('size=irrelevant: the per-entity radius draw is uncorrelated with tier over ALL entities', () => {
    const r: number[] = [];
    const t: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const s = createWorld({ hier: true, eps: 0.05, seed });
      for (const e of s.entities) {
        r.push(nominalRadius(seed, e.id));
        t.push(e.tier);
      }
    }
    expect(Math.abs(pearson(r, t))).toBeLessThan(0.1);
  });

  it('size=proxy: radius is strongly correlated with tier (sanity check that the test has teeth)', () => {
    expect(topLevelCorrelation('proxy')).toBeGreaterThan(0.7);
  });

  it('size=irrelevant: members are drawn inside their parent', () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 3 });
    for (let i = 0; i < 60; i++) step(s, []);
    const layout = computeLayout(s, 'irrelevant');
    for (const e of s.entities) {
      if (!e.alive || e.parent < 0) continue;
      const n = layout[e.id]!;
      const p = layout[e.parent]!;
      expect(Math.hypot(n.x - p.x, n.y - p.y) + n.r).toBeLessThan(p.r * 1.35);
    }
  });
});

describe('hit testing', () => {
  it('clicking a cell inside a herd returns cell -> organism -> herd', () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42 });
    const layout = computeLayout(s, 'proxy');
    const cell = s.entities.find((e) => e.tier === 0 && e.parent >= 0 && s.entities[e.parent].parent >= 0)!;
    const chain = hitChain(s, layout, cell.x, cell.y, 2);
    expect(chain[0]).toBe(cell.id);
    expect(chain.map((id) => s.entities[id].tier)).toEqual([0, 1, 2]);
  });
});
