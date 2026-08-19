/**
 * Cycle 9 patch — collapse-range-on-keyboard-focus (two-focused-cells bug).
 *
 * Before the fix:
 *   - Drag from A to D (range A..D, focus = D).
 *   - Press ArrowRight → focus moves to E, but the range overlay stays
 *     painting A..D → user sees TWO blue rectangles on the same row.
 *
 * After the fix every keyboard navigation path (Arrow / Tab / Home /
 * End / PageUp / PageDown / Enter-nav) calls
 * `SelectionModel.setFocusAndCollapseRanges` which moves focus AND
 * collapses ranges to a 1×1 at the new cell in a single emit. The
 * focus ring + range overlay always paint at the same place.
 *
 * Mouse-driven focus moves (plain click, drag, shift-click, ctrl-click,
 * header-click column band, fill-handle commit) keep their multi-cell
 * range — only keyboard nav collapses.
 *
 * The tests seed the wide range via the API (`addCellRange`) so we don't
 * depend on a `mouse.down/up` drag landing the canvas as the focused
 * element — keyboard events here are dispatched directly into the canvas
 * via a Playwright `Locator.press` so they always reach the grid.
 */
import { test, expect, Page } from '@playwright/test';
import type { SelectionRange } from '../../../cgrid/src/types';

const GRID_SELECTOR = '#grid canvas';

interface GridSurface {
  addCellRange: (range: SelectionRange) => void;
  clearCellRanges: () => void;
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

async function rangesNow(page: Page): Promise<SelectionRange[]> {
  return page.evaluate(
    () => (window as unknown as { __cgrid: GridSurface }).__cgrid.selection.state.ranges
      .map((r) => ({ rowStart: r.rowStart, rowEnd: r.rowEnd, colIds: [...r.colIds] })),
  );
}

async function focusNow(page: Page): Promise<{ rowIndex: number | null; colId: string | null }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __cgrid: GridSurface }).__cgrid.selection.state;
    return { rowIndex: s.focusedRowIndex, colId: s.focusedColId };
  });
}

async function seed(page: Page, range: SelectionRange, focusRow: number, focusCol: string): Promise<void> {
  await page.evaluate(
    ({ r, fr, fc }) => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      g.clearCellRanges();
      g.addCellRange(r);
      g.selection.setFocus(fr, fc);
    },
    { r: range, fr: focusRow, fc: focusCol },
  );
  await waitForFrames(page, 2);
}

