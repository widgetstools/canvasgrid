import { test, expect } from '@playwright/test';
import { scrollTo, setupGrid, waitForFrames } from './_setup';

// Cycle 12 / Task 5 — horizontal scroll regression cell. Focus on a center
// column, then scroll right enough that the focused cell slides UNDER the
// pinned-left band (positionId + cusip). The focus ring must NOT leak into
// the pinned bands (commit `d06d703`) AND the floating-filter input row
// must hide the inputs whose columns scrolled into a foreign band
// (commit `82bd786` — marketValue input bleeding into CUSIP).
test('horizontally scrolled grid — center column under pinned-left band', async ({ page }) => {
  await setupGrid(page, 50);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __velocity-grid: { setFocusedCell: (rowId: string, colId: string) => void };
    }).__cgrid;
    g.setFocusedCell('POS-000003', 'currentPrice');
  });
  await waitForFrames(page, 4);
  await scrollTo(page, 500, 0);
  await waitForFrames(page, 8);
  await expect(page).toHaveScreenshot('03-scrolled-horizontal.png');
});
