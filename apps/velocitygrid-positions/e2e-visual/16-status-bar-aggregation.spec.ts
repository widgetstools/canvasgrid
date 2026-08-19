import { test, expect } from '@playwright/test';
import { gridReadyWithQuery, seedGrid, waitForFrames } from './_setup';

// Cycle 13 / Task 3 — agAggregationComponent. Visual baseline for the
// agg panel rendering 5 stats inline (Count · Sum · Min · Max · Avg)
// over a 10-row range across 2 numeric columns. The bar's left zone
// holds the agg panel; the right zone holds the
// TotalAndFilteredRowCountComponent + the SelectedRowCountComponent
// (the demo `?statusBar=full` mode wires that exact layout).
//
// What regression this catches:
//   - Separator regression: if the `·` lost its `padding: 0 0.5ch`,
//     the stats would crash into one another and become unparseable.
//     If the separator colour shifted off `--vg-status-bar-fg-muted`
//     to the full-strength foreground, it would read as data instead
//     of chrome.
//   - Empty-state inversion broken: the spec stages a real selection
//     so the panel MUST be visible. If a refactor flipped the
//     `hidden = false` logic on `refresh()`, the agg panel would
//     vanish and the diff would catch it as the left zone going
//     blank.
//   - Canonical stat order regression: if `aggFuncs` ordering started
//     winning over canonical order (decision 3 broken), the rendered
//     sequence would diff — e.g. `Avg: 12 · Count: 10` instead of
//     `Count: 10 · Sum: 460 · Min: 41 · Max: 50 · Avg: 45.5`.
//   - en-US comma + 2-fraction-digit default vanishing: if a future
//     change swapped in a different formatter, the rendered stats
//     would diff (e.g. `Sum: 460.00` vs `Sum: 460`, or `Avg: 45.5` vs
//     `Avg: 45,5`).
//   - Inter-zone gap regression: the agg panel sits in the left zone,
//     counts in the right zone. If the three-zone flex collapsed,
//     they'd touch or overlap and the diff would catch it.
//
// Test setup: 50 deterministic rows (same generator as every other
// matrix cell) + `?statusBar=full` to mount agg-left + counts-right.
// Then stage a range on rows 0..9 across `yield` (1..10 range) and
// `spread` (5..100 range). A 2-column × 10-row range produces a
// 20-cell selection; Count = 20, numerics aggregate across both
// columns. Small-value columns are picked deliberately so the
// rendered `Avg: NN.NN` stat doesn't truncate inside the left zone
// (which is 1/3 of a 1440px bar = ~480px). Truncation of the
// trailing stat is the documented cliff behaviour at narrow
// viewports — but the baseline cell tests the canonical case where
// every stat reads cleanly. See design notes acceptance criterion
// for cell 16 in `cycle-13-statusbar-design.md` § Task 3.
test('status bar — agAggregationComponent rendering 5 stats over a 10-row range', async ({ page }) => {
  await gridReadyWithQuery(page, '?statusBar=full');
  await seedGrid(page, 50);
  await waitForFrames(page, 12);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __cgrid: {
        addCellRange: (range: { rowStart: number; rowEnd: number; colIds: string[] }) => void;
      };
    }).__cgrid;
    g.addCellRange({
      rowStart: 0,
      rowEnd: 9,
      colIds: ['yield', 'spread'],
    });
  });
  // Settle once more so the cellSelectionChanged listener has run
  // refresh() and the DOM mutation paints.
  await waitForFrames(page, 6);
  await expect(page).toHaveScreenshot('16-status-bar-aggregation.png');
});
