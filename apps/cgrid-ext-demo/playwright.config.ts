import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:5188' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5188',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      // Default project — every spec, dpr 1 (unchanged behavior).
      name: 'chromium',
    },
    {
      // Closeout fix wave (I5 / C1) — re-runs ONLY the pixel-invariance
      // harness's main scripted-step test at `deviceScaleFactor: 2`. C1
      // (the scroll-blit destination double-scale) only reproduces under
      // a dpr≠1 backing store — every other arm ran at Playwright's
      // default dpr 1, which is exactly why it shipped unnoticed. Scoped
      // via `testMatch` + `grep` (not the whole suite) so this doesn't
      // double the runtime of unrelated specs; the `@dpr-locked` tag on
      // the target test's title is the grep anchor.
      name: 'chromium-dpr2',
      testMatch: /paintInvariance\.spec\.ts/,
      grep: /@dpr-locked/,
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 2 },
    },
  ],
});
