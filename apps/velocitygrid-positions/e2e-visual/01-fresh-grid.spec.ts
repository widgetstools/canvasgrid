import { test, expect } from '@playwright/test';
import { setupGrid } from './_setup';

// Cycle 12 / Task 5 — baseline snapshot. 50 deterministic rows, dark theme,
// no focus, no edits, no side bar. Anchors the "default" visual state every
// other matrix cell drifts from. Catches sweeping regressions (font swap,
// chrome shift, header re-layout) that the more targeted specs would miss.
test('fresh grid — 50 rows, dark theme, no overlays', async ({ page }) => {
  await setupGrid(page, 50);
  await expect(page).toHaveScreenshot('01-fresh-grid.png');
});
