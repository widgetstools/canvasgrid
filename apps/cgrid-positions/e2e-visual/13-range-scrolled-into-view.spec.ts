import { test, expect } from '@playwright/test';
import { scrollTo, setupGrid, waitForFrames } from './_setup';

// Regression for the bug PR #51 fixes: Cycle 12 / Task 2 refactored
// rangeOverlayPainter to resolve the range's top-left + bottom-right
// corner cells through `getVisibleCellBounds`. The helper returns null
// for cells in overscan above bodyTop / below bodyBottom — so a large
// range whose top row had scrolled out of the body band caused the
// painter to skip the ENTIRE range, even though the middle was
// on-screen.
//
// Matrix cell 06 (`06-range-across-viewports.spec.ts`) didn't catch
// this because its range stays fully in the viewport. This cell
// explicitly scrolls so the range's first row goes out of view, then
// snapshots: the visible middle (rows 100..115) must show the
// translucent fill + opaque border. A regression that reintroduces
// the corner-cell-based painter would paint nothing here and fail
// the diff.
test('range overlay paints visible middle when top + bottom rows scrolled out of view', async ({ page }) => {
  await setupGrid(page, 500);

  // Range spans 5..400 across two center columns. With 500 rows the
  // grid will be tall enough that scrolling to row ~100 puts the
  // top of the range (row 5) far above bodyTop and the bottom
  // (row 400) far below bodyBottom.
  await page.evaluate(() => {
    const g = (window as unknown as {
      __cgrid: {
        addCellRange: (range: { rowStart: number; rowEnd: number; colIds: string[] }) => void;
      };
    }).__cgrid;
    g.addCellRange({
      rowStart: 5,
      rowEnd: 400,
      colIds: ['marketValue', 'currentPrice'],
    });
  });
  await waitForFrames(page, 4);

  // Scroll to ~row 100 (32 px row height × 100). The range still
  // exists in the model; the painter must show its visible portion.
  await scrollTo(page, 0, 3200);
  await waitForFrames(page, 8);

  // Functional assertion BEFORE the snapshot — proves the range is
  // still in the model and didn't get dropped by some unrelated bug.
  // Keeps the snapshot diff diagnostic narrow to the painter.
  const rangeCount = await page.evaluate(() => {
    return (window as unknown as {
      __cgrid: { getCellRanges: () => unknown[] };
    }).__cgrid.getCellRanges().length;
  });
  expect(rangeCount).toBe(1);

  await expect(page).toHaveScreenshot('13-range-scrolled-into-view.png');
});
