// Seeded PRNG (mulberry32). The ONLY source of randomness in sim/.
// State lives in a plain object so it can be serialised and hashed with the world.

export interface RngState {
  s: number;
}

export function makeRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Uniform in [0, 1). */
export function rand(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(r: RngState, a: number, b: number): number {
  return a + (b - a) * rand(r);
}

/** Integer in [a, b] inclusive. */
export function randInt(r: RngState, a: number, b: number): number {
  return a + Math.floor(rand(r) * (b - a + 1));
}

/** Approximately standard normal (sum of 4 uniforms, rescaled). Cheap and deterministic. */
export function gauss(r: RngState): number {
  return (rand(r) + rand(r) + rand(r) + rand(r) - 2) * 1.7320508075688772;
}

export function pick<T>(r: RngState, xs: readonly T[]): T {
  return xs[Math.floor(rand(r) * xs.length)];
}

/** Stateless hash of (seed, salt) to [0,1). Used for things that must not consume the sim stream. */
export function hash01(seed: number, salt: number): number {
  const r = makeRng((Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca77)) >>> 0);
  rand(r);
  return rand(r);
}
