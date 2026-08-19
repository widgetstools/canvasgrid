/**
 * Cycle 5 / Task 6 — variable row heights end-to-end coverage.
 *
 * Demo wires `getRowHeight` to return 56 px for ~25% of rows (positionIds
 * whose trailing char code is divisible by 4) and falls back to the grid
 * `rowHeight` otherwise. The grid ships per-row heights to the worker on
 * `setRowData`; the worker rides them back on each `ViewportChunk.heights`
 * Float32Array; the main thread paints rows at those heights.
 *
 * This spec asserts the user-visible result: scanning the visible window
 * surfaces at least two distinct row heights AND every row whose own
 * positionId triggers the rule paints at the expected 56 px.
 */
import { test, expect } from '@playwright/test';

interface GridApiSurface {
  getRowBoundsAt: (rowIndex: number) => { y: number; h: number } | null;
  getCellValue: (rowIndex: number, colId: string) => unknown;
}

test.describe('Variable row heights (Cycle 5 / Task 6)', () => {
  test.beforeEach(async ({ page }) => {
    // Demo opts into variable row heights via `?variableHeights=1` so
    // the default demo can render uniform rows for the screenshot
    // walkthrough. This spec MUST set the flag to exercise the
    // `getRowHeight` callback wiring.
    await page.goto('/?stress=light&variableHeights=1');
    await page.waitForFunction(
      () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
      null,
      { timeout: 20_000 },
    );
  });

  test('viewport surfaces a mix of row heights (tall + fallback)', async ({ page }) => {
    // Walk a small window of visible rows and collect their pixel heights.
    // The demo rule produces ≥ 2 distinct heights within any window of 20+
    // rows because it picks ~1 in 4 rows for the 56-px override.
    const heights = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const out: number[] = [];
      for (let i = 0; i < 25; i++) {
        const b = grid.getRowBoundsAt(i);
        if (b) out.push(b.h);
      }
      return out;
    });
    expect(heights.length).toBeGreaterThan(10);
    const unique = new Set(heights);
    expect(unique.size).toBeGreaterThanOrEqual(2);
    // At least one row carries the 56-px override.
    expect(heights).toContain(56);
  });

  test('per-row heights are content-keyed: same rule fires at the right rows', async ({ page }) => {
    // For each visible row, recompute the expected height from positionId
    // using the same rule the demo wires into `getRowHeight`. The painted
    // height must match.
    const rows = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const out: { rowIndex: number; positionId: string; height: number }[] = [];
      for (let i = 0; i < 25; i++) {
        const b = grid.getRowBoundsAt(i);
        const id = grid.getCellValue(i, 'positionId');
        if (b && typeof id === 'string') out.push({ rowIndex: i, positionId: id, height: b.h });
      }
      return out;
    });
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      const last = r.positionId.charCodeAt(r.positionId.length - 1);
      const expected = last % 4 === 0 ? 56 : r.height; // fallback rows take whatever the global is
      // For overridden rows the height must be exactly 56; for non-overridden
      // rows we only assert they are NOT 56 (a different value, the global).
      if (last % 4 === 0) {
        expect(r.height, `row ${r.rowIndex} (${r.positionId}) should be tall`).toBe(expected);
      } else {
        expect(r.height, `row ${r.rowIndex} (${r.positionId}) should be fallback height`).not.toBe(56);
      }
    }
  });

  test('row tops accumulate variable heights (no overlap, no gap)', async ({ page }) => {
    // Each row's bottom must equal the next row's top — the per-row
    // accumulator in computeViewport positions variable-height rows without
    // gaps or overlap within the visible window.
    const bounds = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      const out: { y: number; h: number }[] = [];
      for (let i = 0; i < 15; i++) {
        const b = grid.getRowBoundsAt(i);
        if (b) out.push(b);
      }
      return out;
    });
    expect(bounds.length).toBeGreaterThan(5);
    for (let i = 0; i < bounds.length - 1; i++) {
      const here = bounds[i]!;
      const next = bounds[i + 1]!;
      // Floating-point slop: 0.5 px is generous given everything's whole-px.
      expect(Math.abs(here.y + here.h - next.y)).toBeLessThan(0.5);
    }
  });
});
