import { defineConfig } from '@playwright/test';

// Cycle 21f — visual-regression harness for the renderer showcase pages,
// mirroring apps/cgrid-positions/playwright-visual.config.ts (Cycle 12 /
// Task 4): pinned to one browser, one viewport, one DPR so the only
// legitimate cause of a diff is a real layout or paint regression. A
// SEPARATE config/project from `./playwright.config.ts` (the 148-test
// functional suite) so `npx playwright test` with no args stays at 148 —
// this suite only runs via `npm run test:visual` /
// `playwright test --config=playwright-visual.config.ts`.
export default defineConfig({
  testDir: './e2e-visual',
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
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
    baseURL: 'http://localhost:5185',
    headless: true,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    // The showcase's light/dark split is driven entirely by an in-app
    // `#theme-toggle` click (CSS class + kernel `setTheme`), not the OS
    // `prefers-color-scheme` media feature, so this has no effect on what
    // renders — set for parity with the positions harness only.
    colorScheme: 'dark',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5185',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
