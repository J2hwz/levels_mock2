import { describe, expect, it } from 'vitest';
import { actionableChain, computeLayout, hitChain, openRoots } from '../src/render/layout';
import { createWorld } from '../src/sim/world';

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
