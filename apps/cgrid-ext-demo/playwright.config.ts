import { defineConfig } from '@playwright/test';

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
});
