import { test, expect, type Page } from '@playwright/test';

/**
 * Grid Layouts — Phase B / Unit B5 E2E (styling templates).
 *
 * Drives the demo's Templates control (real DOM chrome — Apply $ / Edit Yield /
 * Calc col) and asserts through the live `window.__cgapi` (public template API)
 * + `window.__cgcalc` (the calc engine's read accessors — assignments +
 * calc-column defs, which the canvas can't reveal). Each test starts from a
 * clean `persistState` slate so a prior test's templates can't leak.
 */

const STORAGE_KEY = 'cgrid:state:customizer-demo';

async function waitForGridReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true, {
    timeout: 10_000,
  });
}

const templateIds = (page: Page) =>
  page.evaluate(() => (window as any).__cgapi.getTemplates().map((t: any) => t.id).sort());
const overridesFor = (page: Page, colId: string) =>
  page.evaluate((id) => (window as any).__cgcalc.getOverrides().find((o: any) => o.colId === id) ?? null, colId);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await waitForGridReady(page);
});

test('Apply $ saves one template and reuses it across two columns', async ({ page }) => {
  expect(await templateIds(page)).toEqual([]);
  await expect(page.getByTestId('tpl-count')).toHaveText('0 templates');

  await page.getByTestId('tpl-apply').click();

  // One template in the library…
  expect(await templateIds(page)).toEqual(['money']);
  await expect(page.getByTestId('tpl-count')).toHaveText('1 template');
  // …reused across BOTH columns (same id, not copied).
  expect((await overridesFor(page, 'notionalAmount')).templateIds).toEqual(['money']);
  expect((await overridesFor(page, 'marketValue')).templateIds).toEqual(['money']);
});

test('Edit Yield auto-creates the column’s own template', async ({ page }) => {
  await page.getByTestId('tpl-edit').click();

  // An own template appears in the library and is assigned to the column.
  expect(await templateIds(page)).toEqual(['__cgridOwn:yield']);
  expect((await overridesFor(page, 'yield')).templateIds).toEqual(['__cgridOwn:yield']);
  await expect(page.getByTestId('tpl-count')).toHaveText('1 template');
});

test('Calc col adds a calculated column styled by the $ template that stays non-editable', async ({ page }) => {
  await page.getByTestId('tpl-calc').click();

  // The calculated column exists and carries the $ template assignment…
  const calcCols = await page.evaluate(() =>
    (window as any).__cgcalc.listCalculatedColumns().map((c: any) => c.colId));
  expect(calcCols).toContain('pnlBps');
  expect((await overridesFor(page, 'pnlBps')).templateIds).toEqual(['money']);

  // …and its synthesized colDef is forced non-editable (calc columns never edit).
  const editable = await page.evaluate(() =>
    (window as any).__cgcalc.synthesizedColDefs().find((d: any) => d.colId === 'pnlBps')?.editable);
  expect(editable).toBe(false);
});

test('templates ride in a saved layout and survive a switch away and back', async ({ page }) => {
  await page.getByTestId('tpl-apply').click();
  expect((await overridesFor(page, 'notionalAmount')).templateIds).toEqual(['money']);

  // Save the styled view as a layout, then switch to Default (which has no
  // assignments) — the assignment must clear (B5 module-slice clearing)…
  page.once('dialog', (d) => d.accept('Styled'));
  await page.getByTestId('layout-save').click();
  await expect(page.getByTestId('layout-select')).toContainText('Styled');

  await page.getByTestId('layout-select').selectOption({ label: 'Default' });
  expect(await overridesFor(page, 'notionalAmount')).toBeNull(); // cleared on switch

  // …and restore when switching back.
  await page.getByTestId('layout-select').selectOption({ label: 'Styled' });
  expect((await overridesFor(page, 'notionalAmount')).templateIds).toEqual(['money']);
});
