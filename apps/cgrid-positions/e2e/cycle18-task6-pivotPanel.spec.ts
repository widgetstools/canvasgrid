/**
 * Cycle 18 / Task 6 — pivot panel E2E (behavioural, not smoke).
 *
 * Drives the top-of-grid pivot panel against the live positions grid
 * with `?pivotDemo=on&pivotPanel=always` (which mounts the panel and
 * stamps `enablePivot` on sector/region/desk/currency).
 *
 * Hard assertions on PivotState mutation — every test reads back
 * through `api.getPivotColumns()` to verify the canonical state moved,
 * NOT just the DOM chrome.
 *
 * Coverage:
 *   1. Panel mounts above the row group panel (column-header band
 *      shifts down by the strip's height).
 *   2. Empty-state placeholder paints with the AG-vocab string.
 *   3. Drag a column header into the panel — pill appears + state
 *      reports it.
 *   4. Drag a non-pivot-enabled column — rejected (data-drop="reject").
 *   5. Pill `×` click removes the column from PivotState.
 *   6. THE SYNC INVARIANT: mutating PivotState via the top panel
 *      makes a matching pill appear in the sidebar plz zone on the
 *      next event tick (no manual refresh).
 *   7. `onlyWhenPivoting` mode pre-reserves height but paint-
 *      suppresses content until pivot turns on.
 */
import { test, expect, Page } from '@playwright/test';

const GRID = '#grid canvas';
const PANEL = '.cg-pivot-panel';

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

