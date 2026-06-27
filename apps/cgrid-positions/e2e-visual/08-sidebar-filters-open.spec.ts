import { test, expect } from '@playwright/test';
import { setupGrid, waitForFrames } from './_setup';

// Cycle 12 / Task 5 — side bar Filters tool panel open. Same redesign-
// saga family as spec 07 but for the Filters panel (different chrome,
// different per-row controls). Catches commits in the same Cycle 11
// cluster that shifted the filter-row layout (`a1055c5`, `4226dc3`).
test('side bar — Filters panel open on the right', async ({ page }) => {
  await setupGrid(page, 50);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __cgrid: { openToolPanel: (id: string) => void };
    }).__cgrid;
    g.openToolPanel('agFiltersToolPanel');
  });
  await waitForFrames(page, 8);
  await expect(page).toHaveScreenshot('08-sidebar-filters-open.png');
});
