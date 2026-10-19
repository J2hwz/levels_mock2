import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';

function gitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.1'),
    __GIT_HASH__: JSON.stringify(gitHash()),
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