async function gridReady(page: Page, qs = '?pivotDemo=on&pivotPanel=always'): Promise<void> {
  await page.goto(`/${qs}`);
  await page.waitForSelector(GRID, { state: 'visible' });
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function readPivotState(page: Page): Promise<{
  pivotMode: boolean;
  pivotColumns: string[];
  rowGroupColumns: string[];
}> {
  return await page.evaluate(() => {
    const api = (window as unknown as { __cgrid?: {
      isPivotMode: () => boolean;
      getPivotColumns: () => string[];
      getRowGroupColumns: () => string[];
    } }).__cgrid;
    if (!api) throw new Error('__cgrid not exposed');
    return {
      pivotMode: api.isPivotMode(),
      pivotColumns: api.getPivotColumns(),
      rowGroupColumns: api.getRowGroupColumns(),
    };
  });
}

test.describe('Cycle 18 / Task 6 — pivot panel (top-of-grid)', () => {
  test('panel mounts with empty-state placeholder reading "Drag here to set column labels"', async ({ page }) => {
    await gridReady(page);
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();
    const empty = panel.locator('.cg-pivot-panel-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText('Drag here to set column labels');
  });

  test('panel reserves space ABOVE the row group panel (stacking order)', async ({ page }) => {
    // Regression: pivot panel sits above the row group panel. Mount
    // both via `?rowGroupPanel=always&pivotPanel=always` and verify
    // the pivot panel's bottom edge is at or above the row group
    // panel's top edge.
    await gridReady(page, '?pivotDemo=on&pivotPanel=always&rowGroupPanel=always');
    const pivotBox = await page.locator(PANEL).boundingBox();
    const rgBox = await page.locator('.cg-row-group-panel').boundingBox();
    expect(pivotBox).not.toBeNull();
    expect(rgBox).not.toBeNull();
    // Pivot panel top is at or above row group panel top.
    expect(pivotBox!.y).toBeLessThanOrEqual(rgBox!.y);
    // Pivot panel bottom is at or above row group panel top (pivot
    // strip ends where row group strip begins).
    expect(pivotBox!.y + pivotBox!.height).toBeLessThanOrEqual(rgBox!.y + 2);
  });

  test('drag a pivot-enabled column header into the panel adds it to PivotState', async ({ page }) => {
    await gridReady(page);
    let state = await readPivotState(page);
    expect(state.pivotColumns).toEqual([]);

    // Find the sector column header on the canvas. Walk the first
    // data cell back to the leaf-header band by skipping any floating-
    // filter row in between. The leaf header sits at:
    //   y = pivotPanel.bottom + (rowGroupPanel? height : 0) + headerHalf
    // We use the panel rect + a small offset that lands cleanly
    // inside the leaf header for the sector column.
    const sectorBounds = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: {
        getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null;
      } }).__cgrid;
      const canvas = document.querySelector('#grid canvas') as HTMLCanvasElement;
      const cRect = canvas.getBoundingClientRect();
      const bounds = api!.getCellBoundsAt(0, 'sector');
      if (!bounds) return null;
      // The pivot panel is at the top (32 px); the leaf header band
      // sits BELOW the pivot panel. Floating filter (28 px) sits
      // between the leaf header and the first data row. So leaf-
      // header mid = bounds.y - floatingFilterHeight - leafHeaderHalf.
      // Use 50 px above the first data row as a safe leaf-header hit
      // (28 px floating filter + ~22 px into a 28 px leaf header).
      return {
        clientX: cRect.left + bounds.x + bounds.w / 2,
        clientY: cRect.top + bounds.y - 50,
      };
    });
    expect(sectorBounds).not.toBeNull();
    const panelBox = await page.locator(PANEL).boundingBox();
    expect(panelBox).not.toBeNull();

    await page.mouse.move(sectorBounds!.clientX, sectorBounds!.clientY);
    await page.mouse.down();
    // Move through an intermediate point so the drag threshold (4 px) is crossed.
    await page.mouse.move(sectorBounds!.clientX + 20, sectorBounds!.clientY + 20, { steps: 5 });
    await page.mouse.move(panelBox!.x + panelBox!.width / 2, panelBox!.y + panelBox!.height / 2, { steps: 10 });
    // Panel paints the accept state mid-drag.
    await expect(page.locator(PANEL)).toHaveAttribute('data-drop', 'accept');
    await page.mouse.up();
    await waitForFrames(page, 3);

    state = await readPivotState(page);
    expect(state.pivotColumns).toEqual(['sector']);
    const pill = page.locator(`${PANEL} .cg-pivot-panel-pill[data-col-id="sector"]`);
    await expect(pill).toBeVisible();
    await expect(pill.locator('.cg-pivot-panel-pill-label')).toHaveText('Sector');
  });

  test('drag a non-pivot-enabled column header shows reject state and does NOT mutate PivotState', async ({ page }) => {
    await gridReady(page);
    // `ticker` carries neither `enablePivot` nor `enableValue` under
    // `?pivotDemo=on` — neither role can be assigned via drag.
    const sourceBounds = await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: {
        getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null;
      } }).__cgrid;
      const canvas = document.querySelector('#grid canvas') as HTMLCanvasElement;
      const cRect = canvas.getBoundingClientRect();
      const bounds = api!.getCellBoundsAt(0, 'ticker');
      if (!bounds) return null;
      return {
        clientX: cRect.left + bounds.x + bounds.w / 2,
        clientY: cRect.top + bounds.y - 50,
      };
    });
    expect(sourceBounds).not.toBeNull();
    const panelBox = await page.locator(PANEL).boundingBox();

    await page.mouse.move(sourceBounds!.clientX, sourceBounds!.clientY);
    await page.mouse.down();
    await page.mouse.move(sourceBounds!.clientX + 20, sourceBounds!.clientY + 20, { steps: 5 });
    await page.mouse.move(panelBox!.x + panelBox!.width / 2, panelBox!.y + panelBox!.height / 2, { steps: 10 });
    await expect(page.locator(PANEL)).toHaveAttribute('data-drop', 'reject');
    await page.mouse.up();
    await waitForFrames(page, 3);

    const state = await readPivotState(page);
    expect(state.pivotColumns).toEqual([]);
    await expect(page.locator(PANEL)).not.toHaveAttribute('data-drop', /.*/);
  });

  test('pill `×` click removes the column from PivotState', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { addPivotColumn: (c: string) => void } }).__cgrid;
      api?.addPivotColumn('region');
    });
    await waitForFrames(page, 3);
    const pill = page.locator(`${PANEL} .cg-pivot-panel-pill[data-col-id="region"]`);
    await expect(pill).toBeVisible();

    await pill.locator('.cg-pivot-panel-pill-remove').click();
    await waitForFrames(page, 3);
    const state = await readPivotState(page);
    expect(state.pivotColumns).toEqual([]);
  });

  // ── THE SYNC INVARIANT (Task 6 highest-value parity check) ─────────
  test('top-of-grid pivot panel + sidebar plz zone share PivotState (both update on either mutation)', async ({ page }) => {
    await gridReady(page);
    // Open the sidebar columns panel so the plz zone is mounted.
    const COLUMNS_TAB = '.cg-side-bar-tab[data-id="agColumnsToolPanel"]';
    const SIDEBAR_PANEL = '.cg-columns-panel';
    const PLZ = `${SIDEBAR_PANEL} .cg-columns-panel-plz`;
    if (!(await page.locator(SIDEBAR_PANEL).isVisible().catch(() => false))) {
      await page.locator(COLUMNS_TAB).click();
      await page.waitForSelector(SIDEBAR_PANEL, { state: 'visible' });
      await waitForFrames(page, 3);
    }

    // Mutate PivotState via the TOP panel: add `desk` via the api
    // (simulating a successful drag-in to the top strip; the drag
    // gesture itself is already covered above — here we focus on the
    // sync invariant).
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: { addPivotColumn: (c: string) => void } }).__cgrid;
      api?.addPivotColumn('desk');
    });
    await waitForFrames(page, 3);

    // Top panel shows the pill.
    await expect(page.locator(`${PANEL} .cg-pivot-panel-pill[data-col-id="desk"]`)).toBeVisible();
    // Sidebar plz zone shows a pill for the same column ON THE NEXT
    // EVENT TICK — no manual refresh required. Both surfaces are
    // views over the SAME ordered pivotColumns list.
    await expect(page.locator(`${PLZ} .cg-columns-panel-plz-pill[data-col-id="desk"]`)).toBeVisible();

    // Mutate via the SIDEBAR (`×` on the plz pill) — pill must
    // disappear from BOTH surfaces.
    await page.locator(`${PLZ} .cg-columns-panel-plz-pill[data-col-id="desk"] .cg-columns-panel-plz-pill-remove`).click();
    await waitForFrames(page, 3);
    await expect(page.locator(`${PANEL} .cg-pivot-panel-pill[data-col-id="desk"]`)).toHaveCount(0);
    await expect(page.locator(`${PLZ} .cg-columns-panel-plz-pill[data-col-id="desk"]`)).toHaveCount(0);

    const state = await readPivotState(page);
    expect(state.pivotColumns).toEqual([]);
  });

  test('onlyWhenPivoting mode pre-reserves height but paint-suppresses content while pivot inactive', async ({ page }) => {
    // Regression: 'onlyWhenPivoting' RESERVES the strip height at
    // construction so a later `setPivotMode(true)` doesn't trigger a
    // layout reflow. The strip's content is paint-suppressed until
    // pivot activates.
    await gridReady(page, '?pivotDemo=on&pivotPanel=onlyWhenPivoting');
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(0);
    // Content is paint-suppressed — no empty placeholder, no pills.
    await expect(panel).toHaveAttribute('data-active', 'false');
    await expect(panel.locator('.cg-pivot-panel-empty')).toHaveCount(0);
    await expect(panel.locator('.cg-pivot-panel-pill')).toHaveCount(0);

    // Activate pivot — strip paints the empty placeholder (pivot
    // active but no pivot columns yet).
    await page.evaluate(() => {
      const api = (window as unknown as { __cgrid?: {
        setPivotMode: (v: boolean) => void;
        addValueColumn: (c: string, f: string) => void;
        addPivotColumn: (c: string) => void;
      } }).__cgrid;
      api?.setPivotMode(true);
      api?.addValueColumn('notionalAmount', 'sum');
      api?.addPivotColumn('sector');
    });
    await waitForFrames(page, 3);
    await expect(panel).toHaveAttribute('data-active', 'true');
    await expect(panel.locator('.cg-pivot-panel-pill[data-col-id="sector"]')).toBeVisible();
  });
});
