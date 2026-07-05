import { test, expect, type Page } from '@playwright/test';

/**
 * Grid Layouts — Phase A / Unit A6 E2E.
 *
 * Drives the demo's Layouts control (real DOM chrome — `#layout-select` +
 * Save/Delete/Export/Import) and asserts view state through the live
 * `window.__cgapi` (the grid renders to <canvas>, so sort/layout state is
 * read via the API, not the DOM). Each test starts from a clean
 * `persistState` slate (localStorage key `cgrid:state:customizer-demo`) so a
 * prior test's saved layout can't leak into the next.
 */

const STORAGE_KEY = 'cgrid:state:customizer-demo';

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, {
    timeout: 10_000,
  });
}

function api(page: Page) {
  return {
    getSortModel: () => page.evaluate(() => (window as any).__cgapi.getSortModel()),
    setSortModel: (m: unknown) => page.evaluate((model) => (window as any).__cgapi.setSortModel(model), m),
    activeLayoutName: () =>
      page.evaluate(() => {
        const g = (window as any).__cgapi;
        return g.getLayouts().find((l: any) => l.id === g.getActiveLayoutId()).name;
      }),
  };
}

/** Save the current view as a layout, answering the native name prompt. */
async function saveLayout(page: Page, name: string): Promise<void> {
  page.once('dialog', (dialog) => dialog.accept(name));
  await page.getByTestId('layout-save').click();
  // The switcher re-syncs on `layoutChanged`.
  await expect(page.getByTestId('layout-select')).toContainText(name);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await waitForGridReady(page);
});

test('saves a layout and round-trips its view when switching', async ({ page }) => {
  const cg = api(page);
  const select = page.getByTestId('layout-select');
  const del = page.getByTestId('layout-delete');

  // Default: no sort, and Default can't be deleted.
  expect(await cg.getSortModel()).toEqual([]);
  await expect(del).toBeDisabled();

  // Change the view, then save it as a named layout — it becomes active.
  await cg.setSortModel([{ colId: 'ticker', sort: 'asc' }]);
  await saveLayout(page, 'Blotter');
  expect(await cg.activeLayoutName()).toBe('Blotter');
  await expect(del).toBeEnabled();

  // Switch to Default → the sort clears (Default's view).
  await select.selectOption({ label: 'Default' });
  expect(await cg.getSortModel()).toEqual([]);
  await expect(del).toBeDisabled();

  // Switch back to Blotter → its sort is restored.
  await select.selectOption({ label: 'Blotter' });
  expect(await cg.getSortModel()).toEqual([{ colId: 'ticker', sort: 'asc' }]);
});

test('persists layouts across a reload', async ({ page }) => {
  const cg = api(page);
  await cg.setSortModel([{ colId: 'ticker', sort: 'asc' }]);
  await saveLayout(page, 'Blotter');

  // Give the debounced autosave a beat, then reload the same gridId.
  await page.waitForTimeout(700);
  await page.reload();
  await waitForGridReady(page);

  // The persisted layout survives, is active, and its view is restored.
  await expect(page.getByTestId('layout-select')).toContainText('Blotter');
  expect(await cg.activeLayoutName()).toBe('Blotter');
  expect(await cg.getSortModel()).toEqual([{ colId: 'ticker', sort: 'asc' }]);
});
