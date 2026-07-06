import { test, expect, type Page } from '@playwright/test';

/**
 * Perspective look & feel — Foundation smoke.
 *
 * The demo defaults to `cg-theme-perspective-dark`; the theme toggle swaps to
 * the light `cg-theme-perspective`. The grid host carries the theme class;
 * `__cgapi.getThemeKind()` returns the resolved light/dark kind. Each test
 * starts from a clean persistState slate (the theme also persists under
 * `custdemo:theme`, so both keys are cleared).
 */

const STORAGE_KEY = 'cgrid:state:customizer-demo';

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    { timeout: 10_000 },
  );
}

const themeKind = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cgapi: any }).__cgapi.getThemeKind());
/** The active `cg-theme-*` class somewhere in the grid subtree. */
const themeClass = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[class*="cg-theme-perspective"]');
    return el ? [...el.classList].find((c) => c.startsWith('cg-theme-')) ?? null : null;
  });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => {
    localStorage.removeItem(key);
    localStorage.setItem('custdemo:theme', 'dark'); // deterministic dark start
  }, STORAGE_KEY);
  await page.reload();
  await waitForGridReady(page);
});

test('demo mounts with cg-theme-perspective-dark (kind: dark)', async ({ page }) => {
  expect(await themeClass(page)).toBe('cg-theme-perspective-dark');
  expect(await themeKind(page)).toBe('dark');
});

test('theme toggle swaps to the light cg-theme-perspective (kind: light)', async ({ page }) => {
  await page.getByTestId('btn-theme').click(); // "Light theme"
  await expect.poll(() => themeClass(page)).toBe('cg-theme-perspective');
  expect(await themeKind(page)).toBe('light');
});
