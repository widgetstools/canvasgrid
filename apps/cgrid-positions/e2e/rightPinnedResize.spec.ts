/**
 * Right-pinned column resize via left-edge drag.
 *
 * The user can now grab the LEFT edge of a right-pinned column header and
 * drag it to grow/shrink the column — mirroring the right-edge drag UX on
 * left-pinned + center columns. Dragging the left edge LEFT grows the
 * column (its right edge stays anchored to the canvas right edge);
 * dragging RIGHT shrinks it.
 *
 * Verifies via `getHeaderBoundsAt('pnl')` width before/after.
 */
import { test, expect, type Page } from '@playwright/test';

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?stress=light&pinning=on');
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

interface GridApi {
  getHeaderBoundsAt(colId: string): { x: number; y: number; w: number; h: number } | null;
}

test.describe('right-pinned column resize via left-edge drag', () => {
  test('dragging the left edge of pnl LEFT grows the column', async ({ page }) => {
    await gridReady(page);

    const before = await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApi }).__cgrid;
      return grid.getHeaderBoundsAt('pnl');
    });
    expect(before).not.toBeNull();

    // getHeaderBoundsAt returns canvas-relative coords; mouse events take
    // page coords. Translate by the canvas's bounding-rect offset.
    const off = await page.evaluate(() => {
      const c = document.querySelector('#grid canvas') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top };
    });

    // Mousedown 2 px inside the left edge of the pnl header (inside the
    // 4 px resize hot zone), drag 30 px to the left, release.
    const startX = off.x + before!.x + 2;
    const y = off.y + before!.y + before!.h / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - 30, y, { steps: 6 });
    await page.mouse.up();

    const after = await page.evaluate(() => {
      const grid = (window as unknown as { __velocity-grid: GridApi }).__cgrid;
      return grid.getHeaderBoundsAt('pnl');
    });
    expect(after).not.toBeNull();
    // Column width grew by ~30 px (allow ±4 for hot-zone offset + sub-pixel rounding).
    expect(after!.w - before!.w).toBeGreaterThan(20);
    expect(after!.w - before!.w).toBeLessThan(40);
  });
});
