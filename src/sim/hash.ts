import type { WorldState } from './world';

// Stable hash of the world state: two independent FNV-1a 32-bit lanes over the
// exact float64 bytes of every field, in a fixed order. Returns 16 hex chars.

const buf = new DataView(new ArrayBuffer(8));

class Hasher {
  a = 0x811c9dc5;
  b = 0x01000193 ^ 0x5bd1e995;
  num(x: number): void {
    buf.setFloat64(0, x, true);
    for (let i = 0; i < 8; i++) {
      const byte = buf.getUint8(i);
      this.a = Math.imul(this.a ^ byte, 0x01000193);
      this.b = Math.imul(this.b ^ byte, 0x01000193) ^ (this.b >>> 13);
    }
  }
  hex(): string {
    return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0');
  }
}

export function hashWorld(s: WorldState): string {
  const h = new Hasher();
  h.num(s.tick);
  h.num(s.rng.s);
  h.num(s.nextId);
  h.num(s.isolated);
  h.num(s.drag ? s.drag.id : -1);
  h.num(s.drag ? s.drag.x : 0);
  h.num(s.drag ? s.drag.y : 0);
  for (const e of s.entities) {
    h.num(e.id);
    h.num(e.alive ? 1 : 0);
    if (!e.alive) continue;
    h.num(e.tier);
    h.num(e.type);
    h.num(e.x);
    h.num(e.y);
    h.num(e.vx);
    h.num(e.vy);
    h.num(e.angle);
    h.num(e.parent);
    h.num(e.children.length);
    for (const c of e.children) h.num(c);
    h.num(e.stress);
    h.num(e.signal);
    h.num(e.hormone);
    h.num(e.health);
    h.num(e.density);
    h.num(e.realisation);
    h.num(e.bond);
  }
  for (const r of s.regions) {
    h.num(r.health);
    h.num(r.stress);
  }
  return h.hex();
}
