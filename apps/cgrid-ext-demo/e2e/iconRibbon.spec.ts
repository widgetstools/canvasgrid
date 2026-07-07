import { test, expect } from '@playwright/test';

// Icons ribbon section — drives the picker end-to-end and asserts through
// the kernel's public template surface (canvas rendering is covered by
// kernel unit tests; e2e verifies the toolbar → editColumn → template
// pipeline plus visual smoke via screenshot).
//
// Focus gate: the grid is fed by the live STOMP snapshot, so we first wait
// for rows, then click a body cell (single canvas; body rows start well
// below the ~150px group-header + floating-filter band, and we avoid the
// pinned first column whose floating-filter buttons overlay the canvas).
// The picker button flips from disabled→enabled the instant the toolbar
// resolves a target column, so its `enabled` state is the reliable
// "a cell is focused" signal (the ribbon has several `.cgext-rb-pill`
// nodes — e.g. the Smart "Set…" button — so a `.first()` pill match is not
// the selection pill).
test('icons section: prefix icon, corner decorator, header emoji, clear', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.cgext-grid canvas').first()).toBeVisible();

  // Wait for the STOMP snapshot to populate the grid.
  await page.waitForFunction(() => {
    const g = (window as any).__ext?.grid;
    try { return (g?.getDisplayedRowCount?.() ?? 0) > 0; } catch { return false; }
  }, { timeout: 20000 });

  const openBtn = page.locator('[data-ip="open"]');
  const search = page.locator('[data-ip="search"]');

  // Focus a data cell so the toolbar resolves the target column.
  await page.locator('.cgext-grid canvas').first().click({ position: { x: 400, y: 180 } });
  await expect(openBtn).toBeEnabled();

  const ownTemplate = () => page.evaluate(() =>
    (window as any).__ext.grid.getTemplates().find((t: any) => t.id.startsWith('__cgridOwn:'))?.overrides);

  // 1. Prefix (default placement) — pick the flame icon.
  await openBtn.click();
  await expect(page.locator('.cgext-ip-panel')).toBeVisible();
  await search.fill('flame');
  await page.locator('.cgext-ip-tile[data-icon="flame"]').click();
  let ov = await ownTemplate();
  expect(ov.cellIcon).toMatchObject({ name: 'flame', position: 'leading' });

  // 2. Top-right decorator — emoji. (Reset the picker's search first: the
  // filter DETACHES non-matching tiles and persists across opens, so the
  // stale 'flame' query would hide every emoji tile.)
  await page.locator('[data-ip="place"]').click();
  await page.locator('[data-place="tr"]').click();
  await openBtn.click();
  await search.fill('');
  await page.locator('.cgext-ip-tile[data-emoji="⚠️"]').click();
  ov = await ownTemplate();
  expect(ov.cellStyle.decorators).toEqual([{ position: 'tr', kind: 'emoji', value: '⚠️' }]);

  // 3. Header target + suffix emoji → headerIcon.
  await page.locator('button[title="Style headers"]').click();
  await page.locator('[data-ip="place"]').click();
  await page.locator('[data-place="suffix"]').click();
  await openBtn.click();
  await search.fill('');
  await page.locator('.cgext-ip-tile[data-emoji="🔥"]').click();
  ov = await ownTemplate();
  expect(ov.headerIcon).toMatchObject({ emoji: '🔥', position: 'trailing' });

  // 4. Clear removes exactly the selected slot.
  await page.locator('[data-ip="clear"]').click();
  ov = await ownTemplate();
  expect(ov.headerIcon).toBeUndefined();
  expect(ov.cellIcon).toMatchObject({ name: 'flame' }); // untouched

  // Visual smoke — grid canvas with icons applied.
  await page.screenshot({ path: 'e2e-results/icon-ribbon.png', fullPage: false });
});
