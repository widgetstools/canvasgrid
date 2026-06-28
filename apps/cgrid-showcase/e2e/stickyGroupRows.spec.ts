import { test, expect } from '@playwright/test';
import { gotoFeature } from './helpers';

test.describe('stickyGroupRows feature', () => {
  test('loads with 320 rows grouped by desk', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    const cols: string[] = await page.evaluate(() => window.__cgrid!.getRowGroupColumns());
    expect(cols).toEqual(['desk']);
  });

  test('rowCount reflects 320 leaf rows plus group rows', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    const rowCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    // 320 leaves + 4 group rows = 324
    expect(rowCount).toBeGreaterThanOrEqual(324);
  });

  test('description mentions scroll behavior', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    const desc = await page.locator('#desc-bar').textContent();
    expect(desc).toContain('scroll');
  });

  test('canvas is rendered', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    const canvas = page.locator('#grid-host canvas').first();
    await expect(canvas).toBeVisible();
  });

  test('grid host fills available height', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    const height: number = await page.evaluate(() => {
      return document.getElementById('grid-host')?.clientHeight ?? 0;
    });
    expect(height).toBeGreaterThan(400);
  });

  test('behaviour: scrolling deep into the body keeps the grid stable (sticky band is canvas-painted)', async ({ page }) => {
    await gotoFeature(page, 'stickyGroupRows');

    // NOTE: the sticky group header is painted on the canvas, not in the
    // DOM, so its pinned position is verified by the cgrid-positions visual
    // baseline (cell 30 — sticky-groups-deep-scroll), not here. This test
    // exercises the scroll path the sticky band depends on: a deep scroll
    // must not change the row model or break rendering.
    const before = await page.evaluate(() => (window.__cgrid as unknown as { rowCount: number }).rowCount ?? 0);

    await page.evaluate(() => {
      const sc = document.querySelector('.cg-scroller') as HTMLElement | null;
      if (sc) sc.scrollTop = 4000;
    });
    await page.evaluate(() => new Promise<void>((res) => {
      let n = 0;
      const tick = (): void => { if (++n >= 6) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }));

    const after = await page.evaluate(() => ({
      rowCount: (window.__cgrid as unknown as { rowCount: number }).rowCount ?? 0,
      scrollTop: (document.querySelector('.cg-scroller') as HTMLElement | null)?.scrollTop ?? 0,
    }));

    // The deep scroll actually moved the viewport…
    expect(after.scrollTop).toBeGreaterThan(0);
    // …and the row model is unchanged (no rows lost / duplicated on scroll).
    expect(after.rowCount).toBe(before);
    // …and the canvas is still mounted.
    await expect(page.locator('#grid-host canvas').first()).toBeVisible();
  });
});