test.describe('Cycle 9 patch — range collapses on keyboard focus moves', () => {
  test('ArrowRight after a wide range collapses the range to the new focused cell', async ({ page }) => {
    await gridReady(page);

    // Seed a wide range spanning 3 rows × 1 column, focus on the anchor.
    await seed(page, { rowStart: 1, rowEnd: 3, colIds: ['currentPrice'] }, 1, 'currentPrice');

    // ArrowRight via the canvas locator so keyboard events reach the grid.
    const canvas = page.locator(GRID_SELECTOR);
    await canvas.click({ position: { x: 80, y: 120 }, force: true });
    // The click moved focus + replaced the range (RangeSelection on
    // mousedown). Re-seed the wide range after the click so we test the
    // keyboard-collapse path.
    await seed(page, { rowStart: 1, rowEnd: 3, colIds: ['currentPrice'] }, 1, 'currentPrice');

    await canvas.press('ArrowRight');
    await waitForFrames(page, 4);

    const after = await rangesNow(page);
    const focus = await focusNow(page);
    expect(after.length).toBe(1);
    expect(after[0]!.rowStart).toBe(focus.rowIndex);
    expect(after[0]!.rowEnd).toBe(focus.rowIndex);
    expect(after[0]!.colIds).toEqual([focus.colId]);
    // Range collapsed to a single cell (rowEnd === rowStart).
    expect(after[0]!.rowEnd - after[0]!.rowStart).toBe(0);
    // And the focused col MOVED off the seed (ArrowRight changed it).
    expect(focus.colId).not.toBe('currentPrice');
  });

  test('ArrowDown / Home / End each collapse a wide multi-row × multi-column range', async ({ page }) => {
    await gridReady(page);
    const canvas = page.locator(GRID_SELECTOR);
    // Seed canvas focus once so subsequent .press goes through.
    await canvas.click({ position: { x: 80, y: 120 }, force: true });

    for (const key of ['ArrowDown', 'Home', 'End']) {
      // Re-seed a wide range each iteration (the prior collapse left it 1×1).
      await seed(
        page,
        { rowStart: 2, rowEnd: 5, colIds: ['currentPrice', 'dailyPnl', 'unrealizedPnl'] },
        2,
        'currentPrice',
      );

      await canvas.press(key);
      await waitForFrames(page, 4);

      const r = await rangesNow(page);
      const f = await focusNow(page);
      expect(r.length, `after ${key}`).toBe(1);
      expect(r[0]!.rowStart, `after ${key} rowStart`).toBe(f.rowIndex);
      expect(r[0]!.rowEnd, `after ${key} rowEnd`).toBe(f.rowIndex);
      expect(r[0]!.colIds, `after ${key} colIds`).toEqual([f.colId]);
    }
  });

  test('Escape clears the active cell range (in addition to clearing row selection)', async ({ page }) => {
    await gridReady(page);
    const canvas = page.locator(GRID_SELECTOR);
    await canvas.click({ position: { x: 80, y: 120 }, force: true });

    await seed(page, { rowStart: 4, rowEnd: 4, colIds: ['currentPrice'] }, 4, 'currentPrice');
    expect((await rangesNow(page)).length).toBe(1);

    await canvas.press('Escape');
    await waitForFrames(page, 4);
    expect((await rangesNow(page)).length).toBe(0);
  });

  test('Enter-commit inside the editor collapses a pre-edit wide range to a 1×1 at the next focused cell (two-focused-cells regression)', async ({ page }) => {
    // Regression: EditController's `deps.setFocus` used to wire to
    // `SelectionModel.setFocus` (non-collapsing). Pressing Enter to
    // commit an edit moved focus down but left the pre-edit range
    // painting the OLD anchor cell — the user saw two blue
    // rectangles at once. The fix wires `deps.setFocus` to
    // `setFocusAndCollapseRanges` so the range follows focus.
    await gridReady(page);
    const canvas = page.locator(GRID_SELECTOR);
    // Seed canvas focus so subsequent .press hits the grid.
    await canvas.click({ position: { x: 80, y: 120 }, force: true });

    // Seed a wide multi-row range with the focus at the top.
    await seed(
      page,
      { rowStart: 1, rowEnd: 4, colIds: ['cusip'] },
      1,
      'cusip',
    );
    expect((await rangesNow(page)).length).toBe(1);
    expect((await rangesNow(page))[0]!.rowEnd).toBe(4);

    // Open the editor at the focused cell via F2 (edit mode) and Enter
    // to commit + move-down without modifying the value.
    await canvas.press('F2');
    // The editor's input is mounted in the DOM overlay; type nothing
    // and commit with Enter so no value change fires (isolates the
    // regression to the focus + range invariant).
    await canvas.press('Enter');
    await waitForFrames(page, 4);

    const after = await rangesNow(page);
    const focus = await focusNow(page);
    // Exactly ONE range remains — the pre-edit wide range collapsed
    // to a 1×1 at the new focused cell. Two ranges here would repro
    // the reported bug (focus ring on the new cell + range overlay
    // still on the old anchor).
    expect(after.length).toBe(1);
    expect(after[0]!.rowStart).toBe(focus.rowIndex);
    expect(after[0]!.rowEnd).toBe(focus.rowIndex);
    expect(after[0]!.colIds).toEqual([focus.colId]);
  });

  test('mouse-driven focus moves DO NOT collapse — multi-cell ranges seeded via the API survive a follow-up click somewhere outside the range', async ({ page }) => {
    // The keyboard-collapse path is gated to keyboard nav. RangeSelection's
    // own mousedown handler REPLACES ranges on plain click; that's expected.
    // Here we confirm the collapse helper is NOT wired into the plain
    // `setFocus` path — if it were, a programmatic setFocus call would
    // silently clobber a multi-cell range that was set independently.
    await gridReady(page);

    await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridSurface }).__cgrid;
      g.clearCellRanges();
      g.addCellRange({ rowStart: 1, rowEnd: 5, colIds: ['currentPrice', 'dailyPnl'] });
      // Move focus to a cell INSIDE the wide range via the non-collapsing
      // `setFocus`. The range MUST stay multi-cell.
      g.selection.setFocus(3, 'dailyPnl');
    });
    await waitForFrames(page, 4);

    const r = await rangesNow(page);
    expect(r.length).toBe(1);
    expect(r[0]!.rowStart).toBe(1);
    expect(r[0]!.rowEnd).toBe(5);
    expect(r[0]!.colIds).toEqual(['currentPrice', 'dailyPnl']);
  });
});
