/**
 * Cycle 11 / Task 8 — DOM-canvas coexistence audit.
 *
 * Regression matrix that exercises every interaction feature with the side
 * bar both CLOSED and OPEN, confirming the canvas-shrink wiring (Task 2's
 * `reserveSideBarSpace` → `setHostBounds` → `cgridCanvas.resize()` chain)
 * doesn't leave any feature reading stale bounds. Tests are paired — each
 * scenario runs once with the side bar closed (baseline) and once with the
 * Columns panel open (~280 px side bar reservation).
 *
 * Coverage map (matches the Task 8 worklog matrix):
 *  1. Cell click → focus lands on the clicked cell with correct (rowIndex,
 *     colId). Reads `canvas.getBoundingClientRect()` via `toLocal`; the
 *     shrunk canvas means a click at the same VIEWPORT-relative x maps to
 *     a DIFFERENT cell when the bar is open, but a click at the cell's
 *     LIVE viewport coords (re-resolved each scenario) should always land
 *     on the asked-for cell.
 *  2. Range drag → drag from one cell to another extends the range exactly
 *     to the covered cells, no off-by-side-bar-width drift.
 *  3. Edge-zone auto-scroll → drag past the SHRUNK body right edge fires
 *     the rAF auto-scroll loop (scrollLeft advances) and the range pulls
 *     in previously off-screen columns. Confirms `getBodyRect()` returns
 *     the SHRUNK `bodyRight`, not the original full width.
 *  4. Wheel scroll → wheel over the canvas scrolls the grid; wheel over
 *     the side bar does NOT advance the grid's scrollLeft/scrollTop (the
 *     side bar is on a different DOM subtree, so its wheel events never
 *     reach the canvas listener).
 *  5. Context menu → right-click on a cell mounts `.vg-context-menu` at
 *     the cursor in viewport coords; the menu doesn't end up sliced or
 *     hidden under the side bar.
 *  6. Filter popup → clicking the floating-filter expand button on a
 *     pinned-left column mounts the popup with non-zero width; the popup
 *     anchors under the button.
 *  7. Side bar resize handle drag → dragging the inner-edge handle DOES
 *     NOT propagate into the canvas feature chain (no selection / focus
 *     changes mid-drag).
 *
 * The default positions demo configures the side bar via
 * `sideBar: { toolPanels: ['columns', 'filters'] }` — no opt-in needed.
 */
import { test, expect, Page } from '@playwright/test';
import type { SelectionRange } from '../../../cgrid/src/types';

const GRID_SELECTOR = '#grid canvas';
const SIDE_BAR_SELECTOR = '.vg-side-bar';
const TAB_SELECTOR = '.vg-side-bar-tab';
const PANEL_SELECTOR = '.vg-side-bar-panel';
const HANDLE_SELECTOR = '.vg-side-bar-resize';
const MENU_SELECTOR = '.vg-context-menu';

interface ViewportSurface {
  scrollLeft: number;
  scrollTop: number;
  bodyLeft: number;
  bodyRight: number;
  bodyTop: number;
  bodyBottom: number;
  visibleColumns: { colId: string; left: number; right: number; pinned?: 'left' | 'right' }[];
}

interface GridSurface {
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  selection: {
    state: { ranges: SelectionRange[]; focusedRowIndex: number | null; focusedColId: string | null };
  };
  viewport: ViewportSurface;
  openToolPanel: (id: string) => void;
  closeToolPanel: () => void;
  isSideBarVisible: () => boolean;
  getColumnState: () => { colId: string; hide?: boolean }[];
  setGridOption: (key: string, value: unknown) => void;
}

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

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?stress=light');
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

async function canvasWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    return c ? Math.round(c.getBoundingClientRect().width) : 0;
  });
}

async function cellBounds(page: Page, rowIndex: number, colId: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await page.evaluate(
    ({ r, c }) => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellBoundsAt(r, c),
    { r: rowIndex, c: colId },
  );
  if (!b) throw new Error(`no cell bounds for (${rowIndex}, ${colId})`);
  return b;
}

async function rangesNow(page: Page): Promise<SelectionRange[]> {
  return page.evaluate(
    () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.selection.state.ranges
      .map((r) => ({ rowStart: r.rowStart, rowEnd: r.rowEnd, colIds: [...r.colIds] })),
  );
}

