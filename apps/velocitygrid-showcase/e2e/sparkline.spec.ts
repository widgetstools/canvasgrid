import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('sparkline feature', () => {
  test('loads and shows the variant toolbar with line as the active pill', async ({ page }) => {
    await gotoFeature(page, 'sparkline');

    // Five variant buttons, line is active by default.
    for (const v of ['line', 'column', 'area', 'bar', 'pie']) {
      await expect(page.getByTestId(`btn-spark-${v}`)).toBeVisible();
    }
    await expect(page.getByTestId('btn-spark-line')).toHaveClass(/primary/);
    await expect(page.getByTestId('btn-spark-column')).not.toHaveClass(/primary/);
  });

  test('cycling the variant updates the active pill', async ({ page }) => {
    await gotoFeature(page, 'sparkline');

    for (const v of ['column', 'area', 'bar', 'pie', 'line']) {
      await page.getByTestId(`btn-spark-${v}`).click();
      await expect(page.getByTestId(`btn-spark-${v}`)).toHaveClass(/primary/);
    }
  });

  test('grid mounts 10 ticker rows with sparkline data on the priceHistory column', async ({ page }) => {
    await gotoFeature(page, 'sparkline');
    const rowCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    expect(rowCount).toBe(10);
  });

  test('description bar mentions Cycle 21', async ({ page }) => {
    await gotoFeature(page, 'sparkline');
    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('Cycle 21');
  });

  test('switching to the pie variant relabels the sparkline column', async ({ page }) => {
    await gotoFeature(page, 'sparkline');
    await page.getByTestId('btn-spark-pie').click();
    // Read the resolved headerName via the columnDefsMap; canvas-painted
    // text isn't in the DOM so we ask the API.
    const headerName: string = await page.evaluate(() => {
      const def = (window.__cgrid as any)?.columnDefsMap.get('priceHistory');
      return def?.headerName ?? '';
    });
    expect(headerName).toBe('vs. rolling high');
  });

  test('hovering a sparkline cell shows the shared tooltip overlay', async ({ page }) => {
    await gotoFeature(page, 'sparkline');

    // Tooltip element only mounts after the first sparkline-cell mousemove,
    // so wait for it to appear once we move into the 4th column area.
    const canvas = page.locator('#grid-host canvas').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // Sparkline column starts at x ≈ ticker(100) + last(100) + change(110) = 310.
    // Hover roughly in the middle of the first data row.
    await page.mouse.move(box!.x + 410, box!.y + 60);
    const tooltip = page.locator('.vg-sparkline-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/\d+/);
  });
});
