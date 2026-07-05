import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5187',
    headless: true,
    // Height fits the FULL Column Groups panel node list (plus the grid's
    // intrinsic toolbar strip) so raw-coordinate drags never target
    // scrolled-out rows — same idea as apps/colgroups widening to 3400px.
    viewport: { width: 1400, height: 1400 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5187',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
