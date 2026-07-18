import { test, expect, type Page } from '@playwright/test';

// Layouts toolbar E2E — drives the title-bar dropdown against the real
// kernel layout engine with persistState on. Each test boots storage-clean:
// goto → clear localStorage → reload (an addInitScript clear would also wipe
// storage on in-test reloads, breaking the persistence test).
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
});

const trigger = (page: Page) => page.locator('[data-item-id="layouts"] button.cgext-layouts-trigger');
const panel = (page: Page) => page.locator('.cgext-menu.cgext-layouts');
const row = (page: Page, id: string) => panel(page).locator(`.cgext-layouts-row[data-layout-id="${id}"]`);
const disk = (page: Page) => page.locator('[data-item-id="layout-save"] button');

async function saveNewLayout(page: Page, name: string): Promise<void> {
  await panel(page).locator('.cgext-layouts-new input').fill(name);
  await panel(page).locator('.cgext-layouts-savenew').click();
  await expect(trigger(page)).toContainText(name);
}

/** The saved-layout row's kernel-minted id (the non-default active row). */
async function activeLayoutId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__ext.grid.getActiveLayoutId());
}

test('save new layout; ui change dirties the disk; update + switch round-trips the view', async ({ page }) => {
  const baseRowHeight = await page.evaluate(() => (window as any).__ext.grid.getGridOption('rowHeight'));

  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('1');
  await saveNewLayout(page, 'Layout 1');
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('2');
  const l1 = await activeLayoutId(page);
  await expect(row(page, l1)).toHaveClass(/is-active/);

  // A runtime option swap is a 'ui'-source stateUpdated → disk dirties.
  await expect(disk(page)).toBeDisabled();
  await page.evaluate(() => (window as any).__ext.grid.setGridOption('rowHeight', 44));
  await expect(disk(page)).toBeEnabled();
  await disk(page).click(); // outside the panel — also closes it
  await expect(disk(page)).toBeDisabled();

  // Switch to Default → baseline height; back → the layout's 44 returns.
  // Selecting a row closes the panel, so each switch reopens the dropdown.
  await trigger(page).click();
  await row(page, 'default').click();
  await expect(panel(page)).not.toBeVisible(); // selection dismisses the dropdown
  expect(await page.evaluate(() => (window as any).__ext.grid.getGridOption('rowHeight'))).toBe(baseRowHeight);
  await expect(disk(page)).toBeDisabled(); // loadLayout's state apply must not re-dirty
  await trigger(page).click();
  await row(page, l1).click();
  await expect(panel(page)).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__ext.grid.getGridOption('rowHeight'))).toBe(44);
  await expect(trigger(page)).toContainText('Layout 1');
});

test('rename, duplicate, delete; Default is locked', async ({ page }) => {
  await trigger(page).click();
  await saveNewLayout(page, 'Alpha');
  const alpha = await activeLayoutId(page);

  // Rename the active row (actions are always visible on it).
  await row(page, alpha).locator('[data-act="rename"]').click();
  const rename = panel(page).locator('input.cgext-layouts-rename');
  await rename.fill('Beta');
  await rename.press('Enter');
  await expect(row(page, alpha).locator('.cgext-layouts-name')).toHaveText('Beta');
  await expect(trigger(page)).toContainText('Beta');

  // Duplicate → "Beta copy" appears, NOT active (kernel duplicate doesn't activate).
  await row(page, alpha).locator('[data-act="duplicate"]').click();
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('3');
  const copyRow = panel(page).locator('.cgext-layouts-row', { hasText: 'Beta copy' });
  await expect(copyRow).toBeVisible();
  await expect(copyRow).not.toHaveClass(/is-active/);
  await expect(trigger(page)).toContainText('Beta');

  // Delete the copy (hover reveals its actions).
  await copyRow.hover();
  await copyRow.locator('[data-act="delete"]').click();
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('2');

  // Default: locked — no rename/delete, lock badge present.
  await row(page, 'default').hover();
  await expect(row(page, 'default').locator('.cgext-layouts-lock')).toBeVisible();
  await expect(row(page, 'default').locator('[data-act="rename"]')).toHaveCount(0);
  await expect(row(page, 'default').locator('[data-act="delete"]')).toHaveCount(0);
});

test('bundle export → delete → import restores the layout', async ({ page }) => {
  await trigger(page).click();
  await saveNewLayout(page, 'Keeper');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel(page).locator('.cgext-layouts-export').click(),
  ]);
  // 'ext-demo-layouts.json' when getGridOption('gridId') resolves; the
  // 'grid-layouts.json' fallback is also acceptable — assert the stable suffix.
  expect(download.suggestedFilename()).toMatch(/-layouts\.json$/);
  const bundlePath = await download.path();

  const keeper = await activeLayoutId(page);
  await row(page, keeper).locator('[data-act="delete"]').click();
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('1');

  await panel(page).locator('.cgext-layouts-foot input[type=file]').setInputFiles(bundlePath!);
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('2');
  await expect(panel(page).locator('.cgext-layouts-row', { hasText: 'Keeper' })).toBeVisible();
});

test('layouts persist across reload', async ({ page }) => {
  await trigger(page).click();
  await saveNewLayout(page, 'Persist');
  // Kernel autosave is debounced — wait for the blob to actually carry the layout.
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? '').includes('Persist')));
  await page.reload();
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
  await expect(trigger(page)).toContainText('Persist'); // layoutChanged 'restore' repainted the trigger
  await trigger(page).click();
  await expect(panel(page).locator('.cgext-layouts-count')).toHaveText('2');
});
