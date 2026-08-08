/**
 * Cycle 9 patch / Task 1 — right-click on an existing cell range must
 * NOT clobber the range.
 *
 * Before the fix:
 *   - Drag-select a 3×3 range.
 *   - Right-click on a cell INSIDE the range (not the anchor).
 *   - `RangeSelection.handleMouseDown` rewrites the range to a 1×1 at the
 *     click on every mousedown regardless of button → the 3×3 collapses.
 *   - The context menu then opens AND `Copy` serialises a single cell
 *     instead of the 3×3 block the user expected.
 *
 * After the fix:
 *   - Right-click INSIDE the current range → range unchanged; focus moves
 *     to the clicked cell (so `Copy`'s serialiser sees the clicked cell as
 *     focused but iterates the full range rect).
 *   - Right-click OUTSIDE the current range → range collapses to 1×1 at
 *     the clicked cell (no behaviour regression; the menu still has a
 *     fresh 1×1 to act on).
 *
 * Seeding strategy: the wide range is seeded via the API
 * (`addCellRange` + `selection.setFocus`) so we don't depend on a flaky
 * `mouse.down/up` drag — the bug + fix are both inside the mousedown
 * handler, which the dispatched `contextmenu` event (mousedown is what
 * fires alongside it) exercises directly.
 */
import { test, expect, Page } from '@playwright/test';
import type { SelectionRange } from '../../../cgrid/src/types';

const GRID_SELECTOR = '#grid canvas';

interface GridSurface {
  addCellRange: (range: SelectionRange) => void;
  clearCellRanges: () => void;
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  selection: {
    state: { ranges: SelectionRange[]; focusedRowIndex: number | null; focusedColId: string | null };
    setFocus: (rowIndex: number | null, colId: string | null) => void;
  };
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

async function focusNow(page: Page): Promise<{ rowIndex: number | null; colId: string | null }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __velocity-grid: GridSurface }).__cgrid.selection.state;
    return { rowIndex: s.focusedRowIndex, colId: s.focusedColId };
  });
}

async function seed(page: Page, range: SelectionRange, focusRow: number, focusCol: string): Promise<void> {
  await page.evaluate(
    ({ r, fr, fc }) => {
      const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
      g.clearCellRanges();
      g.addCellRange(r);
      g.selection.setFocus(fr, fc);
    },
    { r: range, fr: focusRow, fc: focusCol },
  );
  await waitForFrames(page, 2);
}

test.describe('Cycle 9 patch / Task 1 — right-click preserves cell range', () => {
  test('right-click INSIDE the active range keeps the range intact + moves focus to the clicked cell', async ({ page }) => {
    await gridReady(page);

    // Seed a 3×3 range (rows 1..3 × currentPrice / dailyPnl / unrealizedPnl)
    // with focus on the anchor.
    const wide: SelectionRange = {
      rowStart: 1,
      rowEnd: 3,
      colIds: ['currentPrice', 'dailyPnl', 'unrealizedPnl'],
    };
    await seed(page, wide, 1, 'currentPrice');

    const before = await rangesNow(page);
    expect(before).toEqual([wide]);

    // Right-click on a cell INSIDE the range (row 2, dailyPnl — middle of the rect).
    const b = await cellBounds(page, 2, 'dailyPnl');
    const off = await canvasOffset(page);
    const cx = off.x + b.x + b.w / 2;
    const cy = off.y + b.y + b.h / 2;

    // Use the browser's right-click which fires BOTH a mousedown (button=2)
    // and a contextmenu — exactly the gesture the bug is about.
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await waitForFrames(page, 4);

    const after = await rangesNow(page);
    const focus = await focusNow(page);

    // Range MUST still be the 3×3.
    expect(after.length).toBe(1);
    expect(after[0]!.rowStart).toBe(1);
    expect(after[0]!.rowEnd).toBe(3);
    expect(after[0]!.colIds).toEqual(['currentPrice', 'dailyPnl', 'unrealizedPnl']);

    // Focus MOVED to the clicked cell so the context menu's Copy
    // serialiser anchors on the right cell.
    expect(focus.rowIndex).toBe(2);
    expect(focus.colId).toBe('dailyPnl');
  });

  test('right-click OUTSIDE the active range collapses it to a 1×1 at the clicked cell (no behaviour regression)', async ({ page }) => {
    await gridReady(page);

    // Seed a small range in rows 1..2 × currentPrice / dailyPnl.
    const wide: SelectionRange = {
      rowStart: 1,
      rowEnd: 2,
      colIds: ['currentPrice', 'dailyPnl'],
    };
    await seed(page, wide, 1, 'currentPrice');

    // Right-click on a cell OUTSIDE the range (row 5, unrealizedPnl).
    const b = await cellBounds(page, 5, 'unrealizedPnl');
    const off = await canvasOffset(page);
    const cx = off.x + b.x + b.w / 2;
    const cy = off.y + b.y + b.h / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await waitForFrames(page, 4);

    const after = await rangesNow(page);
    const focus = await focusNow(page);

    // Range collapsed to the clicked 1×1.
    expect(after.length).toBe(1);
    expect(after[0]!.rowStart).toBe(5);
    expect(after[0]!.rowEnd).toBe(5);
    expect(after[0]!.colIds).toEqual(['unrealizedPnl']);

    expect(focus.rowIndex).toBe(5);
    expect(focus.colId).toBe('unrealizedPnl');
  });

  test('right-click INSIDE the range followed by menu "Copy" serialises the FULL range (not just the clicked cell)', async ({ page }) => {
    // The grant for clipboard-read is `clipboard-read`; cgrid's Copy uses
    // `navigator.clipboard.writeText` which is allowed by default in
    // Playwright's Chromium with the right permission. Grant both.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await gridReady(page);

    const wide: SelectionRange = {
      rowStart: 1,
      rowEnd: 3,
      colIds: ['currentPrice', 'dailyPnl', 'unrealizedPnl'],
    };
    await seed(page, wide, 1, 'currentPrice');

    // Right-click INSIDE the range — fires mousedown(button=2) + contextmenu
    // which opens the demo's context menu (configured with the default
    // items including "Copy").
    const b = await cellBounds(page, 2, 'dailyPnl');
    const off = await canvasOffset(page);
    const cx = off.x + b.x + b.w / 2;
    const cy = off.y + b.y + b.h / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.click(cx, cy, { button: 'right' });
    await page.waitForSelector('.vg-context-menu', { state: 'visible' });

    // The demo wires the default registry's "Copy" item. Clicking it
    // serialises the range to the clipboard as TSV. Selector targets the
    // label span with an exact-text match so "Copy" matches but "Copy with
    // Headers" does not (the menu row's full textContent is
    // "⎘CopyCtrl+C" / "⎘Copy with Headers", so `hasText` regexes on
    // the whole row don't disambiguate cleanly).
    await page.locator('.vg-context-menu .vg-menu-item-label').getByText('Copy', { exact: true }).click();
    await page.waitForSelector('.vg-context-menu', { state: 'detached' });

    // Clipboard now holds the 3×3 TSV — 3 lines, each with 3 tab-separated
    // values. We don't assert the exact data values (the demo's STOMP feed
    // is non-deterministic), only the SHAPE: 3 rows × 3 cols.
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    expect(lines.length).toBe(3);
    for (const line of lines) {
      const cells = line.split('\t');
      expect(cells.length).toBe(3);
    }
  });
});
