/**
 * Cycle 18 / Task 7 — screenshot capture (verification-only, not coverage).
 *
 * Snapshots the header context menu with Task 7 pivot items + the
 * "Value: Aggregate <col>" submenu open so the task summary can show
 * the rendered chrome. Not added to the regression suite — re-run
 * manually via `npx playwright test e2e/cycle18-task7-screenshots.spec.ts`.
 */
import { test, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';
const MENU_SELECTOR = '.vg-context-menu';

interface GridApiSurface {
  getHeaderBoundsAt: (colId: string) => { x: number; y: number; w: number; h: number } | null;
  ensureColumnVisible: (colId: string) => void;
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

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?pivotDemo=on&pivotPanel=always');
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function rightClickHeader(page: Page, colId: string): Promise<void> {
  await page.evaluate(
    (id) => (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.ensureColumnVisible(id),
    colId,
  );
  await waitForFrames(page, 4);
  const bounds = await page.evaluate(
    (id) => (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid.getHeaderBoundsAt(id),
    colId,
  );
  if (!bounds) throw new Error(`no header bounds for ${colId}`);
  const cr = await page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  await page.mouse.click(
    cr.x + bounds.x + bounds.w / 2,
    cr.y + bounds.y + bounds.h / 2,
    { button: 'right' },
  );
  await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });
}

test.describe('Cycle 18 / Task 7 — visual snapshots', () => {
  test('menu with Add to Labels on a pivot-enabled column', async ({ page }) => {
    await gridReady(page);
    await rightClickHeader(page, 'sector');
    await waitForFrames(page, 3);
    await page.screenshot({
      path: 'test-results/cycle18-task7-menu-pivot.png',
      fullPage: false,
    });
  });

  test('menu with Value: Aggregate submenu open', async ({ page }) => {
    await gridReady(page);
    // Seed: notionalAmount as a value column with avg so the submenu paints
    // a check next to "avg" in the screenshot.
    await page.evaluate(() => {
      (window as unknown as { __velocity-grid: { addValueColumn: (c: string, a: string) => void } })
        .__cgrid.addValueColumn('notionalAmount', 'avg');
    });
    await waitForFrames(page, 4);

    await rightClickHeader(page, 'notionalAmount');
    const valueRow = page.locator(`${MENU_SELECTOR} .vg-menu-item`).filter({
      has: page.locator('.vg-menu-item-label', { hasText: /^Value: Aggregate Notional$/ }),
    });
    await valueRow.hover();
    await waitForFrames(page, 4);
    await page.screenshot({
      path: 'test-results/cycle18-task7-menu-value-submenu.png',
      fullPage: false,
    });
  });
});
