import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Per-test budget. Bumped from 30s → 60s because the demo defaults
  // to a 20k row snapshot + 10k updates/sec; `gridReady` (waiting for
  // `firstDataRendered`) routinely takes 30-45s on a dev laptop under
  // that load.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5175',
    headless: true,
    viewport: { width: 1400, height: 900 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // Tests assume the dev server is already running. Don't fork another one.
});
