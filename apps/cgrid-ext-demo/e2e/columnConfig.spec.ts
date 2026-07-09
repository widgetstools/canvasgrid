import { test, expect, type Page } from '@playwright/test';

// Ribbon Column group E2E — the ⚙ popover (filter/grouping/aggregation/
// behavior sections), the live Σ agg pill + menu, and the quick floating-
// filter/groupable/agg-header toggle buttons. Real kernel + calc engine,
// persistState on; boots storage-clean per test (goto → clear → reload —
// same idiom as formatPicker.spec.ts / layoutsToolbar.spec.ts).
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
});

const openPanel = async (page: Page) => {
  await page.locator('[data-col="open"]').click();
  await expect(page.locator('.cgext-menu.cgext-col')).toBeVisible();
};
const row = (page: Page, k: string) => page.locator(`.cgext-col-row[data-k="${k}"]`);

// Select a single-cell range in the given column so `targetCols()` resolves
// (ranges win over focus in the ribbon's target resolution — see
// formatPicker.spec.ts's `focusColumn`). `SelectionRange` uses `rowStart`/
// `rowEnd` (kernel/src/types/column.ts), not `rowStartIndex`/`rowEndIndex`.
const selectCol = (page: Page, colId: string) => page.evaluate((c) => {
  const g = (window as any).__ext.grid;
  g.clearCellRanges();
  g.addCellRange({ rowStart: 0, rowEnd: 0, colIds: [c] });
}, colId);

const ownFlag = (page: Page, colId: string, key: string) => page.evaluate(([c, k]) => {
  const own = (window as any).__ext.grid.getTemplates().find((t: any) => t.id === `__cgridOwn:${c}`);
  return own?.overrides?.[k];
}, [colId, key] as [string, string]);

// Behavioral proof, not just the template flag: the kernel's floating-filter
// overlay (packages/kernel/src/interaction/floatingFilterOverlay.ts) pools
// one `<input class="cg-floating-filter-input" data-cg-col-id>` per column
// that has EVER been visible and never removes it — a column opting out just
// hides its wrapper cell (`display:none`) so IME/autocomplete state survives
// scroll-out/in. That means the input's OWN `getComputedStyle(...).display`
// never changes (CSS `display` isn't inherited from a hidden ancestor) and
// even `document.querySelectorAll(...).length` never drops. `offsetParent`
// IS affected by an ancestor's `display:none` (null when the element or any
// ancestor is hidden), so it's the right per-input visibility signal here.
const ffVisibleCount = (page: Page) => page.evaluate(() =>
  Array.from(document.querySelectorAll('.cg-floating-filter-input'))
    .filter((el) => (el as HTMLElement).offsetParent !== null).length);

test('popover flags: floating filter + set filter + groupable write templates; persists across reload', async ({ page }) => {
  await selectCol(page, 'notionalAmount');
  await openPanel(page);

  const before = await ffVisibleCount(page);
  await row(page, 'floatingFilter').locator('.cgext-col-switch').click();
  expect(await ownFlag(page, 'notionalAmount', 'floatingFilter')).toBe(false); // demo default is on
  await page.waitForFunction((n) => Array.from(document.querySelectorAll('.cg-floating-filter-input'))
    .filter((el) => (el as HTMLElement).offsetParent !== null).length < n, before);

  await row(page, 'filter').locator('button[data-v="set"]').click();
  expect(await ownFlag(page, 'notionalAmount', 'filter')).toBe('set');

  await row(page, 'enableRowGroup').locator('.cgext-col-switch').click();
  expect(await ownFlag(page, 'notionalAmount', 'enableRowGroup')).toBe(true);
  await page.keyboard.press('Escape');

  await page.waitForFunction(() =>
    Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? '').includes('enableRowGroup')));
  await page.reload();
  await expect(page.locator('.cgext-titlebar')).toBeVisible();
  await page.waitForFunction(() => {
    const own = (window as any).__ext.grid.getTemplates?.()
      ?.find((t: any) => t.id === '__cgridOwn:notionalAmount');
    return own?.overrides?.enableRowGroup === true;
  }, { timeout: 20000 });
  expect(await ownFlag(page, 'notionalAmount', 'filter')).toBe('set');
});

test('aggregation: pill sets sum, popover switches header visibility, none removes', async ({ page }) => {
  await selectCol(page, 'yield');
  const agg = () => page.evaluate(() =>
    (window as any).__ext.grid.getValueColumns().find((v: any) => v.colId === 'yield')?.aggFunc);
  await page.locator('[data-col="agg"]').click();
  await page.locator('.cgext-menu-item', { hasText: /^sum$/ }).click();
  expect(await agg()).toBe('sum');
  await expect(page.locator('[data-col="agg"]')).toContainText('Σ sum');

  await openPanel(page);
  await row(page, 'aggHeader').locator('.cgext-col-switch').click();
  expect(await ownFlag(page, 'yield', 'suppressAggFuncInHeader')).toBe(true);
  await page.keyboard.press('Escape');

  await page.locator('[data-col="agg"]').click();
  await page.locator('.cgext-menu-item', { hasText: /^None$/ }).click();
  expect(await agg()).toBeUndefined();
});

test('quick toggles + pinned + hidden behave and reflect state', async ({ page }) => {
  await selectCol(page, 'spread');
  const ff = page.locator('[data-col="ff"]');
  await ff.click();
  expect(await ownFlag(page, 'spread', 'floatingFilter')).toBe(false);
  await expect(ff).not.toHaveClass(/is-on/);
  await ff.click();
  expect(await ownFlag(page, 'spread', 'floatingFilter')).toBe(true);

  await openPanel(page);
  await row(page, 'pinned').locator('button[data-v="left"]').click();
  const pinned = await page.evaluate(() =>
    (window as any).__ext.grid.getColumnState().find((s: any) => s.colId === 'spread')?.pinned);
  expect(pinned).toBe('left');
  await row(page, 'pinned').locator('button[data-v="none"]').click();
  await row(page, 'hide').locator('.cgext-col-switch').click();
  expect(await ownFlag(page, 'spread', 'hide')).toBe(true);
  await row(page, 'hide').locator('.cgext-col-switch').click(); // restore
});
