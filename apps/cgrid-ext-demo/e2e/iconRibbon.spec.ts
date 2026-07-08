import { test, expect } from '@playwright/test';

// The app persists both kernel state (`cgrid:state:ext-demo`) and ext profiles
// (`cgrid-ext:profiles`) to localStorage, so a leftover profile from a prior
// run would leak icons into this test. Clear storage ONCE — on the very first
// document of this tab — but NOT on the mid-test reload (which must observe the
// saved profile). `window.name` survives same-tab navigations including
// reloads, so it's a reliable "already booted" marker that localStorage.clear()
// itself can't erase.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.name.includes('cg-e2e-icons-booted')) {
      try { localStorage.clear(); } catch { /* storage may be unavailable pre-nav */ }
      window.name = `${window.name} cg-e2e-icons-booted`;
    }
  });
});

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
  // The base flow is ~20s; the added save → reload → restore round-trip needs
  // headroom past the default 30s test budget (restore settles a couple
  // seconds after reload).
  test.setTimeout(60_000);
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

  // 3. Header target + suffix emoji → headerIcon. The single cell↔header
  // target toggle flips Cells → Header on one click.
  await page.locator('.cgext-rb-targettoggle').click();
  await expect(page.locator('.cgext-rb-targettoggle')).toContainText('Header');
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

  // 5. Persistence round-trip — click the layout-save disk (the icon edits
  //    above are a 'ui'-source stateUpdated change, so it's enabled), reload,
  //    and confirm the own template's cellIcon + decorator survive the
  //    localStorage save/restore (cellIcon/headerIcon are NEW override keys
  //    riding the profile pipe; a serialization regression that dropped
  //    unknown keys would pass every in-session assertion above while
  //    losing icons on reload).
  await page.locator('[data-item-id="layout-save"] button').click();
  // Let the debounced persistState autosave (500ms) flush before navigating
  // away — the reload's restore reads the persisted `cgrid:state:ext-demo`.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('.cgext-grid canvas').first()).toBeVisible();
  await page.waitForFunction(() => {
    const g = (window as any).__ext?.grid;
    try { return (g?.getDisplayedRowCount?.() ?? 0) > 0; } catch { return false; }
  }, { timeout: 20000 });

  // The own template is restored asynchronously from the profile snapshot —
  // wait for it to reappear, then assert the icon + decorator persisted.
  await page.waitForFunction(() => {
    const t = (window as any).__ext?.grid?.getTemplates?.()
      ?.find((t: any) => t.id.startsWith('__cgridOwn:'));
    return !!t?.overrides?.cellIcon;
  }, { timeout: 20000 });
  ov = await ownTemplate();
  expect(ov.cellIcon).toMatchObject({ name: 'flame' });
  expect(ov.cellStyle.decorators).toEqual([{ position: 'tr', kind: 'emoji', value: '⚠️' }]);
});
