import { test, expect } from '@playwright/test';
import { setupGrid, waitForFrames } from './_setup';

// Cycle 12 / Task 5 — side bar position-flipped (mounted on the LEFT
// edge instead of the default right). The `setSideBarPosition('left')`
// branch ships in commit `ea448b5` along with the scrollbar-gutter fix
// — the vertical scrollbar must remain flush with the side bar's inner
// edge regardless of which side the bar lives on. A regression where
// the gutter snaps back to the right pushes the canvas pixels off and
// fails the diff.
test('side bar — Columns panel open on the left', async ({ page }) => {
  await setupGrid(page, 50);
  await page.evaluate(() => {
    const g = (window as unknown as {
      __cgrid: {
        setSideBarPosition: (pos: 'left' | 'right') => void;
        openToolPanel: (id: string) => void;
      };
    }).__cgrid;
    g.setSideBarPosition('left');
    g.openToolPanel('agColumnsToolPanel');
  });
  await waitForFrames(page, 8);
  await expect(page).toHaveScreenshot('09-sidebar-position-left.png');
});
