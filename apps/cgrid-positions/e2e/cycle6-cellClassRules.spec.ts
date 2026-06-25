/**
 * Cycle 6 / Task 7 — cellClass / cellClassRules / cellStyle (function form) /
 * headerClass via theme-driven variants.
 *
 * Asserts that `getCellPaintedBg` returns the correct variant background for
 * a positive `pnl` cell (#e7f7ec) and a negative `pnl` cell (#fde7e9),
 * proving that the cellClassRules predicates are evaluated at paint time and
 * the CSS-variable-backed variants are applied correctly.
 *
 * The test reaches into `window.__cgrid` (exposed by main.js) and calls
 * `getCellPaintedBg(rowIndex, colId)` — a 5-line public API method that runs
 * the same `applyCellProps` path as the real painter but on a throwaway config
 * object, returning `config.bg`. This avoids canvas pixel sampling and is
 * deterministic regardless of scroll position.
 */
import { test, expect } from '@playwright/test';

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  // Wait several animation frames so the first chunk has been chunked and
  // painted — `getCellPaintedBg` relies on `cellAt` finding a cell in the
  // current viewport chunk.
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

interface GridRuntime {
  getCellPaintedBg: (rowIndex: number, colId: string) => string | null;
  getCellValue: (rowIndex: number, colId: string) => unknown;
}

/**
 * Find the first row index within the first 30 rows where the pnl cell has
 * a value matching the predicate. Returns -1 when none found.
 */
async function findRowByPnlSign(
  page: import('@playwright/test').Page,
  sign: 'positive' | 'negative',
): Promise<number> {
  return page.evaluate((sign) => {
    const grid = (window as unknown as { __cgrid: GridRuntime }).__cgrid;
    for (let i = 0; i < 30; i++) {
      const val = grid.getCellValue(i, 'pnl');
      const n = typeof val === 'number' ? val : Number(val);
      if (!Number.isFinite(n)) continue;
      if (sign === 'positive' && n > 0) return i;
      if (sign === 'negative' && n < 0) return i;
    }
    return -1;
  }, sign);
}

test.describe('Cycle 6 / Task 7 — cellClassRules theme-driven variants', () => {
  test('positive pnl cell gets #e7f7ec bg, negative pnl cell gets #fde7e9 bg', async ({ page }) => {
    await gridReady(page);

    // Find a positive pnl row and a negative pnl row within the first 30 rows.
    const posRow = await findRowByPnlSign(page, 'positive');
    const negRow = await findRowByPnlSign(page, 'negative');

    // Guard: if the STOMP snapshot didn't produce both signs in the first 30
    // rows we skip rather than fail — this is a data availability issue, not
    // a feature bug.
    test.skip(posRow === -1, 'No positive pnl row in first 30 rows');
    test.skip(negRow === -1, 'No negative pnl row in first 30 rows');

    const posBg = await page.evaluate((row) => {
      const grid = (window as unknown as { __cgrid: GridRuntime }).__cgrid;
      return grid.getCellPaintedBg(row, 'pnl');
    }, posRow);

    const negBg = await page.evaluate((row) => {
      const grid = (window as unknown as { __cgrid: GridRuntime }).__cgrid;
      return grid.getCellPaintedBg(row, 'pnl');
    }, negRow);

    // The CSS variables declare:
    //   --cg-cell-class-positive-bg: #e7f7ec
    //   --cg-cell-class-negative-bg: #fde7e9
    // getCellPaintedBg returns the literal string from the variant map,
    // which is the raw CSS variable value.
    expect(posBg).toBe('#e7f7ec');
    expect(negBg).toBe('#fde7e9');
  });
});
