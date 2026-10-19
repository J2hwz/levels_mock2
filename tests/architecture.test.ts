import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SIM_DIR = join(__dirname, '..', 'src', 'sim');

function imports(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

describe('architecture', () => {
  const files = readdirSync(SIM_DIR).filter((f) => f.endsWith('.ts'));

  it('sim/ has files', () => {
    expect(files).toEqual(expect.arrayContaining(['rng.ts', 'world.ts', 'hash.ts']));
  });

  it.each(files)('sim/%s imports only from sim/', (f) => {
    const src = readFileSync(join(SIM_DIR, f), 'utf8');
    for (const spec of imports(src)) {
      expect(spec, `${f} imports ${spec}`).toMatch(/^\.\/[\w-]+$/);
      expect(spec).not.toMatch(/pixi|jspsych|render|ui|experiment/i);
    }
  });

  // These are not required to be correctly rounded, so engines differ in the last bit
  // and a browser log would not replay in Node. Use sim/dmath.ts instead.
  it.each(files)('sim/%s uses only cross-engine deterministic math', (f) => {
    const code = readFileSync(join(SIM_DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/);
    expect(code).not.toMatch(/\*\*/);
  });

  it.each(files)('sim/%s does not touch the DOM or wall-clock randomness', (f) => {
    const src = readFileSync(join(SIM_DIR, f), 'utf8');
    expect(src).not.toMatch(/\b(window|document|performance|Date\.now|Math\.random)\b/);
  });
});
