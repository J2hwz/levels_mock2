// Verify a downloaded session log: replay its actions through sim/ and compare hashes.
// Usage: npm run replay -- path/to/levels-sandbox-<seed>-<timestamp>.json

import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run replay -- <log.json>');
  process.exit(2);
}
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { replay } = await server.ssrLoadModule('/src/replay.ts');
  const log = JSON.parse(readFileSync(file, 'utf8'));
  const res = replay(log);
  console.log(`seed ${log.header.seed}  config ${JSON.stringify(log.header.config)}`);
  console.log(`ticks ${res.finalTick}  hash checks ${res.checkedHashes}  mismatches ${res.mismatches.length}`);
  console.log(`final hash  logged ${res.expectedHash}  replayed ${res.actualHash}`);
  if (res.mismatches.length) console.log('first mismatch:', res.mismatches[0]);
  console.log(res.ok ? 'OK: replay reproduces the logged state' : 'FAIL: replay diverged');
  process.exitCode = res.ok ? 0 : 1;
} finally {
  await server.close();
}
