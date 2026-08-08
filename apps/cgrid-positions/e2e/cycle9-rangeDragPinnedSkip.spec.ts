/**
 * Regression — horizontal range-drag in the center zone must NOT include
 * pinned-right columns whose definition position happens to fall between
 * the anchor and the current cursor in `columnDefs`.
 *
 * Bug shape: `allColIds()` used to return definition order. The demo's
 * `pnl` column is defined at index ~6 but pinned-right (visually at the
 * far right). A drag from `currentPrice` (defined ~5) to `unrealizedPnl`
 * (defined ~8) would produce `[currentPrice, pnl, dailyPnl,
 * unrealizedPnl]` because `slice(5, 9)` over the raw definition array
 * pulls in `pnl`. After the fix `allColIds()` returns zone-ordered
 * (left | center | right), so the slice is always visually contiguous:
 * `[currentPrice, dailyPnl, unrealizedPnl]`.
 */
import { test, expect, Page } from '@playwright/test';
import type { SelectionRange } from '../../../cgrid/src/types';

const GRID_SELECTOR = '#grid canvas';

interface GridSurface {
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  selection: { state: { ranges: SelectionRange[] } };
}

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?stress=light&pinning=on');
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

async function cellBounds(
  page: Page,
  rowIndex: number,
  colId: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await page.evaluate(
    ({ r, c }) =>
      (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellBoundsAt(r, c),
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

test.describe('range-drag in the center zone skips pinned-right columns', () => {
  test('drag from currentPrice → unrealizedPnl produces a 3-col slice (no pnl)', async ({ page }) => {
    await gridReady(page);
    const off = await canvasOffset(page);

    // Anchor at (row 3, currentPrice). Drag to (row 3, unrealizedPnl).
    const a = await cellBounds(page, 3, 'currentPrice');
    const b = await cellBounds(page, 3, 'unrealizedPnl');

    // mousedown via dispatchEvent so we can drive raw mouse events from the
    // canvas itself (locator.click would have to leave the canvas region).
    await page.evaluate(({ ax, ay }) => {
      const c = document.querySelector('#grid canvas') as HTMLCanvasElement;
      c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: ax, clientY: ay, button: 0 }));
    }, { ax: off.x + a.x + a.w / 2, ay: off.y + a.y + a.h / 2 });

    // Walk halfway, then to target — window-level mousemove drives the drag.
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, button: 0 }));
    }, { x: off.x + (a.x + b.x) / 2 + b.w / 2, y: off.y + a.y + a.h / 2 });
    await waitForFrames(page, 2);
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, button: 0 }));
    }, { x: off.x + b.x + b.w / 2, y: off.y + a.y + a.h / 2 });
    await waitForFrames(page, 2);
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y, button: 0 }));
    }, { x: off.x + b.x + b.w / 2, y: off.y + a.y + a.h / 2 });
    await waitForFrames(page, 4);

    const r = await rangesNow(page);
    expect(r.length).toBe(1);
    expect(r[0]!.rowStart).toBe(3);
    expect(r[0]!.rowEnd).toBe(3);
    // The critical assertion — `pnl` (right-pinned, definition index 6)
    // must NOT appear in a drag over center columns.
    expect(r[0]!.colIds).toEqual(['currentPrice', 'dailyPnl', 'unrealizedPnl']);
    expect(r[0]!.colIds).not.toContain('pnl');
  });
});
