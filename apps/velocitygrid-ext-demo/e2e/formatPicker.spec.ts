import { test, expect, type Page } from '@playwright/test';

// Format picker E2E — real kernel + calc/format engines, persistState on.
// Boot storage-clean per test: goto → clear → reload (addInitScript would
// also wipe on in-test reloads, breaking the persistence assertion).
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.vgext-titlebar')).toBeVisible();
});

// The pill has no per-control `data-item-id` hook — the ribbon is a single
// registered ToolbarItem (id 'ribbon'), so `[data-item-id="ribbon"]` covers
// the ENTIRE band, not just this button (that locator would resolve to the
// whole-band container and click its bounding-box centre, missing the pill).
// `# Format`'s caption always starts with '# ' (see ribbon.ts's `# ${label}`
// caption template) and it is the only `.vgext-rb-pill` with that prefix, so
// this is the one stable, unique locator.
const pill = (page: Page) => page.locator('.vgext-rb-pill', { hasText: /# / }).first();
const panel = (page: Page) => page.locator('.vgext-menu.vgext-fmt');

/** Select a single-cell range in the given column so targetCols() resolves
 *  (ranges win over focus in the toolbar's target resolution). This is what
 *  a real cell click does; `setFocusedCell(rowId, colId)` alone does NOT —
 *  it only updates the selection model's focus pointer and never fires
 *  `cellSelectionChanged` (the only event the ribbon's `refresh()` listens
 *  for besides a never-emitted `cellFocused`), so the pill would stay
 *  disabled forever. Clearing first keeps a single target column across
 *  repeated calls in the same test. */
async function focusColumn(page: Page, colId: string): Promise<void> {
  await page.evaluate((c) => {
    const g = (window as any).__ext.grid;
    g.clearCellRanges();
    g.addCellRange({ rowStart: 0, rowEnd: 0, colIds: [c] });
  }, colId);
}

/** The column's own-template format (undefined when none). */
async function ownFormat(page: Page, colId: string): Promise<string | undefined> {
  return page.evaluate((c) => {
    const g = (window as any).__ext.grid;
    const own = g.getTemplates().find((t: any) => t.id === `__cgridOwn:${c}`);
    return own?.overrides?.format;
  }, colId);
}

test('preset apply → own template + CURRENT chip + caption; persists across reload', async ({ page }) => {
  await focusColumn(page, 'notionalAmount');
  await pill(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.vgext-fmt-tab[data-cat="number"] .vgext-fmt-count')).toHaveText('6');

  await panel(page).locator('.vgext-fmt-row[data-preset-id="num-2dp"]').click();
  await expect(panel(page)).not.toBeVisible(); // apply closes
  expect(await ownFormat(page, 'notionalAmount')).toBe('#,##0.00');
  await expect(pill(page)).toContainText('# 2 decimals');

  // Reopen: CURRENT chip previews, active row highlighted.
  await pill(page).click();
  await expect(panel(page).locator('.vgext-fmt-current-chip')).toHaveText('1,234.57');
  await expect(panel(page).locator('.vgext-fmt-row[data-preset-id="num-2dp"]')).toHaveClass(/is-active/);
  await page.keyboard.press('Escape');

  // Persistence: wait for the debounced autosave, then reload.
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? '').includes('#,##0.00')));
  await page.reload();
  await expect(page.locator('.vgext-titlebar')).toBeVisible();
  // The own template is restored asynchronously from the profile snapshot
  // (same pattern as iconRibbon.spec.ts) — wait for it to reappear before
  // asserting, rather than racing the restore.
  await page.waitForFunction(() => {
    const t = (window as any).__ext?.grid?.getTemplates?.()
      ?.find((t: any) => t.id === '__cgridOwn:notionalAmount');
    return t?.overrides?.format === '#,##0.00';
  }, { timeout: 20000 });
  expect(await ownFormat(page, 'notionalAmount')).toBe('#,##0.00');
});

test('tick preset renders on the price column; clear removes it', async ({ page }) => {
  await focusColumn(page, 'currentPrice');
  await pill(page).click();
  await panel(page).locator('.vgext-fmt-tab[data-cat="tick"]').click();
  await expect(panel(page).locator('.vgext-fmt-row[data-preset-id="tick-32"] .vgext-fmt-row-preview')).toHaveText('101-16');
  await panel(page).locator('.vgext-fmt-row[data-preset-id="tick-32"]').click();
  expect(await ownFormat(page, 'currentPrice')).toBe('TICK32');

  await pill(page).click();
  await panel(page).locator('.vgext-fmt-clear').click();
  expect(await ownFormat(page, 'currentPrice')).toBeUndefined();
  await expect(panel(page).locator('.vgext-fmt-current-chip')).toHaveText('—');
});

test('custom format via input; search; text column rail', async ({ page }) => {
  await focusColumn(page, 'notionalAmount');
  await pill(page).click();

  // Search flips to flat results.
  await panel(page).locator('.vgext-fmt-search input').fill('parens');
  await expect(panel(page).locator('.vgext-fmt-tabs')).toHaveCount(0);
  await expect(panel(page).locator('.vgext-fmt-row').first()).toBeVisible();
  await panel(page).locator('.vgext-fmt-search input').fill('');

  // Custom tab: type + apply.
  await panel(page).locator('.vgext-fmt-tab[data-cat="__custom__"]').click();
  const input = panel(page).locator('.vgext-fmt-custom-input input');
  await input.fill('#,##0.000');
  await panel(page).locator('.vgext-fmt-custom-apply').click();
  expect(await ownFormat(page, 'notionalAmount')).toBe('#,##0.000');
  await expect(pill(page)).toContainText('#,##0.000');

  // Text column shows the text rail with the ƒ(x) presets. Apply lowercase
  // and assert the PAINTED cell text actually changed (a template-only
  // assertion previously masked cellAt's text branch skipping formatters).
  await focusColumn(page, 'ticker');
  await pill(page).click();
  await expect(panel(page).locator('.vgext-fmt-tab[data-cat="text"] .vgext-fmt-count')).toHaveText('9');
  await panel(page).locator('.vgext-fmt-row[data-preset-id="str-lower"]').click();
  expect(await ownFormat(page, 'ticker')).toBe('=LOWER([value])');
  await page.waitForFunction(() => {
    const g = (window as any).__ext.grid;
    if ((g.getDisplayedRowCount?.() ?? 0) === 0) return false;
    const cell = g.cellAt?.(0, 'ticker');
    return !!cell && cell.valueFormatted === String(cell.value).toLowerCase()
      && cell.valueFormatted !== String(cell.value);
  }, { timeout: 20000 });
});
