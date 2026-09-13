import { defineConfig } from '@playwright/test';

/**
 * Root e2e for the demo apps.
 *
 * Lives at the root (not per-app) because the demos share one browser setup.
 *
 * SERVERS: the self-contained demos start themselves, via `webServer` below.
 * Everything they need is in this repo, so `npx playwright test` just works and
 * so does CI. The provider demos (:5210 / :5211) are NOT started here — they
 * need the STOMP fixture (`npm run dev:stomp-ssrm-provider`) and a broker port,
 * which makes them a different kind of job. Run those specs locally with the
 * fixture up; `--grep-invert` in the CI job keeps them out of the gate rather
 * than leaving the whole suite red and therefore ignored.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1500, height: 900 },
    screenshot: 'only-on-failure',
  },
  /**
   * Only the demos that need nothing but this repo. Each waits on its own port,
   * and `reuseExistingServer` keeps a dev loop from fighting the runner for it.
   */
  webServer: [
    {
      command: 'npm run dev:tree',
      url: 'http://localhost:5230/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:master-detail',
      url: 'http://localhost:5240/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:dshub',
      url: 'http://localhost:5250/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
