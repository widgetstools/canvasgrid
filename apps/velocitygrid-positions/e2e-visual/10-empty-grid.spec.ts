import { test, expect } from '@playwright/test';
import { setupGrid } from './_setup';

// Cycle 12 / Task 5 — empty-state regression cell. 0 rows. Commit
// `ef0a879` fixed the phantom vertical scrollbar that appeared even
// when the grid had no data (the scroller `sizer` was getting a
// height > body height); a regression renders a scrollbar gutter that
// should not exist, shifting every pixel right of it.
test('empty grid — 0 rows, no phantom scrollbars', async ({ page }) => {
  await setupGrid(page, 0);
  await expect(page).toHaveScreenshot('10-empty-grid.png');
});
