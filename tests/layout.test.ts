import { describe, expect, it } from 'vitest';
import { actionableChain, computeLayout, hitChain, openRoots } from '../src/render/layout';
import { Camera } from '../src/render/camera';
import { VIEW, clampCentre, clampToView, eventInView, overlapsView, viewCounts, viewRect, viewZoom } from '../src/render/view';
import { P, createWorld } from '../src/sim/world';
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

describe('viewing window (fixed size, arrow keys, look only outside)', () => {
  it('the zoom is VIEW.zoom on a big stage and shrinks only so the window fits a small one', () => {
    expect(viewZoom(4000, 3000)).toBe(VIEW.zoom);
    const small = viewZoom(600, 400);
    expect(small).toBeLessThan(VIEW.zoom);
    expect(VIEW.w * small).toBeLessThanOrEqual(600 - 2 * VIEW.margin + 1e-9);
    expect(VIEW.h * small).toBeLessThanOrEqual(400 - 2 * VIEW.margin + 1e-9);
  });

  it('the window never leaves the world', () => {
    for (const [x, y] of [[-500, -500], [P.worldW + 900, 50], [P.worldW / 2, P.worldH * 3]]) {
      const r = viewRect(...clampCentre(x, y));
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(P.worldW);
      expect(r.y + r.h).toBeLessThanOrEqual(P.worldH);
    }
    const cam = new Camera();
    cam.setView(1400, 900);
    cam.moveBy(-1e4, 1e4);
    expect(cam.state()).toMatchObject({ x: 0, y: P.worldH - VIEW.h, w: VIEW.w, h: VIEW.h });
    expect(cam.zoom).toBe(VIEW.zoom);
  });

  it('circle overlap and clamping at the window edges', () => {
    const r = { x: 100, y: 100, w: 200, h: 100 };
    expect(overlapsView(r, 150, 150, 1)).toBe(true); // inside
    expect(overlapsView(r, 95, 150, 6)).toBe(true); // straddles the left edge
    expect(overlapsView(r, 90, 150, 6)).toBe(false); // just outside
    expect(overlapsView(r, 96, 96, 6)).toBe(true); // near the corner: 5.66 from it
    expect(overlapsView(r, 95, 95, 6)).toBe(false); // 7.07 from the corner
    expect(clampToView(r, 0, 500)).toEqual([100, 200]);
  });

  it('events are in view when any thing they involve overlaps the window', () => {
    const s = createWorld({ hier: false, eps: 0, seed: 3 });
    const layout = computeLayout(s);
    const cells = s.entities.filter((e) => e.alive);
    const r = viewRect(...clampCentre(P.worldW / 2, P.worldH / 2));
    const inside = cells.find((e) => e.x > r.x + 50 && e.x < r.x + r.w - 50 && e.y > r.y + 50 && e.y < r.y + r.h - 50)!;
    const far = cells.filter((e) => e.x < r.x - 100 || e.x > r.x + r.w + 100);
    const enc = (a: number, b: number) => ({ kind: 'encounter' as const, rule: 'lock' as const, tier: 0 as const, tierB: 0 as const, a, b, ok: true });
    expect(eventInView(s, layout, enc(inside.id, far[0].id), r)).toBe(true);
    expect(eventInView(s, layout, enc(far[0].id, far[1].id), r)).toBe(false);
    expect(eventInView(s, layout, { kind: 'removed', id: far[0].id, tier: 0, ids: [far[0].id, inside.id] }, r)).toBe(true);
  });

  it('per-window counts match a hand count by level and colour', () => {
    const s = createWorld({ hier: true, eps: 0.05, seed: 42 });
    const layout = computeLayout(s);
    const r = viewRect(...clampCentre(700, 600));
    const counts = viewCounts(s, layout, r);
    const hand = [0, 1, 2].map((t) => [0, 1, 2, 3].map((k) =>
      s.entities.filter((e) => e.alive && e.tier === t && e.type === k && layout[e.id]!.x >= r.x && layout[e.id]!.x <= r.x + r.w && layout[e.id]!.y >= r.y && layout[e.id]!.y <= r.y + r.h).length));
    expect(counts).toEqual(hand);
    expect(counts.flat().reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
