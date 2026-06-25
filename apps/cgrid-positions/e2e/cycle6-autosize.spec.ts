/**
 * Cycle 6 / Task 4 — autoSizeAllColumns.
 *
 * Click the toolbar "Autosize all" button, await the worker measure
 * round-trip + repaint, then assert:
 * - Columns visible in the demo grew or shrank — at least one column's
 *   width changed (so we know the autosize pass actually ran).
 * - The `cusip` column (marked `suppressAutoSize: true`) kept its
 *   declared width across the call.
 * - The `positionId` column (longest stable identifier in the demo)
 *   landed at a width comfortably above its minimum — proves the worker
 *   actually measured the cell text.
 */
import { test, expect } from '@playwright/test';

interface ColumnStateEntry {
  colId: string;
  width?: number;
  hide?: boolean;
}

interface GridApiSurface {
  getColumnState: () => ColumnStateEntry[];
  autoSizeAllColumns: (skipHeader?: boolean) => Promise<void>;
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

test.describe('Cycle 6 / Task 4 — autoSizeAllColumns', () => {
  test('autosizes every column except suppressAutoSize', async ({ page }) => {
    await gridReady(page);

    const before = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getColumnState();
    });
    const beforeCusip = before.find((e) => e.colId === 'cusip');
    const beforePositionId = before.find((e) => e.colId === 'positionId');
    expect(beforeCusip?.width).toBeDefined();
    expect(beforePositionId?.width).toBeDefined();

    // Drive the toolbar button + await the worker round-trip.
    await page.click('#autosize-all');
    // The autoSizeAllColumns Promise resolves after the worker round-trip
    // lands and main has applied widths. Drive it directly so the test
    // doesn't race with the requestAnimationFrame tail.
    await page.evaluate(async () => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      await grid.autoSizeAllColumns();
    });
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );

    const after = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getColumnState();
    });

    // suppressAutoSize holds cusip at its pre-autosize width.
    const afterCusip = after.find((e) => e.colId === 'cusip');
    expect(afterCusip?.width).toBe(beforeCusip?.width);

    // At least one column's width actually changed — the autosize pass
    // ran and produced a non-noop result.
    const changed = after.some((entry) => {
      const prev = before.find((b) => b.colId === entry.colId);
      return prev && prev.width !== entry.width;
    });
    expect(changed).toBe(true);

    // positionId's cells carry strings like "POS-00042" (≥ 9 chars) plus
    // 16 px padding; even with the coarse jsdom-fallback measurer the
    // resulting width should comfortably exceed the column's 30 px
    // minWidth. We only assert the lower bound so the test stays robust
    // across measurer implementations (OffscreenCanvas vs fallback).
    const afterPositionId = after.find((e) => e.colId === 'positionId');
    expect(afterPositionId?.width).toBeGreaterThanOrEqual(30 + 16);
  });
});
