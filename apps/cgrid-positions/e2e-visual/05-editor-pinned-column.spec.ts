import { test, expect } from '@playwright/test';
import { setupGrid, silenceCaret, waitForFrames } from './_setup';

// Cycle 12 / Task 5 — DOM editor on a pinned-left column (`cusip`). The
// pinned-band path is the second half of commit `d06d703`: the focus
// ring + editor must stay inside `[0, bodyLeft]` for pinned-left
// columns. If the band check breaks, the DOM input overshoots into the
// center band and the snapshot diff catches it.
test('editor open on pinned-left column (cusip) — DOM input over pinned band', async ({ page }) => {
  await setupGrid(page, 50);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __velocity-grid: { openEditor: (rowIndex: number, colId: string) => void };
    }).__cgrid;
    g.openEditor(3, 'cusip');
  });
  await silenceCaret(page);
  await waitForFrames(page, 8);
  await expect(page).toHaveScreenshot('05-editor-pinned-column.png');
});
