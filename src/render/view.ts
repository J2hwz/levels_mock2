// The viewing window: participants see the world through a fixed-size window in the middle of the stage; everything
// around it is blurred. The arrow keys scroll the world under the window. Pure (no DOM, no Pixi), so it is
// unit-testable. The window is not world state: it only filters input and annotates the log.

import { P, type SimEvent, type WorldState } from '../sim/world';
import type { Layout } from './layout';

// TUNE: the viewing window. Every participant sees the same patch of world (w × h world units) at the same
// on-screen size (zoom px per world unit), whatever their screen; only a screen too small for it shrinks it.
export const VIEW = {
  w: 940, // TUNE: window width, world units (the world is P.worldW = 2400 wide)
  h: 624, // TUNE: window height, world units (the world is P.worldH = 1600 high)
  zoom: 0.85, // TUNE: screen px per world unit at full size (≈ 800 × 530 px with the values above)
  peek: 0.3, // TUNE: how visible the surround is, 0..1: 0 = hidden, 1 = no blur or dimming (still look-only)
  blurPx: 10, // TUNE: blur of the surround at peek 0, screen px (scaled by 1 − peek)
  margin: 24, // TUNE: least surround on each side before the window shrinks to fit, screen px
  speed: 450, // TUNE: arrow-key scroll speed, world units / s
};

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Screen px per world unit on a stage of this size: VIEW.zoom, or less if the window would not fit. */
export function viewZoom(stageW: number, stageH: number): number {
  const fit = Math.min((stageW - 2 * VIEW.margin) / VIEW.w, (stageH - 2 * VIEW.margin) / VIEW.h);
  return Math.max(0.05, Math.min(VIEW.zoom, fit));
}

/** Clamp a window centre so the whole window stays inside the world. */
export function clampCentre(x: number, y: number): [number, number] {
  const cx = Math.min(P.worldW - VIEW.w / 2, Math.max(VIEW.w / 2, x));
  const cy = Math.min(P.worldH - VIEW.h / 2, Math.max(VIEW.h / 2, y));
  return [cx, cy];
}

/** The window around a centre: top-left corner and size, world units. */
export function viewRect(cx: number, cy: number): ViewRect {
  return { x: cx - VIEW.w / 2, y: cy - VIEW.h / 2, w: VIEW.w, h: VIEW.h };
}

export function inRect(r: ViewRect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Does a circle (centre x, y, radius rad) overlap the window? */
export function overlapsView(r: ViewRect, x: number, y: number, rad: number): boolean {
  const dx = x - Math.min(r.x + r.w, Math.max(r.x, x));
  const dy = y - Math.min(r.y + r.h, Math.max(r.y, y));
  return dx * dx + dy * dy <= rad * rad;
}

/** Clamp a point into the window (a dragged thing's centre can't leave it). */
export function clampToView(r: ViewRect, x: number, y: number): [number, number] {
  return [Math.min(r.x + r.w, Math.max(r.x, x)), Math.min(r.y + r.h, Math.max(r.y, y))];
}

/** The things an event is about (for an event that removed things, their last positions). */
function eventIds(ev: SimEvent): number[] {
  switch (ev.kind) {
    case 'encounter':
      return [ev.a, ev.b];
    case 'organism_death':
    case 'herd_dissolved':
    case 'swapped':
    case 'founded':
      return [ev.id];
    case 'removed':
      return ev.ids;
    case 'region_depleted':
      return [];
  }
}

/**
 * Did this event happen in the window: does any thing it involves overlap it? Uses the drawn position and radius
 * when there is one (layout of the last frame), else the sim position.
 */
export function eventInView(s: WorldState, layout: Layout, ev: SimEvent, r: ViewRect): boolean {
  if (ev.kind === 'region_depleted') {
    const g = s.regions[ev.index];
    return !!g && overlapsView(r, g.x, g.y, g.r);
  }
  return eventIds(ev).some((id) => {
    const e = s.entities[id];
    if (!e) return false;
    const n = layout[id];
    return n ? overlapsView(r, n.x, n.y, n.r) : inRect(r, e.x, e.y);
  });
}

/**
 * Alive things whose drawn centre is in the window, by level and colour: [cells[4], organisms[4], herds[4]].
 * Parts inside a whole count too.
 */
export function viewCounts(s: WorldState, layout: Layout, r: ViewRect): number[][] {
  const out = [0, 1, 2].map(() => new Array<number>(P.nCellTypes).fill(0));
  for (const e of s.entities) {
    if (!e.alive) continue;
    const n = layout[e.id];
    const [x, y] = n ? [n.x, n.y] : [e.x, e.y];
    if (inRect(r, x, y)) out[e.tier][e.type]++;
  }
  return out;
}