async function focusNow(page: Page): Promise<{ rowIndex: number | null; colId: string | null }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __velocity-grid: GridSurface }).__cgrid.selection.state;
    return { rowIndex: s.focusedRowIndex, colId: s.focusedColId };
  });
}

async function snapshotViewport(page: Page): Promise<ViewportSurface> {
  return page.evaluate(() => {
    const v = (window as unknown as { __velocity-grid: GridSurface }).__cgrid.viewport;
    return {
      scrollLeft: v.scrollLeft,
      scrollTop: v.scrollTop,
      bodyLeft: v.bodyLeft,
      bodyRight: v.bodyRight,
      bodyTop: v.bodyTop,
      bodyBottom: v.bodyBottom,
      visibleColumns: v.visibleColumns.map((c) => ({
        colId: c.colId,
        left: c.left,
        right: c.right,
        pinned: c.pinned,
      })),
    };
  });
}

async function openColumnsPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __velocity-grid: GridSurface }).__cgrid.openToolPanel('agColumnsToolPanel');
  });
  // Wait for the resize → setHostBounds → resize() chain to settle, plus
  // give the viewport recompute a couple of rAFs.
  await waitForFrames(page, 8);
  await expect(page.locator(PANEL_SELECTOR)).not.toHaveCSS('display', 'none');
}

/** The demo's `sideBar` has no `defaultToolPanel`, so a fresh page-load
 *  already starts with the side bar visible but no panel open — the
 *  "closed" baseline. This helper is a no-op past the readiness wait. */
async function closedScenario(_page: Page): Promise<void> {
  // intentionally empty — gridReady leaves the side bar collapsed.
}

interface Scenario {
  name: 'closed' | 'open';
  setUp: (page: Page) => Promise<void>;
}

const SCENARIOS: Scenario[] = [
  { name: 'closed', setUp: closedScenario },
  { name: 'open', setUp: openColumnsPanel },
];

