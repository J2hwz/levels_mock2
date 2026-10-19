// Cross-engine deterministic math for sim/.
// Math.sin/cos/hypot/exp/... are NOT guaranteed bit-identical across JS engines or
// engine versions (Chromium 156 vs Node 26 differ in the last ulp), which breaks
// replaying a browser log in Node. These use only + - * / and Math.sqrt/round, which
// IEEE-754 requires to be correctly rounded, so every engine gives the same bits.

const HALF_PI = 1.5707963267948966;

function sinPoly(r: number): number {
  const r2 = r * r;
  return r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 * (1 / 6227020800)))))));
}

function cosPoly(r: number): number {
  const r2 = r * r;
  return 1 + r2 * (-0.5 + r2 * (1 / 24 + r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800 + r2 * (1 / 479001600 + r2 * (-1 / 87178291200)))))));
}

function quadrant(x: number): [number, number] {
  const k = Math.round(x / HALF_PI);
  return [x - k * HALF_PI, ((k % 4) + 4) % 4];
}

export function dsin(x: number): number {
  const [r, q] = quadrant(x);
  return q === 0 ? sinPoly(r) : q === 1 ? cosPoly(r) : q === 2 ? -sinPoly(r) : -cosPoly(r);
}

export function dcos(x: number): number {
  const [r, q] = quadrant(x);
  return q === 0 ? cosPoly(r) : q === 1 ? -sinPoly(r) : q === 2 ? -cosPoly(r) : sinPoly(r);
}

export function dhypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
