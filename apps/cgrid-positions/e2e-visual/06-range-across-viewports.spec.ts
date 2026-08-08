import { test, expect } from '@playwright/test';
import { setupGrid, waitForFrames } from './_setup';

// Cycle 12 / Task 5 — range overlay spanning visible + non-visible rows.
// Commit `1a9870a` shipped this case (range drag past the viewport must
// keep the off-screen rows in the range); commit `01fb141` clipped the
// range overlay to the scrollable body region so its top/bottom edges
// do not paint over the header strip. Both ends regress visibly — a
// blue band crossing the header (or stopping short of the focused cell)
// fails the diff.
test('range overlay across visible + non-visible rows — body clip + band clip', async ({ page }) => {
  await setupGrid(page, 50);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __velocity-grid: {
        addCellRange: (range: { rowStart: number; rowEnd: number; colIds: string[] }) => void;
      };
    }).__cgrid;
    g.addCellRange({
      rowStart: 2,
      rowEnd: 40,
      colIds: ['ticker', 'notionalAmount', 'marketValue', 'currentPrice'],
    });
  });
  await waitForFrames(page, 8);
  await expect(page).toHaveScreenshot('06-range-across-viewports.png');
});
