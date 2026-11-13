// Pure display layout (no Pixi import, so it is unit-testable).
// Maps every live entity to an on-screen circle in world coordinates.
// Display = physical: position = sim position, radius = natural radius (size always tracks level).

import { type Entity, type WorldState, ancestors, naturalRadius } from '../sim/world';

export interface DisplayNode {
  id: number;
  x: number;
  y: number;
  r: number;
  /** factor applied to this entity's members' sim offsets (and their radii) */
  scale: number;
}

export type Layout = (DisplayNode | undefined)[];

export function computeLayout(s: WorldState): Layout {
  const out: Layout = new Array(s.entities.length);
  const place = (e: Entity, x: number, y: number, r: number) => {
    const nat = naturalRadius(s, e);
    const scale = r / nat;
    out[e.id] = { id: e.id, x, y, r, scale };
    for (const cid of e.children) {
      const c = s.entities[cid];
      place(c, x + (c.x - e.x) * scale, y + (c.y - e.y) * scale, naturalRadius(s, c) * scale);
    }
  };
  for (const e of s.entities) {
    if (!e.alive || e.parent >= 0) continue;
    place(e, e.x, e.y, naturalRadius(s, e));
  }
  return out;
}

/** Convert a display-space point to the sim-space position for entity `id`'s centre. */
export function displayToSim(s: WorldState, layout: Layout, id: number, px: number, py: number): [number, number] {
  const e = s.entities[id];
  if (e.parent < 0) return [px, py];
  const p = s.entities[e.parent];
  const pn = layout[p.id];
  if (!pn) return [px, py];
  return [p.x + (px - pn.x) / pn.scale, p.y + (py - pn.y) / pn.scale];
}

/**
 * Entities under a world-space point, deepest first, followed by its ancestors.
 * Picks the lowest tier that has a hit (nearest centre wins), then walks up.
 */
export function hitChain(s: WorldState, layout: Layout, wx: number, wy: number, minR: number): number[] {
  const best = [-1, -1, -1];
  const bestD = [Infinity, Infinity, Infinity];
  for (const n of layout) {
    if (!n) continue;
    const d = Math.hypot(n.x - wx, n.y - wy);
    if (d > Math.max(n.r, minR)) continue;
    const t = s.entities[n.id].tier;
    if (d < bestD[t]) {
      bestD[t] = d;
      best[t] = n.id;
    }
  }
  const deepest = best.find((id) => id >= 0);
  if (deepest === undefined) return [];
  const chain = [deepest];
  let p = s.entities[deepest].parent;
  while (p >= 0) {
    chain.push(p);
    p = s.entities[p].parent;
  }
  return chain;
}

/**
 * The hit chain participants can act on. composition=no (`compose: false`): only the whole thing, never a part,
 * so a click selects it, "click again" has nothing above it and parts can't be dragged out.
 */
export function actionableChain(s: WorldState, chain: number[]): number[] {
  return s.config.compose === false && chain.length > 1 ? [chain[chain.length - 1]] : chain;
}

/** Top-level ancestor (or itself, if free-standing) of each live id. Used to open composites on hover. */
export function openRoots(s: WorldState, ids: readonly number[]): Set<number> {
  const out = new Set<number>();
  for (const id of ids) {
    if (id < 0 || !s.entities[id]?.alive) continue;
    const up = ancestors(s, id);
    out.add(up.length ? up[up.length - 1] : id);
  }
  return out;
}
