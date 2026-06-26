/**
 * Cycle 11 / Task 2 — Side bar shell E2E.
 *
 * Exercises the user-visible behaviour of the side bar host shipped by
 * Task 2 against the positions demo (which mounts the side bar via
 * `sideBar: { toolPanels: ['columns', 'filters'] }`):
 *
 *  - the bar mounts on the right edge of the grid root with a vertical
 *    tab strip carrying one button per registered panel;
 *  - clicking a tab opens the matching panel (the tab gets
 *    `aria-pressed="true"`, the panel host receives the panel's
 *    `getGui()` element);
 *  - clicking the same tab again closes the panel (toggle);
 *  - clicking a different tab switches panels (only one open at a
 *    time);
 *  - opening / closing the side bar shrinks / restores the canvas
 *    region so the worker pipeline sees a smaller body width (no
 *    overlap with the side bar);
 *  - dragging the inner-edge resize handle widens the panel; the
 *    canvas region narrows correspondingly.
 *
 * The Task 2 stub panels render an empty `<div class="cg-tool-panel-stub">`.
 * Task 3 replaces the Columns stub with the real `.cg-columns-panel`; Task 4
 * does the same for Filters. This spec only verifies the SHELL behaviour,
 * not panel content — the panel-mount sentinel checks below assert
 * against the live class for whichever tab is being exercised.
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';
const SIDE_BAR_SELECTOR = '.cg-side-bar';
const TAB_SELECTOR = '.cg-side-bar-tab';
const PANEL_SELECTOR = '.cg-side-bar-panel';
const HANDLE_SELECTOR = '.cg-side-bar-resize';

async function waitForFrames(page: Page, n = 6): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = () => (++i >= count ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    n,
  );
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

async function canvasWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    return c ? Math.round(c.getBoundingClientRect().width) : 0;
  });
}

test.describe('Cycle 11 / Task 2 — side bar shell', () => {
  test('the side bar mounts on the right edge with one tab per registered panel', async ({ page }) => {
    await gridReady(page);
    const sb = page.locator(SIDE_BAR_SELECTOR);
    await expect(sb).toBeVisible();
    await expect(sb).toHaveAttribute('data-position', 'right');
    const tabs = page.locator(TAB_SELECTOR);
    await expect(tabs).toHaveCount(2);
    // Labels are vertical (writing-mode), so the DOM `aria-label` is the
    // stable assertion target.
    await expect(tabs.nth(0)).toHaveAttribute('aria-label', 'Columns');
    await expect(tabs.nth(1)).toHaveAttribute('aria-label', 'Filters');
    // No tab pressed at mount when defaultToolPanel is not set.
    await expect(page.locator(`${TAB_SELECTOR}[aria-pressed="true"]`)).toHaveCount(0);
  });

  test('clicking the Columns tab opens the panel; clicking again closes it', async ({ page }) => {
    await gridReady(page);
    const columnsTab = page.locator(`${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`);
    const filtersTab = page.locator(`${TAB_SELECTOR}[data-id="agFiltersToolPanel"]`);
    const panel = page.locator(PANEL_SELECTOR);

    // Initial state — panel hidden (display:none), no mounted GUI.
    await expect(panel).toHaveCSS('display', 'none');

    await columnsTab.click();
    await waitForFrames(page, 3);
    await expect(columnsTab).toHaveAttribute('aria-pressed', 'true');
    await expect(filtersTab).toHaveAttribute('aria-pressed', 'false');
    // Cycle 11 / Task 3 — the Columns tab now mounts the real
    // `.cg-columns-panel` instead of the Task 1 `.cg-tool-panel-stub`.
    await expect(panel.locator('.cg-columns-panel')).toHaveCount(1);
    await expect(panel).not.toHaveCSS('display', 'none');

    await columnsTab.click();
    await waitForFrames(page, 3);
    await expect(columnsTab).toHaveAttribute('aria-pressed', 'false');
    await expect(panel).toHaveCSS('display', 'none');
    await expect(panel.locator('.cg-columns-panel')).toHaveCount(0);
  });

  test('clicking Filters while Columns is open switches panels (only one open at a time)', async ({ page }) => {
    await gridReady(page);
    const columnsTab = page.locator(`${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`);
    const filtersTab = page.locator(`${TAB_SELECTOR}[data-id="agFiltersToolPanel"]`);

    await columnsTab.click();
    await waitForFrames(page, 3);
    await expect(columnsTab).toHaveAttribute('aria-pressed', 'true');

    await filtersTab.click();
    await waitForFrames(page, 3);
    await expect(columnsTab).toHaveAttribute('aria-pressed', 'false');
    await expect(filtersTab).toHaveAttribute('aria-pressed', 'true');
    // Exactly one tab pressed.
    await expect(page.locator(`${TAB_SELECTOR}[aria-pressed="true"]`)).toHaveCount(1);
  });

  test('opening the side bar shrinks the canvas region; closing restores it', async ({ page }) => {
    await gridReady(page);
    const columnsTab = page.locator(`${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`);

    const widthClosed = await canvasWidth(page);

    await columnsTab.click();
    await waitForFrames(page, 6);
    const widthOpen = await canvasWidth(page);
    // The panel is at least 200px wide; canvas should be measurably narrower.
    expect(widthOpen).toBeLessThan(widthClosed - 200);

    await columnsTab.click();
    await waitForFrames(page, 6);
    const widthClosedAgain = await canvasWidth(page);
    // Within a few pixels of the original (the scroller gutter math
    // sometimes shifts by a sub-pixel between resizes).
    expect(Math.abs(widthClosedAgain - widthClosed)).toBeLessThanOrEqual(4);
  });

  test('dragging the inner-edge resize handle widens the panel and narrows the canvas', async ({ page }) => {
    await gridReady(page);
    const columnsTab = page.locator(`${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`);
    await columnsTab.click();
    await waitForFrames(page, 6);

    const handle = page.locator(HANDLE_SELECTOR);
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('side bar resize handle has no bounding box');
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    const widthBefore = await canvasWidth(page);
    const panelWidthBefore = await page.evaluate(() => {
      const p = document.querySelector('.cg-side-bar-panel') as HTMLElement | null;
      return p ? Math.round(p.getBoundingClientRect().width) : 0;
    });

    // Drag LEFT by 80px — right-positioned panel grows by 80px.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 80, startY, { steps: 12 });
    await page.mouse.up();
    await waitForFrames(page, 6);

    const widthAfter = await canvasWidth(page);
    const panelWidthAfter = await page.evaluate(() => {
      const p = document.querySelector('.cg-side-bar-panel') as HTMLElement | null;
      return p ? Math.round(p.getBoundingClientRect().width) : 0;
    });

    expect(panelWidthAfter).toBeGreaterThan(panelWidthBefore + 60);
    expect(widthAfter).toBeLessThan(widthBefore - 60);
  });
});
