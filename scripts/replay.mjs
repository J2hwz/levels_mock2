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
  const file_ = JSON.parse(readFileSync(file, 'utf8'));
  // the main session, then each generalisation task (each its own world and log)
  const logs = [['main session', file_], ...(file_.generalisation ?? []).map((g) => [`task ${g.header.config.task}`, g])];
  let allOk = true;
  for (const [name, log] of logs) {
    const res = replay(log);
    allOk &&= res.ok;
    console.log(`-- ${name}: seed ${log.header.seed}`);
    console.log(`ticks ${res.finalTick}  hash checks ${res.checkedHashes}  mismatches ${res.mismatches.length}`);
    console.log(`final hash  logged ${res.expectedHash}  replayed ${res.actualHash}`);
    if (res.mismatches.length) console.log('first mismatch:', res.mismatches[0]);
  }
  console.log(allOk ? `OK: replay reproduces the logged state (${logs.length} log${logs.length === 1 ? '' : 's'})` : 'FAIL: replay diverged');
  process.exitCode = allOk ? 0 : 1;
} finally {
  await server.close();
}
