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

// I4 — spec §6 behavioral proofs (beyond the template-flag checks above):
// the kernel surfaces these three settings actually gate/decorate, not just
// that the own-template write lands. `dailyPnl` / `pnl` / `currentPrice` are
// used here (instead of `notionalAmount` / `yield` / `spread` above) because
// they're unconditionally-visible leaves at the default viewport/scroll
// position — no column-group-open or horizontal-scroll choreography needed
// to reach their header/floating-filter DOM.

test('filter type Set opens the real set-filter popup from the header', async ({ page }) => {
  await selectCol(page, 'dailyPnl');
  await openPanel(page);
  await row(page, 'filter').locator('button[data-v="set"]').click();
  expect(await ownFlag(page, 'dailyPnl', 'filter')).toBe('set');
  await page.keyboard.press('Escape');
  await expect(page.locator('.cgext-menu.cgext-col')).toHaveCount(0);

  // Same expand-button entry point cycle7-setFilter.spec.ts drives — proves
  // the popover's `filter:'set'` write actually changes what the kernel's
  // floating-filter overlay renders, not just the stored template value.
  await page.locator('button[data-cg-floating-filter-expand][data-cg-col-id="dailyPnl"]').click();
  await expect(page.locator('.cg-filter-popup-set')).toBeVisible();
});

test('groupable off rejects the column at the row-group panel; groupable on accepts it', async ({ page }) => {
  await selectCol(page, 'pnl');
  await openPanel(page);
  await row(page, 'enableRowGroup').locator('.cgext-col-switch').click(); // default false -> true
  expect(await ownFlag(page, 'pnl', 'enableRowGroup')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cgext-menu.cgext-col')).toHaveCount(0);

  // `commitRowGroupPanelDrop` is the exact verb the row-group panel's own
  // drag-drop feature calls on a real drop (columnDrag.ts) — a real
  // behavioral proof, not a proxy for the template flag.
  const accepted = await page.evaluate(() => (window as any).__ext.grid.commitRowGroupPanelDrop('pnl'));
  expect(accepted).toBe(true);
  expect(await page.evaluate(() => (window as any).__ext.grid.getRowGroupColumns())).toContain('pnl');
  await page.evaluate(() => (window as any).__ext.grid.removeRowGroupColumn('pnl')); // undo the group before flipping the flag

  await openPanel(page);
  await row(page, 'enableRowGroup').locator('.cgext-col-switch').click(); // true -> false
  expect(await ownFlag(page, 'pnl', 'enableRowGroup')).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cgext-menu.cgext-col')).toHaveCount(0);

  const rejected = await page.evaluate(() => (window as any).__ext.grid.commitRowGroupPanelDrop('pnl'));
  expect(rejected).toBe(false);
  expect(await page.evaluate(() => (window as any).__ext.grid.getRowGroupColumns())).not.toContain('pnl');
});

// `pnl` carries a STATIC `aggFunc: 'sum'` in its colDef (apps/cgrid-ext-demo/
// src/main.ts), so its header decorates with `sum(P&L)` from first paint —
// unlike columns whose aggFunc is added purely at runtime via the ribbon's
// Σ pill (`addValueColumn`/`setValueColumnAggFunc`, routed through
// `pivotEngine`/`PivotState`'s `valueColumns` list). That runtime list never
// feeds back into `ResolvedColDef.aggFunc` (no call site in cgrid.ts patches
// columnDefsMap from a `valueColumns` change), and `decorateHeader`
// (kernel/src/renderer/painters/byRows.ts) reads `def.aggFunc` off the
// resolved colDef — so toggling the pill on a column with no static
// `aggFunc` (e.g. `currentPrice`) never changes its painted header at all
// (confirmed empirically: a before/after screenshot around such a toggle is
// pixel-identical). That's a pre-existing kernel-level gap between the
// Cycle 14 header-decoration feature and the Cycle 18/19 pivot value-column
// APIs, orthogonal to this ribbon feature — this test instead proves the
// part that IS wired: `suppressAggFuncInHeader` toggling the painted
// decoration for a column whose `aggFunc` already reaches the resolved def.
test('Show-in-header off hides the sum(...) header caption; back on restores it', async ({ page }) => {
  await selectCol(page, 'pnl');
  // The popover's "Show in header" switch is disabled unless the column is
  // registered in `getValueColumns()` (the runtime value-columns list) —
  // `pnl` has a static `aggFunc` but was never explicitly added via the
  // pill/API, so register it (its already-decorated header is unaffected:
  // `setValueColumnAggFunc` doesn't touch the resolved colDef either).
  await page.locator('[data-col="agg"]').click();
  await page.locator('.cgext-menu-item', { hasText: /^sum$/ }).click();
  await page.waitForTimeout(200);

  const clip = await page.evaluate(() => {
    const g = (window as any).__ext.grid;
    const b = g.getHeaderBoundsAt('pnl');
    const canvas = document.querySelector('canvas') as HTMLElement;
    const r = canvas.getBoundingClientRect();
    return { x: r.left + b.x, y: r.top + b.y, width: b.w, height: b.h };
  });

  // No canvas-text accessor exists (headers paint straight to canvas, no
  // DOM/aria mirror) — a bounded screenshot diff of the header cell is the
  // available behavioral proof that the decoration actually painted/
  // unpainted, since decorateHeader (byRows.ts) only runs at paint time.
  const shown = await page.screenshot({ clip }); // "sum(P&L)" from first paint

  await openPanel(page);
  await row(page, 'aggHeader').locator('.cgext-col-switch').click(); // Show-in-header off
  expect(await ownFlag(page, 'pnl', 'suppressAggFuncInHeader')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cgext-menu.cgext-col')).toHaveCount(0);
  await page.waitForTimeout(200);
  const suppressed = await page.screenshot({ clip });
  expect(suppressed.equals(shown)).toBe(false); // caption disappears -> plain "P&L"

  await openPanel(page);
  await row(page, 'aggHeader').locator('.cgext-col-switch').click(); // Show-in-header back on
  expect(await ownFlag(page, 'pnl', 'suppressAggFuncInHeader')).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cgext-menu.cgext-col')).toHaveCount(0);
  await page.waitForTimeout(200);
  const restored = await page.screenshot({ clip });
  expect(restored.equals(shown)).toBe(true); // caption reappears identically
  expect(restored.equals(suppressed)).toBe(false);
});
