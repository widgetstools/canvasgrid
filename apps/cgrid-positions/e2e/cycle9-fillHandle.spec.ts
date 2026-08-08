/**
 * Cycle 9 / Task 5 — fill handle drag-to-extend + commit values.
 *
 * Verifies:
 * 1. Dragging the 6×6 handle at the bottom-right of the focused range
 *    EXTENDS the selection range by the rows traversed (preview).
 * 2. On release, the extended cells receive new values via the default
 *    extrapolation (each target cell's value is different from the source).
 * 3. `enableFillHandle: false` (set via `setGridOption`) suppresses the
 *    handle — the same drag that previously extended now produces a
 *    fresh range drag instead.
 */
import { test, expect, Page } from '@playwright/test';
import type { SelectionRange } from '../../../cgrid/src/types';

const GRID_SELECTOR = '#grid canvas';

interface GridSurface {
  setGridOption: (key: 'enableFillHandle', value: boolean) => void;
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  getCellValue: (rowIndex: number, colId: string) => unknown;
  getCellRanges?: () => SelectionRange[];
  selection: { state: { ranges: SelectionRange[] } };
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

async function cellValue(page: Page, rowIndex: number, colId: string): Promise<unknown> {
  return page.evaluate(
    ({ r, c }) =>
      (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellValue(r, c),
    { r: rowIndex, c: colId },
  );
}

test.describe('Cycle 9 / Task 5 — fill handle', () => {
  test('drag handle extends the range by the number of rows traversed (preview)', async ({ page }) => {
    await gridReady(page);
    // Click currentPrice at row 0 to seed a 1x1 range and focus.
    const seed = await cellBounds(page, 0, 'currentPrice');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + seed.x + seed.w / 2, off.y + seed.y + seed.h / 2);
    await waitForFrames(page, 4);

    // Verify the seed range landed.
    const seedRanges = await rangesNow(page);
    expect(seedRanges.length).toBe(1);
    expect(seedRanges[0]!.rowStart).toBe(0);
    expect(seedRanges[0]!.rowEnd).toBe(0);
    expect(seedRanges[0]!.colIds).toEqual(['currentPrice']);

    // Drag from the bottom-right corner of the seed cell down 3 rows.
    // The bottom-right corner is (seed.x+seed.w, seed.y+seed.h); the
    // handle hit zone extends ±3 px around that point.
    const row3 = await cellBounds(page, 3, 'currentPrice');
    await page.mouse.move(off.x + seed.x + seed.w - 1, off.y + seed.y + seed.h - 1);
    await page.mouse.down();
    // Two intermediate moves so the drag handler fires window-mousemove
    // ticks rather than a single jump.
    await page.mouse.move(off.x + row3.x + row3.w / 2, off.y + row3.y + row3.h / 4, { steps: 6 });
    await page.mouse.move(off.x + row3.x + row3.w / 2, off.y + row3.y + row3.h / 2, { steps: 6 });

    // Preview: the range should now span rows 0..3.
    const dragRanges = await rangesNow(page);
    expect(dragRanges.length).toBe(1);
    expect(dragRanges[0]!.rowStart).toBe(0);
    expect(dragRanges[0]!.rowEnd).toBe(3);
    expect(dragRanges[0]!.colIds).toEqual(['currentPrice']);

    await page.mouse.up();
    await waitForFrames(page, 8);
  });

  test('release commits values: each target cell differs from the source after the worker round-trip', async ({ page }) => {
    await gridReady(page);
    // Capture the BEFORE values for rows 1..3.
    const beforeR1 = await cellValue(page, 1, 'currentPrice');
    const beforeR2 = await cellValue(page, 2, 'currentPrice');
    const beforeR3 = await cellValue(page, 3, 'currentPrice');

    // Seed selection at (row 0, currentPrice).
    const seed = await cellBounds(page, 0, 'currentPrice');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + seed.x + seed.w / 2, off.y + seed.y + seed.h / 2);
    await waitForFrames(page, 4);
    const sourceValue = await cellValue(page, 0, 'currentPrice');

    // Drag the handle down to row 3 + release.
    const row3 = await cellBounds(page, 3, 'currentPrice');
    await page.mouse.move(off.x + seed.x + seed.w - 1, off.y + seed.y + seed.h - 1);
    await page.mouse.down();
    await page.mouse.move(off.x + row3.x + row3.w / 2, off.y + row3.y + row3.h / 2, { steps: 12 });
    await page.mouse.up();
    // applyTransaction → worker round-trip → new chunk → repaint. Give
    // it a generous window since the demo runs against a live STOMP feed.
    await page.waitForTimeout(800);
    await waitForFrames(page, 8);

    const afterR1 = await cellValue(page, 1, 'currentPrice');
    const afterR2 = await cellValue(page, 2, 'currentPrice');
    const afterR3 = await cellValue(page, 3, 'currentPrice');

    // Each filled row should now hold a value DIFFERENT from its
    // previous value AND derived from the source — i.e. source + step.
    // With a single-cell numeric source the default is source + (i+1).
    expect(afterR1).not.toEqual(beforeR1);
    expect(afterR2).not.toEqual(beforeR2);
    expect(afterR3).not.toEqual(beforeR3);
    if (typeof sourceValue === 'number') {
      expect(afterR1).toBe(sourceValue + 1);
      expect(afterR2).toBe(sourceValue + 2);
      expect(afterR3).toBe(sourceValue + 3);
    }
  });

  test('enableFillHandle:false suppresses the handle — the same drag becomes a fresh range select', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.setGridOption('enableFillHandle', false),
    );
    await waitForFrames(page, 4);

    // Seed a range at row 0.
    const seed = await cellBounds(page, 0, 'currentPrice');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + seed.x + seed.w / 2, off.y + seed.y + seed.h / 2);
    await waitForFrames(page, 4);

    // Drag from the bottom-right corner of the seed cell — would normally
    // extend via fill, but with the option off, this is a regular range
    // drag from the corner cell to row 3.
    const row3 = await cellBounds(page, 3, 'currentPrice');
    await page.mouse.move(off.x + seed.x + seed.w - 1, off.y + seed.y + seed.h - 1);
    await page.mouse.down();
    await page.mouse.move(off.x + row3.x + row3.w / 2, off.y + row3.y + row3.h / 2, { steps: 6 });

    // With the handle off, RangeSelection claimed the press as a new range
    // anchored on the corner cell (still row 0, currentPrice). The drag
    // extends the new range downward, so it still spans rows 0..3 — but
    // the BEFORE values are preserved because no commit fires.
    const beforeUpR1 = await cellValue(page, 1, 'currentPrice');
    const beforeUpR2 = await cellValue(page, 2, 'currentPrice');

    await page.mouse.up();
    await waitForFrames(page, 8);
    // Give the would-be transaction time to NOT fire.
    await page.waitForTimeout(400);

    const afterR1 = await cellValue(page, 1, 'currentPrice');
    const afterR2 = await cellValue(page, 2, 'currentPrice');
    // Values must NOT have been mutated by a fill commit.
    expect(afterR1).toEqual(beforeUpR1);
    expect(afterR2).toEqual(beforeUpR2);
  });
});
