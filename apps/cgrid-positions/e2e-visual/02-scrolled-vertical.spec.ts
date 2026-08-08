import { test, expect } from '@playwright/test';
import { scrollTo, setupGrid, waitForFrames } from './_setup';

// Cycle 12 / Task 5 — vertical scroll regression cell. 200 rows so the
// scroller can drive a meaningful scrollTop; focus a body cell BEFORE
// the scroll so the focus ring has somewhere to leak to if the band-clip
// regresses (commit `01fb141` — focus ring + range overlay must clip to
// the scrollable body region) AND the editor-sync rule has a cell to
// react to (commit `d302071` — editor commits + closes when its cell
// scrolls past the body band, which means there must be NO DOM editor
// floating over the header strip at snapshot time).
test('vertically scrolled grid — focus + body scroll past anchor row', async ({ page }) => {
  await setupGrid(page, 200);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __velocity-grid: { setFocusedCell: (rowId: string, colId: string) => void };
    }).__cgrid;
    g.setFocusedCell('POS-000002', 'currentPrice');
  });
  await waitForFrames(page, 4);
  await scrollTo(page, 0, 800);
  await waitForFrames(page, 8);
  await expect(page).toHaveScreenshot('02-scrolled-vertical.png');
});
