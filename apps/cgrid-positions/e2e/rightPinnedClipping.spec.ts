/**
 * Regression — right-pinned column right edge stays inside the canvas
 * drawable area. Before the fix, `computeCurrentViewport` passed
 * `scroller.clientWidth` as `containerWidth`, but the canvas drawable area
 * is `scroller.clientWidth − scrollbarThickness` on overlay-scrollbar
 * platforms (macOS). The mismatch let the rightmost right-pinned column
 * extend `scrollbarThickness` pixels past the canvas right edge — visible
 * as a truncated last digit on values in the `Total` (pnl) column.
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

test.describe('right-pinned column right-edge clipping', () => {
  test('rightmost pinned column right-edge equals canvas drawable width', async ({ page }) => {
    await gridReady(page);

    const result = await page.evaluate(() => {
      const grid = (window as unknown as {
        __velocity-grid: { getHeaderBoundsAt(id: string): { x: number; y: number; w: number; h: number } | null };
      }).__cgrid;
      const bounds = grid.getHeaderBoundsAt('pnl');
      const canvas = document.querySelector('#grid canvas') as HTMLCanvasElement;
      const cssWidth = canvas.getBoundingClientRect().width;
      return { bounds, cssWidth };
    });

    expect(result.bounds).not.toBeNull();
    const colRight = result.bounds!.x + result.bounds!.w;
    // The rightmost pinned column's right edge must equal the canvas CSS width
    // within sub-pixel tolerance. Before the fix, colRight exceeded cssWidth by
    // the scrollbar gutter (10 px default).
    expect(Math.abs(colRight - result.cssWidth)).toBeLessThan(1);
  });
});
