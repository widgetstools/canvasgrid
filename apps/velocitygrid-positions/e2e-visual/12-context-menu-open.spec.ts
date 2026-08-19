import { test, expect } from '@playwright/test';
import { setupGrid, waitForFrames } from './_setup';

// Cycle 12 / Task 5 — context menu open. Right-clicks a body cell to
// mount the menu; the demo's `getContextMenuItems` mixes the full
// default registry with one custom "Clear filters" entry. The snapshot
// gates the menu's typography, icon column, separator placement, and
// hover-target backgrounds — the Cycle 10 task that shipped this menu
// regressed twice (`docs/catalog/screenshots/19-context-menu-default.png`
// is the canonical shape).
test('context menu open on a body cell — default registry + custom entry', async ({ page }) => {
  await setupGrid(page, 50);
  const bounds = await page.evaluate(() => {
    const g = (window as unknown as {
      __cgrid: {
        getCellBoundsAt: (r: number, c: string) => { x: number; y: number; w: number; h: number } | null;
      };
    }).__cgrid;
    return g.getCellBoundsAt(5, 'currentPrice');
  });
  if (!bounds) throw new Error('cell bounds for (5, currentPrice) not available');
  const canvasBox = await page.locator('#grid canvas').boundingBox();
  if (!canvasBox) throw new Error('canvas bounding box not available');
  await page.mouse.click(
    canvasBox.x + bounds.x + bounds.w / 2,
    canvasBox.y + bounds.y + bounds.h / 2,
    { button: 'right' },
  );
  await page.waitForSelector('.vg-context-menu', { state: 'visible' });
  await waitForFrames(page, 6);
  await expect(page).toHaveScreenshot('12-context-menu-open.png');
});
