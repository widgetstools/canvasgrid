/**
 * Same as playwright.config.ts but pointing at an alternate dev-server
 * port — for machines where 5175 is occupied by an unrelated server.
 * Usage: npx vite --port 5176 & npx playwright test --config=playwright.alt-port.config.ts
 */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    baseURL: process.env.CGRID_E2E_BASE_URL ?? 'http://localhost:5176',
  },
});
