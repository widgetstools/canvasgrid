import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  webServer: {
    command: 'npm run dev -- --port 5176',
    url: 'http://localhost:5176',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://localhost:5176',
    headless: true,
    // Wide enough that every leaf column stays in the DOM even with every
    // group expanded. AG-Grid virtualizes columns horizontally; with all 7
    // groups open, the grid's content width is ~3.2k px. A narrower viewport
    // leaves far-right columns (e.g. grp-risk's grossExp/cr01/delta) entirely
    // absent from the DOM (not just off-screen) until scrolled, which this
    // spec does not do.
    viewport: { width: 3400, height: 900 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
