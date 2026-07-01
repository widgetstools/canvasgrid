/**
 * Cycle 18 / Task 5 — pivot tool panel E2E (behavioural, not smoke).
 *
 * Drives the Columns tool panel against the live positions grid with
 * `?pivotDemo=on` (which sets `enablePivot` on sector/region/currency/
 * desk and `enableValue` on notionalAmount/marketValue/pnl/notionalAmount).
 *
 * Hard assertions on PivotState mutation — every test reads back through
 * `api.getPivotColumns()` / `api.getValueColumns()` / `api.isPivotMode()`
 * to verify the canonical state moved, NOT just the DOM chrome.
 *
 * Coverage:
 *   1. Pivot Mode toggle drives api.setPivotMode + the toggle reflects
 *      external setPivotMode calls (round-trip via pivotStateChanged).
 *   2. Drag a column-list row into the Column Labels zone — pill appears
 *      + getPivotColumns() reports the new entry.
 *   3. Drag a non-pivot-enabled column into the zone — rejected.
 *   4. Pill `×` click removes the column from PivotState.
 *   5. Drag a value-enabled column into the Values zone — pill appears
 *      with the `sum(headerName)` label + getValueColumns() reports it.
 *   6. pivotMode-dependent checkbox semantics (the AG-parity bug —
 *      Prompt 9 item 4): clicking a row checkbox in pivot mode adds the
 *      column as row-group OR value, NOT visibility flip.
 */
import { test, expect, Page } from '@playwright/test';

const GRID = '#grid canvas';
const PANEL = '.cg-columns-panel';
const COLUMNS_TAB = '.cg-side-bar-tab[data-id="agColumnsToolPanel"]';

async function waitForFrames(page: Page, n = 6): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = () => (++i >= count ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    n,
  );
}

async function gridReady(page: Page, qs = '?pivotDemo=on'): Promise<void> {
  await page.goto(`/${qs}`);
  await page.waitForSelector(GRID, { state: 'visible' });
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
  // Open Columns panel (defaultToolPanel under `?pivotDemo=on`).
  if (!(await page.locator(PANEL).isVisible().catch(() => false))) {
    await page.locator(COLUMNS_TAB).click();
    await page.waitForSelector(PANEL, { state: 'visible' });
    await waitForFrames(page, 3);
  }
}

/** Enable pivot mode via the api + wait for the panel to reflect it.
 *  Cycle 18 follow-ups (commits c921031, b8e5887) intentionally hide
 *  the Column Labels (`.cg-columns-panel-plz`) section when pivot mode
 *  is OFF — interacting with that zone requires pivot mode ON first. */
async function enablePivotMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as { __cgrid?: { setPivotMode: (v: boolean) => void } }).__cgrid;
    api?.setPivotMode(true);
  });
  await waitForFrames(page, 3);
  await page.locator(`${PANEL} .cg-columns-panel-plz`).waitFor({ state: 'visible' });
}

/** Read current PivotState from the live api. */
async function readPivotState(page: Page): Promise<{
  pivotMode: boolean;
  pivotColumns: string[];
  valueColumns: Array<{ colId: string; aggFunc: string }>;
  rowGroupColumns: string[];
}> {
  return await page.evaluate(() => {
    const api = (window as unknown as { __cgrid?: {
      isPivotMode: () => boolean;
      getPivotColumns: () => string[];
      getValueColumns: () => Array<{ colId: string; aggFunc: string }>;
      getRowGroupColumns: () => string[];
    } }).__cgrid;
    if (!api) throw new Error('__cgrid not exposed');
    return {
      pivotMode: api.isPivotMode(),
      pivotColumns: api.getPivotColumns(),
      valueColumns: api.getValueColumns(),
      rowGroupColumns: api.getRowGroupColumns(),
    };
  });
}