test.describe('Cycle 11 / Task 8 — DOM-canvas coexistence audit', () => {
  test('side bar mounts with the demo so the matrix has a target', async ({ page }) => {
    await gridReady(page);
    await expect(page.locator(SIDE_BAR_SELECTOR)).toBeVisible();
    await expect(page.locator(TAB_SELECTOR)).toHaveCount(2);
  });

  // -----------------------------------------------------------------------
  // (1) Cell click — focus lands on the clicked cell.
  // -----------------------------------------------------------------------
  for (const scenario of SCENARIOS) {
    test(`(${scenario.name}) cell click focuses the clicked cell`, async ({ page }) => {
      await gridReady(page);
      await scenario.setUp(page);

      // `cusip` is pinned-left so the cell is visible in both scenarios.
      const b = await cellBounds(page, 3, 'cusip');
      const off = await canvasOffset(page);
      await page.mouse.click(off.x + b.x + b.w / 2, off.y + b.y + b.h / 2);
      await waitForFrames(page, 3);

      const focus = await focusNow(page);
      expect(focus).toEqual({ rowIndex: 3, colId: 'cusip' });
    });
  }

  // -----------------------------------------------------------------------
  // (2) Range drag — covered cells land in the resulting range.
  // -----------------------------------------------------------------------
  for (const scenario of SCENARIOS) {
    test(`(${scenario.name}) range drag covers the dragged cells`, async ({ page }) => {
      await gridReady(page);
      await scenario.setUp(page);

      const a = await cellBounds(page, 1, 'cusip');
      const b = await cellBounds(page, 4, 'cusip');
      const off = await canvasOffset(page);
      const ax = off.x + a.x + a.w / 2;
      const ay = off.y + a.y + a.h / 2;
      const bx = off.x + b.x + b.w / 2;
      const by = off.y + b.y + b.h / 2;

      await page.mouse.move(ax, ay);
      await page.mouse.down({ button: 'left' });
      await page.mouse.move(bx, by, { steps: 6 });
      await page.mouse.up({ button: 'left' });
      await waitForFrames(page, 3);

      const ranges = await rangesNow(page);
      expect(ranges.length).toBe(1);
      expect(ranges[0]!.rowStart).toBe(1);
      expect(ranges[0]!.rowEnd).toBe(4);
      expect(ranges[0]!.colIds).toEqual(['cusip']);
    });
  }

  // -----------------------------------------------------------------------
  // (3) Edge-zone auto-scroll — uses the SHRUNK bodyRight when the side
  // bar is open. The "open" case is the load-bearing one: the overshoot
  // point is computed from the LIVE `bodyRight` (which Task 2's resize
  // chain must update); if any feature read the OLD bodyRight, the
  // pointer would land safely INSIDE the new body and auto-scroll would
  // never fire.
  // -----------------------------------------------------------------------
  for (const scenario of SCENARIOS) {
    test(`(${scenario.name}) edge-zone auto-scroll fires past the live body right edge`, async ({ page }) => {
      await gridReady(page);
      await scenario.setUp(page);

      const before = await snapshotViewport(page);
      expect(before.scrollLeft).toBe(0);

      // Need an off-screen center column to confirm auto-scroll revealed
      // previously-hidden columns. Find one outside the visible center
      // band.
      const centerCols = before.visibleColumns.filter((c) => c.pinned !== 'left' && c.pinned !== 'right');
      if (centerCols.length === 0) {
        test.skip(true, 'no visible center columns — demo layout shifted');
      }
      const lastVisible = centerCols[centerCols.length - 1]!;
      const allColIds = await page.evaluate(() => {
        const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
        return g.getColumnState().filter((s) => s.hide !== true).map((s) => s.colId);
      });
      const lastVisibleIdx = allColIds.indexOf(lastVisible.colId);
      const offScreenColId = allColIds.slice(lastVisibleIdx + 1).find((id) => {
        const vis = before.visibleColumns.find((c) => c.colId === id);
        return !vis || vis.pinned !== 'right';
      });
      if (offScreenColId == null) {
        test.skip(true, 'no off-screen center column to scroll into — widen the viewport');
      }

      const anchorCell = await cellBounds(page, 1, 'ticker');
      const off = await canvasOffset(page);
      const startX = off.x + anchorCell.x + anchorCell.w / 2;
      const startY = off.y + anchorCell.y + anchorCell.h / 2;

      // Overshoot the LIVE bodyRight by 30 CSS px — the pointer should
      // land deep inside the edge zone. When the side bar is open,
      // `before.bodyRight` reflects the SHRUNK width; if any feature
      // read a stale rect, this overshoot would be invalid.
      const overshootX = off.x + before.bodyRight + 30;
      const overshootY = startY;

      await page.mouse.move(startX, startY);
      await page.mouse.down({ button: 'left' });
      await page.mouse.move(overshootX, overshootY);
      // Hold so the rAF loop accrues scroll.
      await page.waitForTimeout(250);
      await page.mouse.up({ button: 'left' });
      await waitForFrames(page, 4);

      const after = await snapshotViewport(page);
      const ranges = await rangesNow(page);

      expect(after.scrollLeft).toBeGreaterThan(before.scrollLeft);
      expect(ranges.length).toBe(1);
      // Auto-scroll revealed (and the range was extended into) at least
      // one previously off-screen column.
      expect(ranges[0]!.colIds).toContain(offScreenColId);
    });
  }

  // -----------------------------------------------------------------------
  // (4) Wheel scroll — over the canvas scrolls the grid; over the side
  // bar does NOT advance the grid scroll position.
  // -----------------------------------------------------------------------
  for (const scenario of SCENARIOS) {
    test(`(${scenario.name}) wheel over the canvas scrolls the grid`, async ({ page }) => {
      await gridReady(page);
      await scenario.setUp(page);

      const before = await snapshotViewport(page);
      const off = await canvasOffset(page);
      const cw = await canvasWidth(page);
      // Wheel inside the LIVE canvas region (mid-canvas).
      const wx = off.x + cw / 2;
      const wy = off.y + 200;
      await page.mouse.move(wx, wy);
      await page.mouse.wheel(0, 300);
      await waitForFrames(page, 4);

      const after = await snapshotViewport(page);
      expect(after.scrollTop).toBeGreaterThan(before.scrollTop);
    });
  }

  test('(open) wheel over the side bar does NOT scroll the grid', async ({ page }) => {
    await gridReady(page);
    await openColumnsPanel(page);

    const before = await snapshotViewport(page);
    const tabBox = await page.locator(`${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`).boundingBox();
    if (!tabBox) throw new Error('no tab bounding box');
    // Wheel over the side bar tab strip — well inside the side bar DOM
    // subtree, well OUTSIDE the canvas.
    await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
    await page.mouse.wheel(0, 300);
    await waitForFrames(page, 4);

    const after = await snapshotViewport(page);
    expect(after.scrollTop).toBe(before.scrollTop);
    expect(after.scrollLeft).toBe(before.scrollLeft);
  });

  // -----------------------------------------------------------------------
  // (5) Context menu — mounts at the cursor in viewport coords.
  // -----------------------------------------------------------------------
  for (const scenario of SCENARIOS) {
    test(`(${scenario.name}) right-click on a cell mounts the context menu at the cursor`, async ({ page }) => {
      await gridReady(page);
      await scenario.setUp(page);

      const b = await cellBounds(page, 2, 'cusip');
      const off = await canvasOffset(page);
      const cx = off.x + b.x + b.w / 2;
      const cy = off.y + b.y + b.h / 2;

      await page.mouse.move(cx, cy);
      await page.mouse.click(cx, cy, { button: 'right' });
      await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });

      const menuBox = await page.locator(MENU_SELECTOR).boundingBox();
      expect(menuBox).not.toBeNull();
      // Menu has non-zero size + sits within ~10 px of the click point
      // (the host clamps to viewport, but the click is well inside the
      // viewport in both scenarios so no clamp displacement is expected).
      expect(menuBox!.width).toBeGreaterThan(50);
      expect(menuBox!.height).toBeGreaterThan(20);
      expect(Math.abs(menuBox!.x - cx)).toBeLessThan(12);
      expect(Math.abs(menuBox!.y - cy)).toBeLessThan(12);
      // Menu fits inside the viewport — it doesn't get sliced off the
      // right by viewport clamping when the side bar is open.
      const vw = await page.evaluate(() => window.innerWidth);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(vw + 1);

      await page.keyboard.press('Escape');
      await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });
    });
  }

  // -----------------------------------------------------------------------
  // (6) Filter popup — mounts visible under the expand button.
  // -----------------------------------------------------------------------
  for (const scenario of SCENARIOS) {
    test(`(${scenario.name}) filter popup mounts under the expand button with non-zero size`, async ({ page }) => {
      await gridReady(page);
      await scenario.setUp(page);

      // `cusip` is pinned-left so the expand button stays visible in both
      // scenarios. Filter is `'text'`, so the popup is `.vg-filter-popup-text`.
      const expand = page.locator('button[data-vg-floating-filter-expand][data-vg-col-id="cusip"]');
      await expect(expand).toHaveCount(1);
      const expandBox = await expand.boundingBox();
      if (!expandBox) throw new Error('expand button has no bounding box');

      await expand.click();
      const popup = page.locator('.vg-filter-popup-text');
      await expect(popup).toHaveCount(1);
      const popupBox = await popup.boundingBox();
      expect(popupBox).not.toBeNull();
      expect(popupBox!.width).toBeGreaterThan(50);
      expect(popupBox!.height).toBeGreaterThan(20);
      // Popup anchors near the expand button's bottom edge.
      expect(popupBox!.y).toBeGreaterThanOrEqual(expandBox.y);
      expect(popupBox!.y).toBeLessThanOrEqual(expandBox.y + expandBox.height + 8);
      // Close by clicking far away so the next test starts clean.
      await page.mouse.click(2, 2);
      await expect(popup).toHaveCount(0);
    });
  }

  // -----------------------------------------------------------------------
  // (7) Side bar resize handle drag — must NOT leak into the canvas
  // feature chain (no selection / focus change side effects).
  // -----------------------------------------------------------------------
  test('(open) dragging the side bar resize handle does not mutate selection or focus', async ({ page }) => {
    await gridReady(page);
    await openColumnsPanel(page);

    // Plant a known selection + focus FIRST so we can assert the drag
    // didn't touch them.
    const seed = await cellBounds(page, 2, 'cusip');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + seed.x + seed.w / 2, off.y + seed.y + seed.h / 2);
    await waitForFrames(page, 3);
    const focusBefore = await focusNow(page);
    const rangesBefore = await rangesNow(page);
    expect(focusBefore).toEqual({ rowIndex: 2, colId: 'cusip' });
    expect(rangesBefore.length).toBe(1);

    const handle = page.locator(HANDLE_SELECTOR);
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('no handle bounding box');
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 60, startY, { steps: 10 });
    await page.mouse.up();
    await waitForFrames(page, 6);

    const focusAfter = await focusNow(page);
    const rangesAfter = await rangesNow(page);
    expect(focusAfter).toEqual(focusBefore);
    expect(rangesAfter).toEqual(rangesBefore);
  });
});
