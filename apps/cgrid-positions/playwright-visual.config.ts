import { defineConfig } from '@playwright/test';

// Cycle 12 / Task 4 — visual-regression harness. Pinned to one browser, one
// viewport, one DPR so the only legitimate cause of a diff is a real layout
// or paint regression. The functional Playwright suite (`./playwright.config.ts`)
// stays unchanged.
export default defineConfig({
  testDir: './e2e-visual',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.005,
      threshold: 0.2,
      animations: 'disabled',
    },
  },
  forbidOnly: !!process.env.CI,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:5175',
    headless: true,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
