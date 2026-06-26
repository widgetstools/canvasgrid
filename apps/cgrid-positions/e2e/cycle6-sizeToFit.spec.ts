/**
 * Cycle 6 / Task 3 — sizeColumnsToFit.
 *
 * Click the toolbar "Fit columns" button and assert the sum of visible
 * column widths matches the canvas drawable width (within rounding
 * tolerance). The `positionId` column carries `suppressSizeToFit: true`,
 * so its width must remain unchanged.
 */
import { test, expect } from '@playwright/test';

interface ColumnStateEntry {
  colId: string;
  width?: number;
  hide?: boolean;
}

interface GridApiSurface {
  getColumnState: () => ColumnStateEntry[];
  sizeColumnsToFit: (params?: {
    width?: number;
    defaultMinWidth?: number;
    defaultMaxWidth?: number;
    columnLimits?: Array<{ key: string; minWidth?: number; maxWidth?: number }>;
  }) => void;
}

async function gridReady(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?stress=light');
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

test.describe('Cycle 6 / Task 3 — sizeColumnsToFit', () => {
  test('Fit columns absorbs the canvas width while honoring suppressSizeToFit', async ({ page }) => {
    await gridReady(page);

    const before = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getColumnState();
    });
    const beforePosId = before.find((e) => e.colId === 'positionId');
    expect(beforePosId?.width).toBeDefined();

    // Read the canvas drawable width so we know what the fit pass targets.
    const canvasWidth = await page.evaluate(() => {
      const canvas = document.querySelector('.grid-host canvas') as HTMLCanvasElement | null;
      if (!canvas) throw new Error('canvas not found');
      // Canvas is sized in CSS pixels via its style — use clientWidth.
      return canvas.clientWidth;
    });
    expect(canvasWidth).toBeGreaterThan(0);

    await page.click('#fit-columns');
    await page.evaluate(
      () => new Promise<void>((res) => {
        let n = 0;
        const tick = () => (++n >= 6 ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    );

    const after = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getColumnState();
    });

    // suppressSizeToFit holds positionId at its pre-fit width.
    const afterPosId = after.find((e) => e.colId === 'positionId');
    expect(afterPosId?.width).toBe(beforePosId?.width);

    // Sum of every visible leaf width fills the canvas, within a small
    // rounding tolerance (the algorithm floors per-column widths and
    // routes the remainder to the right-most unclamped leaf so the total
    // matches exactly — allow ±2 px for hidden vs. visible leaves).
    const visibleSum = after
      .filter((e) => e.hide !== true)
      .reduce((s, e) => s + (e.width ?? 0), 0);
    expect(Math.abs(visibleSum - canvasWidth)).toBeLessThanOrEqual(2);
  });
});
