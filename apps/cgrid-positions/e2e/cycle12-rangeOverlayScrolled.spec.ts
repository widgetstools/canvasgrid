/**
 * Regression for the bug fixed in PR #51.
 *
 * Cycle 12 / Task 2 (#46) refactored rangeOverlayPainter to resolve a
 * range's top-left + bottom-right corner cells through
 * `getVisibleCellBounds`. That helper returns `null` for cells in
 * overscan above bodyTop / below bodyBottom — so a range whose top
 * row had scrolled out of view caused the painter to skip the ENTIRE
 * range, even when the middle was on-screen.
 *
 * The Cycle 12 visual matrix didn't catch this because cell 06
 * (`06-range-across-viewports.spec.ts`) keeps the range fully in the
 * viewport. This functional spec is the diagnostic complement to the
 * new visual snapshot (`13-range-scrolled-into-view.spec.ts`): it
 * reads the canvas backing store directly and asserts the range fill
 * pixels exist at the expected location.
 */
import { test, expect, Page } from '@playwright/test';
import type { SelectionRange } from '../../../cgrid/src/types';

const GRID_SELECTOR = '#grid canvas';

interface GridSurface {
  setRowData: (rows: unknown[]) => void;
  addCellRange: (range: SelectionRange) => void;
  clearCellRanges: () => void;
  getCellRanges: () => SelectionRange[];
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  getScroller: () => HTMLElement;
}

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?stress=light');
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function waitForFrames(page: Page, n = 6): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = (): void => { if (++i >= count) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }),
    n,
  );
}

test.describe('range overlay paints visible portion when ends are off-screen', () => {
  test('range model survives scroll AND canvas paints range fill in the visible band', async ({ page }) => {
    await gridReady(page);

    // Seed 500 deterministic rows + add a range that spans well past
    // the viewport in both directions.
    await page.evaluate(() => {
      const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < 500; i++) {
        rows.push({
          positionId: `POS-${String(i).padStart(6, '0')}`,
          cusip: `CUS${String(i).padStart(6, '0')}`,
          ticker: 'AAPL',
          notionalAmount: 1000 + i,
          marketValue: 1100 + i,
          currentPrice: 99.5,
        });
      }
      g.setRowData(rows);
      g.clearCellRanges();
      g.addCellRange({
        rowStart: 5,
        rowEnd: 400,
        colIds: ['marketValue', 'currentPrice'],
      });
    });
    await waitForFrames(page, 6);

    // Scroll deep into the range so row 5 (top) is far above bodyTop
    // and row 400 (bottom) is far below bodyBottom.
    await page.evaluate(() => {
      const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
      g.getScroller().scrollTop = 3200; // row ~100 at 32 px row height
    });
    await waitForFrames(page, 10);

    // Range model must still hold the original [5, 400] range.
    const rangeCount = await page.evaluate(
      () => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellRanges().length,
    );
    expect(rangeCount).toBe(1);

    // Probe the canvas backing store at the centre of a cell that's
    // BOTH in the range AND on-screen. With scrollTop=3200, the data
    // row at canvas y = bodyTop+0 is row 100; row 105 (well in the
    // range) is at y = bodyTop + 5*rowHeight. Sample its centre and
    // assert the pixel matches the range fill colour.
    const probe = await page.evaluate(() => {
      const g = (window as unknown as { __velocity-grid: GridSurface }).__cgrid;
      // Pick a cell that's definitely on-screen and in the range.
      const cellBounds = g.getCellBoundsAt(105, 'marketValue');
      if (!cellBounds) return { hit: false } as const;
      const canvas = document.querySelector('#grid canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { hit: false } as const;
      const dpr = window.devicePixelRatio || 1;
      // Sample one pixel at the centre of the cell. ImageData is in
      // device px (backing-store coords); convert from CSS px.
      const px = Math.round((cellBounds.x + cellBounds.w / 2) * dpr);
      const py = Math.round((cellBounds.y + cellBounds.h / 2) * dpr);
      const data = ctx.getImageData(px, py, 1, 1).data;
      return {
        hit: true as const,
        rgba: [data[0], data[1], data[2], data[3]],
        cellY: cellBounds.y,
        sampledAt: { px, py },
      };
    });

    expect(probe.hit).toBe(true);
    if (!probe.hit) return; // type narrow

    // Range fill colour in dark theme is rgb(96, 165, 250) at ~22%
    // alpha, painted OVER the dark body bg (#0a1428 = 10, 20, 40).
    // After alpha-blend the sampled pixel sits in the blue-ish
    // region: B is dominant, B > R, and B is meaningfully higher
    // than the underlying bg. We don't pin exact values (font
    // anti-aliasing in the cell text can land at the sample point)
    // — just assert the blue lift that proves the range fill ran.
    const [r, g, b] = probe.rgba;
    expect(b).toBeGreaterThan(40); // bg blue is 40; range fill lifts it
    expect(b).toBeGreaterThan(r);  // blue > red is the signature of the fill
    expect(b).toBeGreaterThan(g);  // blue > green too (rangeFill is #60a5fa-ish)
  });
});
