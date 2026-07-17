import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.ZCODE_E2E_PORT ?? 15010);
const baseURL = `http://127.0.0.1:${port}`;
const repoRoot = path.resolve(__dirname, '..');

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 30_000 },
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
    // Always start from monorepo root so cwd-based asset discovery works.
    command: `node apps/cli/dist/cli.js web --dir apps/web/dist --port ${port}`,
    url: `${baseURL}/git-proxy/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: repoRoot,
  },
});
