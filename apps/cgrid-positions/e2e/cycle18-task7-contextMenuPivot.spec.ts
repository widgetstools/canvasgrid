/**
 * Cycle 18 / Task 7 — column header context menu pivot items E2E.
 *
 * Behavioural (not smoke). Drives the live positions grid with
 * `?pivotDemo=on&pivotPanel=always` which:
 *   - stamps `enablePivot` on sector / region / desk / currency
 *   - stamps `enableValue` on notionalAmount / marketValue / pnl / quantity
 *   - mounts BOTH the columns tool panel plz/valz zones AND the
 *     top-of-grid pivot panel
 *
 * Verifies the AG-parity Prompt 7 contract: right-click on a header
 * is the keyboard/non-drag route to the same role assignments the
 * drag/checkbox paths offer. Every assertion reads back through
 * `api.getPivotColumns()` / `api.getValueColumns()` to verify the
 * canonical PivotState mutated — not just the DOM chrome.
 *
 * Coverage:
 *   1. "Add to Labels" item appears for `enablePivot` columns.
 *   2. Clicking it adds the column to PivotState + pills appear in
 *      BOTH the sidebar plz zone AND the top-of-grid pivot panel
 *      on the next event tick (THE SYNC INVARIANT across all three
 *      surfaces — the menu being the third view).
 *   3. "Remove from Labels" toggles off + removes the pill from BOTH
 *      other surfaces.
 *   4. "Value: Aggregate" submenu lists the registered agg funcs.
 *   5. Picking an agg adds the column as a value column with that agg
 *      (pill appears in tool panel valz zone).
 *   6. Picking the CURRENT agg toggles the column off.
 *   7. Picking a DIFFERENT agg swaps the aggFunc in place.
 *   8. "Scroll to column" hides under pivotMode === true.
 *   9. Menu pivot items are GATED on enableX — `enablePivot:false`
 *      column doesn't see "Add to Labels".
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';
const MENU_SELECTOR = '.cg-context-menu';
const LABEL_SELECTOR = `${MENU_SELECTOR} .cg-menu-item-label`;

interface GridApiSurface {
  getHeaderBoundsAt: (colId: string) => { x: number; y: number; w: number; h: number } | null;
  ensureColumnVisible: (colId: string) => void;
  getPivotColumns: () => string[];
  getValueColumns: () => Array<{ colId: string; aggFunc: string }>;
  setPivotMode: (mode: boolean) => void;
  isPivotMode: () => boolean;
}

async function waitForFrames(page: Page, n = 8): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = (): void => { if (++i >= count) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }),
    n,
  );
}

async function gridReady(page: Page, qs = '?pivotDemo=on&pivotPanel=always'): Promise<void> {
  await page.goto(`/${qs}`);
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function canvasOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

async function rightClickHeader(page: Page, colId: string): Promise<void> {
  // Scroll the column into view first — columns past the viewport edge
  // would otherwise be unhittable. Routes through the new
  // `ensureColumnVisible` API the "Scroll to column" item also targets.
  await page.evaluate(
    (id) => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.ensureColumnVisible(id),
    colId,
  );
  await waitForFrames(page, 4);
  const bounds = await page.evaluate(
    (id) => (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getHeaderBoundsAt(id),
    colId,
  );
  if (!bounds) throw new Error(`no header bounds for ${colId}`);
  const off = await canvasOffset(page);
  await page.mouse.click(
    off.x + bounds.x + bounds.w / 2,
    off.y + bounds.y + bounds.h / 2,
    { button: 'right' },
  );
  await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });
}

async function readPivotColumns(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getPivotColumns()
  );
}

async function readValueColumns(page: Page): Promise<Array<{ colId: string; aggFunc: string }>> {
  return page.evaluate(() =>
    (window as unknown as { __cgrid: GridApiSurface }).__cgrid.getValueColumns()
  );
}

test.describe('Cycle 18 / Task 7 — context menu pivot items', () => {
  test('"Add to Labels" mutates PivotState AND pills appear in both other surfaces (SYNC INVARIANT)', async ({ page }) => {
    await gridReady(page);
    expect(await readPivotColumns(page)).toEqual([]);

    await rightClickHeader(page, 'sector');
    const addLabel = page.locator(LABEL_SELECTOR).filter({ hasText: /^Add to Labels$/ });
    await expect(addLabel).toHaveCount(1);
    await addLabel.click();
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });
    await waitForFrames(page, 8);

    // 1. PivotState mutated.
    expect(await readPivotColumns(page)).toEqual(['sector']);

    // 2. The top-of-grid pivot panel paints a pill for sector.
    const panelPill = page.locator('.cg-pivot-panel .cg-pivot-panel-pill[data-col-id="sector"]');
    await expect(panelPill).toBeVisible();

    // 3. The sidebar columns tool panel's plz zone paints a pill for
    //    sector — the THIRD surface. THE SYNC INVARIANT (all three
    //    views over PivotState now show the same pill, mutated through
    //    a single PivotState verb).
    const plzPill = page.locator('.cg-columns-panel-plz .cg-columns-panel-plz-pill[data-col-id="sector"]');
    await expect(plzPill).toBeVisible();
  });

  test('"Remove from Labels" toggles off + pills disappear from both other surfaces', async ({ page }) => {
    await gridReady(page);

    // Seed pivot via the context menu (covered by the previous test) so
    // we can verify removal symmetry.
    await rightClickHeader(page, 'sector');
    await page.locator(LABEL_SELECTOR).filter({ hasText: /^Add to Labels$/ }).click();
    await waitForFrames(page, 6);
    expect(await readPivotColumns(page)).toEqual(['sector']);

    // Re-open the header menu — now it shows "Remove from Labels".
    await rightClickHeader(page, 'sector');
    const removeLabel = page.locator(LABEL_SELECTOR).filter({ hasText: /^Remove from Labels$/ });
    await expect(removeLabel).toHaveCount(1);
    await expect(page.locator(LABEL_SELECTOR).filter({ hasText: /^Add to Labels$/ }))
      .toHaveCount(0);
    await removeLabel.click();
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });
    await waitForFrames(page, 8);

    // PivotState cleared + both views show no pill for sector.
    expect(await readPivotColumns(page)).toEqual([]);
    await expect(page.locator('.cg-pivot-panel .cg-pivot-panel-pill[data-col-id="sector"]'))
      .toHaveCount(0);
    await expect(page.locator('.cg-columns-panel-plz .cg-columns-panel-plz-pill[data-col-id="sector"]'))
      .toHaveCount(0);
  });

  test('"Value: Aggregate <col>" submenu opens with the registered agg names + adds the column with the picked agg', async ({ page }) => {
    await gridReady(page);
    expect(await readValueColumns(page)).toEqual([]);

    await rightClickHeader(page, 'notionalAmount');
    const valueRow = page.locator(`${MENU_SELECTOR} .cg-menu-item`).filter({
      has: page.locator('.cg-menu-item-label', { hasText: /^Value: Aggregate Notional$/ }),
    });
    await expect(valueRow).toHaveCount(1);

    // Hover the parent row → submenu opens with the 5 built-in agg names.
    await valueRow.hover();
    await expect(page.locator(`${MENU_SELECTOR} .cg-menu-item-label`).filter({ hasText: /^sum$/ }))
      .toHaveCount(1);
    for (const name of ['avg', 'min', 'max', 'count']) {
      await expect(page.locator(`${MENU_SELECTOR} .cg-menu-item-label`).filter({ hasText: new RegExp(`^${name}$`) }))
        .toHaveCount(1);
    }

    // Click "avg" → state mutates: notionalAmount becomes a value column
    // with aggFunc avg.
    await page.locator(`${MENU_SELECTOR} .cg-menu-item-label`).filter({ hasText: /^avg$/ }).click();
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });
    await waitForFrames(page, 6);
    expect(await readValueColumns(page)).toEqual([
      { colId: 'notionalAmount', aggFunc: 'avg' },
    ]);

    // The valz zone in the columns tool panel paints a pill.
    await expect(page.locator('.cg-columns-panel-valz .cg-columns-panel-valz-pill[data-col-id="notionalAmount"]'))
      .toBeVisible();
  });

  test('clicking the CURRENT agg in the submenu toggles the value column off', async ({ page }) => {
    await gridReady(page);

    // Seed via the context menu (avg).
    await rightClickHeader(page, 'notionalAmount');
    await page.locator(`${MENU_SELECTOR} .cg-menu-item`).filter({
      has: page.locator('.cg-menu-item-label', { hasText: /^Value: Aggregate Notional$/ }),
    }).hover();
    await page.locator(`${MENU_SELECTOR} .cg-menu-item-label`).filter({ hasText: /^avg$/ }).click();
    await waitForFrames(page, 6);
    expect(await readValueColumns(page)).toEqual([
      { colId: 'notionalAmount', aggFunc: 'avg' },
    ]);

    // Re-open the menu → the submenu shows ✓ next to avg → click avg
    // again to toggle off.
    await rightClickHeader(page, 'notionalAmount');
    await page.locator(`${MENU_SELECTOR} .cg-menu-item`).filter({
      has: page.locator('.cg-menu-item-label', { hasText: /^Value: Aggregate Notional$/ }),
    }).hover();
    // ✓ sits in the icon slot of the avg row.
    await expect(
      page.locator(`${MENU_SELECTOR} .cg-menu-item`).filter({
        has: page.locator('.cg-menu-item-label', { hasText: /^avg$/ }),
      }).locator('.cg-menu-item-icon')
    ).toHaveText('✓');

    await page.locator(`${MENU_SELECTOR} .cg-menu-item-label`).filter({ hasText: /^avg$/ }).click();
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });
    await waitForFrames(page, 6);
    expect(await readValueColumns(page)).toEqual([]);
  });

  test('clicking a DIFFERENT agg swaps the aggFunc in place (no add/remove)', async ({ page }) => {
    await gridReady(page);

    // Seed avg.
    await rightClickHeader(page, 'notionalAmount');
    await page.locator(`${MENU_SELECTOR} .cg-menu-item`).filter({
      has: page.locator('.cg-menu-item-label', { hasText: /^Value: Aggregate Notional$/ }),
    }).hover();
    await page.locator(`${MENU_SELECTOR} .cg-menu-item-label`).filter({ hasText: /^avg$/ }).click();
    await waitForFrames(page, 6);

    // Re-open menu, hover Value row, click max — column stays as a
    // value column but aggFunc swaps from avg to max.
    await rightClickHeader(page, 'notionalAmount');
    await page.locator(`${MENU_SELECTOR} .cg-menu-item`).filter({
      has: page.locator('.cg-menu-item-label', { hasText: /^Value: Aggregate Notional$/ }),
    }).hover();
    await page.locator(`${MENU_SELECTOR} .cg-menu-item-label`).filter({ hasText: /^max$/ }).click();
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });
    await waitForFrames(page, 6);

    expect(await readValueColumns(page)).toEqual([
      { colId: 'notionalAmount', aggFunc: 'max' },
    ]);
  });

  test('"Scroll to column" appears when pivotMode === false, hides when pivotMode === true', async ({ page }) => {
    await gridReady(page);
    expect(await page.evaluate(() =>
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.isPivotMode()
    )).toBe(false);

    await rightClickHeader(page, 'ticker');
    await expect(page.locator(LABEL_SELECTOR).filter({ hasText: /^Scroll to column$/ }))
      .toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });

    // Flip pivot mode on (pivot still inactive: 0 pivot cols + 0 value
    // cols, but the mode flag drives the gate).
    await page.evaluate(() => {
      (window as unknown as { __cgrid: GridApiSurface }).__cgrid.setPivotMode(true);
    });
    await waitForFrames(page, 4);

    await rightClickHeader(page, 'ticker');
    await expect(page.locator(LABEL_SELECTOR).filter({ hasText: /^Scroll to column$/ }))
      .toHaveCount(0);
  });

  test('pivot items are GATED on enableX — a column without enablePivot/enableValue gets neither item', async ({ page }) => {
    await gridReady(page);

    // `ticker` has neither enablePivot nor enableValue under ?pivotDemo=on.
    await rightClickHeader(page, 'ticker');
    await expect(page.locator(LABEL_SELECTOR).filter({ hasText: /^Add to Labels$/ }))
      .toHaveCount(0);
    await expect(page.locator(LABEL_SELECTOR).filter({ hasText: /^Remove from Labels$/ }))
      .toHaveCount(0);
    await expect(page.locator(LABEL_SELECTOR).filter({ hasText: /^Value: Aggregate/ }))
      .toHaveCount(0);
  });
});