test.describe('Cycle 18 / Task 5 — pivot tool panel', () => {
  test('Pivot Mode toggle drives api.setPivotMode and external setPivotMode reflects back in the toggle', async ({ page }) => {
    await gridReady(page);
    const toggle = page.locator(`${PANEL} .cg-columns-panel-pivot-mode button`);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Click the UI toggle.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    let state = await readPivotState(page);
    expect(state.pivotMode).toBe(true);

    // Flip externally via the api — the toggle should re-sync.
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { setPivotMode: (v: boolean) => void } }).__cgrid;
      api?.setPivotMode(false);
    });
    await waitForFrames(page, 3);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    state = await readPivotState(page);
    expect(state.pivotMode).toBe(false);
  });

  test('drag a pivot-enabled column from the column list into the Column Labels zone adds it to PivotState', async ({ page }) => {
    await gridReady(page);
    await enablePivotMode(page);
    let state = await readPivotState(page);
    expect(state.pivotColumns).toEqual([]);

    const sourceHandle = page.locator(`${PANEL} .cg-columns-panel-row[data-col-id="sector"] .cg-columns-panel-row-handle`);
    const zone = page.locator(`${PANEL} .cg-columns-panel-plz`);
    const handleBox = await sourceHandle.boundingBox();
    const zoneBox = await zone.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(zoneBox).not.toBeNull();

    // Drive a real mousedown → move → mouseup gesture across the panel.
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    // Move through an intermediate point so the drag-threshold (4 px) is crossed.
    await page.mouse.move(handleBox!.x + 20, handleBox!.y + 20, { steps: 5 });
    await page.mouse.move(zoneBox!.x + zoneBox!.width / 2, zoneBox!.y + zoneBox!.height / 2, { steps: 10 });
    // The zone should paint the accept state during the drag.
    await expect(zone).toHaveAttribute('data-drop', 'accept');
    await page.mouse.up();
    await waitForFrames(page, 3);

    state = await readPivotState(page);
    expect(state.pivotColumns).toEqual(['sector']);
    // Pill appeared.
    const pill = page.locator(`${PANEL} .cg-columns-panel-plz-pill[data-col-id="sector"]`);
    await expect(pill).toBeVisible();
    await expect(pill.locator('.cg-columns-panel-plz-pill-label')).toHaveText('Sector');
  });

  test('drag a non-pivot-enabled column shows reject state and does NOT mutate PivotState', async ({ page }) => {
    await gridReady(page);
    await enablePivotMode(page);
    // `ticker` carries no `enablePivot` in pivotDemo mode.
    const sourceHandle = page.locator(`${PANEL} .cg-columns-panel-row[data-col-id="ticker"] .cg-columns-panel-row-handle`);
    const zone = page.locator(`${PANEL} .cg-columns-panel-plz`);
    const handleBox = await sourceHandle.boundingBox();
    const zoneBox = await zone.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(zoneBox).not.toBeNull();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 20, handleBox!.y + 20, { steps: 5 });
    await page.mouse.move(zoneBox!.x + zoneBox!.width / 2, zoneBox!.y + zoneBox!.height / 2, { steps: 10 });
    await expect(zone).toHaveAttribute('data-drop', 'reject');
    await page.mouse.up();
    await waitForFrames(page, 3);

    const state = await readPivotState(page);
    expect(state.pivotColumns).toEqual([]);
    await expect(zone).not.toHaveAttribute('data-drop', /.*/);
  });

  test('Column Labels pill `×` click removes the column from PivotState', async ({ page }) => {
    await gridReady(page);
    await enablePivotMode(page);
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { addPivotColumn: (c: string) => void } }).__cgrid;
      api?.addPivotColumn('region');
    });
    await waitForFrames(page, 3);
    const pill = page.locator(`${PANEL} .cg-columns-panel-plz-pill[data-col-id="region"]`);
    await expect(pill).toBeVisible();

    await pill.locator('.cg-columns-panel-plz-pill-remove').click();
    await waitForFrames(page, 3);
    const state = await readPivotState(page);
    expect(state.pivotColumns).toEqual([]);
  });

  test('drag a value-enabled column into the Values zone adds {colId, aggFunc:sum} and labels pill as sum(headerName)', async ({ page }) => {
    await gridReady(page);
    let state = await readPivotState(page);
    expect(state.valueColumns).toEqual([]);

    const sourceHandle = page.locator(`${PANEL} .cg-columns-panel-row[data-col-id="notionalAmount"] .cg-columns-panel-row-handle`);
    const zone = page.locator(`${PANEL} .cg-columns-panel-valz`);
    const handleBox = await sourceHandle.boundingBox();
    const zoneBox = await zone.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(zoneBox).not.toBeNull();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 20, handleBox!.y + 20, { steps: 5 });
    await page.mouse.move(zoneBox!.x + zoneBox!.width / 2, zoneBox!.y + zoneBox!.height / 2, { steps: 10 });
    await expect(zone).toHaveAttribute('data-drop', 'accept');
    await page.mouse.up();
    await waitForFrames(page, 3);

    state = await readPivotState(page);
    expect(state.valueColumns).toEqual([{ colId: 'notionalAmount', aggFunc: 'sum' }]);
    const pill = page.locator(`${PANEL} .cg-columns-panel-valz-pill[data-col-id="notionalAmount"]`);
    await expect(pill).toBeVisible();
    await expect(pill.locator('.cg-columns-panel-valz-pill-label')).toHaveText('sum(Notional)');
  });

  // ── THE AG-parity bug (Prompt 9 item 4) — checkbox semantics ─────
  test('pivotMode-dependent checkbox: pivotMode OFF + click toggles VISIBILITY', async ({ page }) => {
    await gridReady(page);
    const cb = page.locator(`${PANEL} .cg-columns-panel-row[data-col-id="sector"] .cg-columns-panel-row-checkbox`);
    await expect(cb).toBeChecked();
    // pivotMode is OFF — the click hides the column.
    await cb.click();
    await waitForFrames(page, 3);
    const hide = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { getColumnState: () => Array<{ colId: string; hide?: boolean }> } }).__cgrid;
      return api?.getColumnState().find((c) => c.colId === 'sector')?.hide;
    });
    expect(hide).toBe(true);
    const state = await readPivotState(page);
    expect(state.rowGroupColumns).toEqual([]);
    expect(state.pivotColumns).toEqual([]);
  });

  // Cycle 19 / Task 5b — enabled. `PivotEngine` now auto-hides every
  // primary column when pivot mode flips ON, and `computeRowChecked`
  // reads ROLE-only in pivot mode, so the AG-v36 strict semantic
  // (visible-non-role cols read UNCHECKED under pivot) holds.
  test('pivotMode-dependent checkbox: pivotMode ON + checking a column with enableRowGroup ADDS row-group (NOT visibility flip)', async ({ page }) => {
    await gridReady(page);
    // Flip pivot mode on via the toggle.
    await page.locator(`${PANEL} .cg-columns-panel-pivot-mode button`).click();
    await waitForFrames(page, 3);
    let state = await readPivotState(page);
    expect(state.pivotMode).toBe(true);
    expect(state.rowGroupColumns).toEqual([]);

    // sector carries enablePivot+enableRowGroup under ?pivotDemo=on. In
    // pivot mode the checkbox starts UNCHECKED (no role yet). Click it.
    const cb = page.locator(`${PANEL} .cg-columns-panel-row[data-col-id="sector"] .cg-columns-panel-row-checkbox`);
    await expect(cb).not.toBeChecked();
    await cb.click();
    await waitForFrames(page, 3);
    state = await readPivotState(page);
    expect(state.rowGroupColumns).toEqual(['sector']);
    expect(state.pivotColumns).toEqual([]);
    // The column IS auto-hidden as a side effect of being added to
    // row-groups (worker behavior — Cycle 15 auto-group column owns the
    // grouping axis). That hide came from the grouping pipeline, NOT
    // from a direct `setColumnsVisible` call originating in the panel —
    // which is the AG-parity contract this test pins.

    // Unchecking removes the role.
    await cb.click();
    await waitForFrames(page, 3);
    state = await readPivotState(page);
    expect(state.rowGroupColumns).toEqual([]);
  });

  // Cycle 19 / Task 5b — enabled. Pairs with the row-group variant
  // above; same strict semantic now holds for value-only columns.
  test('pivotMode-dependent checkbox: pivotMode ON + checking a value-only column ADDS it as value with default sum', async ({ page }) => {
    await gridReady(page);
    await page.locator(`${PANEL} .cg-columns-panel-pivot-mode button`).click();
    await waitForFrames(page, 3);

    // notionalAmount has enableValue but NOT enableRowGroup under pivotDemo.
    const cb = page.locator(`${PANEL} .cg-columns-panel-row[data-col-id="notionalAmount"] .cg-columns-panel-row-checkbox`);
    await expect(cb).not.toBeChecked();
    await cb.click();
    await waitForFrames(page, 3);
    const state = await readPivotState(page);
    expect(state.valueColumns).toEqual([{ colId: 'notionalAmount', aggFunc: 'sum' }]);
    expect(state.rowGroupColumns).toEqual([]);
  });
});
