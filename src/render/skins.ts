// Skins change rendering only, never the simulation.

import type { Skin } from '../config';

export type Glyph = 'circle' | 'triangle' | 'square' | 'star' | 'hexagon';

export interface SkinDef {
  bg: number;
  /** per cell type */
  cell: number[];
  cellNames: string[];
  nucleus: Glyph[];
  glyph: Glyph[];
  /** per species: membrane colour */
  species: number[];
  speciesNames: string[];
  /** per herd kind: boundary colour */
  herd: number[];
  herdNames: string[];
  /** low end of health bars and the flash ring (stressed cells darken instead of changing colour) */
  stress: number;
  cellAlpha: number;
  membraneFill: number;
  membraneStroke: number;
  herdFill: number;
  herdStroke: number;
  wobble: number;
  ui: number;
  health: number;
  healthBg: number;
  text: string;
}

export const SKINS: Record<Skin, SkinDef> = {
  biology: {
    bg: 0x081218,
    // four colours at every level: light blue, purple, red, green. Only cells carry a shape.
    cell: [0x7fd6ff, 0xb68cff, 0xff5c5c, 0x6fdc7a],
    cellNames: ['light blue', 'purple', 'red', 'green'],
    nucleus: ['circle', 'triangle', 'square', 'star'],
    glyph: ['circle', 'circle', 'circle', 'circle'],
    species: [0x5cc4f5, 0xa073f5, 0xf04a4a, 0x52c965],
    speciesNames: ['light blue', 'purple', 'red', 'green'],
    herd: [0xa8e4ff, 0xd2b8ff, 0xff9c9c, 0xa6ecb0],
    herdNames: ['light blue', 'purple', 'red', 'green'],
    stress: 0xff3b30,
    cellAlpha: 0.75,
    membraneFill: 0.14,
    membraneStroke: 0.7,
    herdFill: 0.05,
    herdStroke: 0.35,
    wobble: 0.07,
    ui: 0xffffff,
    health: 0x7dffb0,
    healthBg: 0x22313a,
    text: '#d6f5ff',
  },
  abstract: {
    bg: 0xf3f3ef,
    // the same four colours, deeper for the light background
    cell: [0x2b9bd8, 0x7b4fc9, 0xd63b3b, 0x2e9e4a],
    cellNames: ['light blue', 'purple', 'red', 'green'],
    nucleus: ['circle', 'circle', 'circle', 'circle'],
    glyph: ['circle', 'triangle', 'square', 'star'],
    species: [0x2b9bd8, 0x7b4fc9, 0xd63b3b, 0x2e9e4a],
    speciesNames: ['light blue', 'purple', 'red', 'green'],
    herd: [0x2b9bd8, 0x7b4fc9, 0xd63b3b, 0x2e9e4a],
    herdNames: ['light blue', 'purple', 'red', 'green'],
    stress: 0xff7f0e,
    cellAlpha: 1,
    membraneFill: 0.08,
    membraneStroke: 1,
    herdFill: 0.03,
    herdStroke: 0.7,
    wobble: 0,
    ui: 0x000000,
    health: 0x2ca02c,
    healthBg: 0xcccccc,
    text: '#222222',
  },
};

export function lerpColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (s: number) => {
    const x = (a >> s) & 0xff;
    const y = (b >> s) & 0xff;
    return Math.round(x + (y - x) * k) << s;
  };
  return ch(16) | ch(8) | ch(0);
}

export function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}
