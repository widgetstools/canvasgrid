import { defineConfig } from '@playwright/test';

/**
 * Root e2e for the demo apps.
 *
 * Lives at the root (not per-app) because the two provider demos are the only
 * apps left and both need the same browser setup. Servers are NOT started
 * here — run `npm run dev:csrm-provider` / `dev:ssrm-provider` first, or use
 * `npm run verify:demos` for a boot-only check.
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
});
