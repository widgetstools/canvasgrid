/**
 * Cycle 9 patch / Task 2 — auto-scroll during range drag near the
 * viewport edge.
 *
 * Before the fix:
 *   - Mousedown on a center cell, drag past the canvas right edge.
 *   - `RangeSelection.handleMouseDrag` does NOT scroll, so the range
 *     freezes at the rightmost VISIBLE column. Off-screen columns are
 *     unreachable without releasing + scrolling manually.
 *
 * After the fix:
 *   - When the pointer enters the ±20 px edge zone of the body rectangle
 *     during a drag, an rAF-paced loop calls `ctx.grid.scrollBy(dx, dy)`
 *     with speed linear in the depth past the edge (capped at 30 px/frame).
 *   - Each rAF tick re-hit-tests at the captured pointer position so the
 *     range follows the newly-revealed cells.
 *   - The loop self-terminates when the pointer re-enters the body OR the
 *     drag ends (mouseup).
 *
 * The off-screen column is discovered dynamically from the viewport state
 * so the test stays robust against demo column layout changes.
 */
import { test, expect, Page } from '@playwright/test';
import type { SelectionRange } from '../../../cgrid/src/types';

const GRID_SELECTOR = '#grid canvas';

interface ViewportSurface {
  scrollLeft: number;
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
  allColIds?: () => string[];
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

async function canvasOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
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

async function snapshotViewport(page: Page): Promise<ViewportSurface> {
  return page.evaluate(() => {
    const v = (window as unknown as { __velocity-grid: GridSurface }).__cgrid.viewport;
    return {
      scrollLeft: v.scrollLeft,
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

test.describe('Cycle 9 patch / Task 2 — auto-scroll during range drag near the viewport edge', () => {
  test('drag past the body right edge auto-scrolls the body and extends the range to a previously off-screen column', async ({ page }) => {
    await gridReady(page);

    // Snapshot viewport BEFORE the drag so we can identify a center column
    // whose left edge sits past bodyRight (off-screen) and assert it lands
    // in the range AFTER the auto-scroll.
    const before = await snapshotViewport(page);
    expect(before.scrollLeft).toBe(0);

    // Find the rightmost VISIBLE center column — that's the anchor of the
    // drag's right edge before scrolling. Anything past it (in render order)
    // is off-screen at scrollLeft=0.
    const centerCols = before.visibleColumns.filter((c) => c.pinned !== 'left' && c.pinned !== 'right');
    expect(centerCols.length).toBeGreaterThan(0);
    const lastVisible = centerCols[centerCols.length - 1]!;

    // Get the FULL render order from `getColumnState()` (public VelocityGridApi).
    // Hidden leaves stay in the state too — filter them out so we only
    // consider columns the layout actually paints.
    const allColIds = await page.evaluate(() => {
      const g = (window as unknown as { __velocity-grid: GridSurface & { getColumnState: () => { colId: string; hide?: boolean }[] } }).__cgrid;
      return g.getColumnState().filter((s) => s.hide !== true).map((s) => s.colId);
    });
    // Find a column past the lastVisible — that's the one we want to scroll to.
    const lastVisibleIdx = allColIds.indexOf(lastVisible.colId);
    expect(lastVisibleIdx).toBeGreaterThanOrEqual(0);
    const offScreenColId = allColIds.slice(lastVisibleIdx + 1).find(
      (id) => {
        // Skip pinned-right columns (always visible regardless of scrollLeft).
        const vis = before.visibleColumns.find((c) => c.colId === id);
        return !vis || vis.pinned !== 'right';
      },
    );
    if (offScreenColId == null) {
      throw new Error('no off-screen center column found — demo may have changed; widen the viewport or add center cols');
    }

    // Mousedown on a center cell that's safely in the middle of the body.
    // ticker is the first non-pinned column. Row 1 is a safe data row.
    const anchorCell = await cellBounds(page, 1, 'ticker');
    const off = await canvasOffset(page);
    const startX = off.x + anchorCell.x + anchorCell.w / 2;
    const startY = off.y + anchorCell.y + anchorCell.h / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });

    // Move past the canvas right edge by 30 px. We compute the OUTSIDE point
    // in client coords (off.x + bodyRight + 30) so the pointer overshoots
    // the body rectangle by 30 px — depth into the edge zone = 20 (full zone)
    // + 30 (past edge) = 50 — capped at 30 px/frame.
    const overshootX = off.x + before.bodyRight + 30;
    const overshootY = off.y + anchorCell.y + anchorCell.h / 2;
    await page.mouse.move(overshootX, overshootY);

    // Hold the pointer in the edge zone for ~200ms (~12 rAF ticks at 60fps).
    // 30 px/frame × 12 frames ≈ 360 px of scroll — comfortably enough to
    // reveal at least one off-screen column.
    await page.waitForTimeout(250);

    // Release the mouse so the auto-scroll loop self-terminates.
    await page.mouse.up({ button: 'left' });
    await waitForFrames(page, 4);

    const after = await snapshotViewport(page);
    const ranges = await rangesNow(page);

    // (1) scrollLeft advanced. ANY positive advance is enough — we don't
    //     hard-code a px count so the test stays robust across the 1 px /
    //     frame floor and 30 px / frame cap.
    expect(after.scrollLeft).toBeGreaterThan(before.scrollLeft);

    // (2) The range now includes a column that was off-screen at drag start.
    expect(ranges.length).toBe(1);
    expect(ranges[0]!.colIds).toContain(offScreenColId);
  });
});
