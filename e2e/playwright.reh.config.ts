/**
 * Playwright config for R6: password login + REH cookie proxy (zcode serve).
 * Requires dist/server REH artifact from R2c. Default PR e2e uses playwright.config.ts.
 */
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.ZCODE_E2E_REH_PORT ?? process.env.ZCODE_E2E_PORT ?? 15020);
const password = process.env.ZCODE_E2E_PASSWORD ?? 'zcode-e2e';
const baseURL = `http://127.0.0.1:${port}`;
const repoRoot = path.resolve(__dirname, '..');
const workspace = process.env.ZCODE_E2E_WORKSPACE ?? path.join(repoRoot, 'e2e', '.reh-workspace');

export default defineConfig({
  testDir: './tests',
  testMatch: '**/reh-terminal.spec.ts',
  timeout: 240_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    // serve (not web): cookie login + optional REH spawn when dist/server exists
    command: `mkdir -p "${workspace}" && node apps/cli/dist/cli.js serve "${workspace}" --port ${port} --password ${password} --host 127.0.0.1`,
    url: `${baseURL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    cwd: repoRoot,
    env: {
      ...process.env,
      ZCODE_PASSWORD: password,
      // Prefer artifact when present; do not force broken dev-script spawn
      ZCODE_SPAWN_REH: process.env.ZCODE_SPAWN_REH ?? '1',
    },
  },
});
