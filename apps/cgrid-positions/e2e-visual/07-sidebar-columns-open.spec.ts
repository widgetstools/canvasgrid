import { test, expect } from '@playwright/test';
import { setupGrid, waitForFrames } from './_setup';

// Cycle 12 / Task 5 — side bar Columns tool panel open. Catches the
// Cycle 11 redesign-saga regressions (`f424c48`, `5d9e458`, `d1eff31`,
// `a1055c5`, `4226dc3`) that each shifted the panel chrome by a few
// pixels in different directions. The cycle-11 functional E2Es prove
// the toggle works; this snapshot proves the panel still LOOKS right.
test('side bar — Columns panel open on the right', async ({ page }) => {
  await setupGrid(page, 50);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __cgrid: { openToolPanel: (id: string) => void };
    }).__cgrid;
    g.openToolPanel('agColumnsToolPanel');
  });
  await waitForFrames(page, 8);
  await expect(page).toHaveScreenshot('07-sidebar-columns-open.png');
});
