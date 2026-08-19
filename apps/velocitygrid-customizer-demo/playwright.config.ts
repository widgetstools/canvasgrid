import { defineConfig } from '@playwright/test';

// Port is overridable via CGRID_DEMO_PORT so the suite can target an
// already-running dev server (e.g. when the default 5187 is taken by
// another worktree/session). Defaults to 5187 — unchanged for CI.
const PORT = process.env.CGRID_DEMO_PORT ?? '5187';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    headless: true,
    // Height fits the FULL Column Groups panel node list (plus the grid's
    // intrinsic toolbar strip) so raw-coordinate drags never target
    // scrolled-out rows — same idea as apps/colgroups widening to 3400px.
    viewport: { width: 1400, height: 1400 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
