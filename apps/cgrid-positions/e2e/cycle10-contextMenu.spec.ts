/**
 * Cycle 10 / Task 1 — context menu host + RightClick feature E2E.
 *
 * Task 1 ships the menu surface but leaves the items empty — apps light
 * the menu up by registering `getContextMenuItems` (Task 7 plugs the
 * default registry into the demo). This spec registers a callback
 * imperatively via `setGridOption('getContextMenuItems', …)` from the
 * test, then exercises the surface:
 *
 *  - right-click on a body cell mounts `div.vg-context-menu` at the
 *    cursor, with the callback receiving the hit-test row + col;
 *  - clicking a menu item fires its `action` and closes the menu;
 *  - Escape closes the menu;
 *  - clicking outside the menu closes it;
 *  - the native browser context menu is suppressed (preventDefault).
 *
 * Verifies the worklog's acceptance bullets for Task 1:
 *  - "Right-clicking a body cell calls getContextMenuItems({rowIndex,
 *    colId, ranges, defaultItems})"
 *  - "Menu mounts at the cursor; click-outside or Escape closes it"
 *  - "Separator (name: '---') renders as <hr>; disabled items render
 *    dim + skip action" (unit test covers the rendering; this E2E
 *    covers the gesture flow).
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';
const MENU_SELECTOR = '.vg-context-menu';

interface MenuItemSeed {
  name: string;
  // `action` is set via `Function.prototype.toString()` round-trip on the
  // test side — see `installMenu` below — so the runtime can rebuild the
  // callback inside `page.evaluate`.
}

interface GridSurface {
  getCellBoundsAt: (rowIndex: number, colId: string) => { x: number; y: number; w: number; h: number } | null;
  setGridOption: (key: string, value: unknown) => void;
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
      const tick = () => (++i >= count ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
    n,
  );
}

async function canvasOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

async function cellBounds(page: Page, rowIndex: number, colId: string): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await page.evaluate(
    ({ r, c }) => (window as unknown as { __velocity-grid: GridSurface }).__cgrid.getCellBoundsAt(r, c),
    { r: rowIndex, c: colId },
  );
  if (!b) throw new Error(`no cell bounds for (${rowIndex}, ${colId})`);
  return b;
}

/** Register a `getContextMenuItems` callback that:
 *   - records the params object it was called with (`window.__cmParams`),
 *   - returns a 3-item menu: a custom item (records its action call into
 *     `window.__cmAction`), a separator, and a disabled item.
 *  The callback runs inside `page.evaluate` so it has direct access to
 *  the `window` capture vars. */
async function installMenu(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __velocity-grid: GridSurface;
      __cmParams?: unknown;
      __cmAction?: unknown;
    };
    w.__cmParams = null;
    w.__cmAction = null;
    w.__cgrid.setGridOption('getContextMenuItems', (params: { rowIndex: number | null; colId: string | null }) => {
      w.__cmParams = { rowIndex: params.rowIndex, colId: params.colId };
      return [
        {
          name: 'Custom Action',
          action: (p: { rowIndex: number | null; colId: string | null }) => {
            w.__cmAction = { rowIndex: p.rowIndex, colId: p.colId };
          },
        },
        { name: '---' },
        { name: 'Disabled Action', disabled: true, action: () => {
          w.__cmAction = 'should-not-fire';
        } },
      ];
    });
  });
}

test.describe('Cycle 10 / Task 1 — context menu host + RightClick feature', () => {
  test('right-click on a body cell mounts the menu with the correct params', async ({ page }) => {
    await gridReady(page);
    await installMenu(page);

    const b = await cellBounds(page, 2, 'currentPrice');
    const off = await canvasOffset(page);
    const x = off.x + b.x + b.w / 2;
    const y = off.y + b.y + b.h / 2;

    await page.mouse.move(x, y);
    await page.mouse.click(x, y, { button: 'right' });

    await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });
    const menuCount = await page.locator(MENU_SELECTOR).count();
    expect(menuCount).toBe(1);

    // Callback received the right hit-test slots.
    const params = await page.evaluate(() => (window as unknown as { __cmParams: unknown }).__cmParams);
    expect(params).toEqual({ rowIndex: 2, colId: 'currentPrice' });

    // 2 buttons (custom + disabled) and 1 <hr> separator.
    const buttons = await page.locator(`${MENU_SELECTOR} .vg-menu-item`).count();
    expect(buttons).toBe(2);
    const hrs = await page.locator(`${MENU_SELECTOR} hr`).count();
    expect(hrs).toBe(1);
  });

  test('clicking an enabled item fires its action and closes the menu', async ({ page }) => {
    await gridReady(page);
    await installMenu(page);

    const b = await cellBounds(page, 1, 'currentPrice');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + b.x + b.w / 2, off.y + b.y + b.h / 2, { button: 'right' });
    await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });

    await page.locator(`${MENU_SELECTOR} .vg-menu-item`).filter({ hasText: 'Custom Action' }).click();
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });

    const action = await page.evaluate(() => (window as unknown as { __cmAction: unknown }).__cmAction);
    expect(action).toEqual({ rowIndex: 1, colId: 'currentPrice' });
  });

  test('clicking a disabled item does NOT fire its action and leaves the menu open', async ({ page }) => {
    await gridReady(page);
    await installMenu(page);

    const b = await cellBounds(page, 0, 'currentPrice');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + b.x + b.w / 2, off.y + b.y + b.h / 2, { button: 'right' });
    await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });

    // `force: true` because Playwright treats `aria-disabled="true"` as
    // not-enabled and refuses to click otherwise — but the whole point of
    // the test is that the host's own click handler short-circuits on
    // `disabled: true`, regardless of how the click arrives.
    await page.locator(`${MENU_SELECTOR} .vg-menu-item[aria-disabled="true"]`).click({ force: true });

    // Menu still mounted; action never fired.
    expect(await page.locator(MENU_SELECTOR).count()).toBe(1);
    const action = await page.evaluate(() => (window as unknown as { __cmAction: unknown }).__cmAction);
    expect(action).toBeNull();
  });

  test('Escape closes the menu', async ({ page }) => {
    await gridReady(page);
    await installMenu(page);

    const b = await cellBounds(page, 0, 'currentPrice');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + b.x + b.w / 2, off.y + b.y + b.h / 2, { button: 'right' });
    await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });

    await page.keyboard.press('Escape');
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });
  });

  test('clicking outside the menu closes it', async ({ page }) => {
    await gridReady(page);
    await installMenu(page);

    const b = await cellBounds(page, 0, 'currentPrice');
    const off = await canvasOffset(page);
    await page.mouse.click(off.x + b.x + b.w / 2, off.y + b.y + b.h / 2, { button: 'right' });
    await page.waitForSelector(MENU_SELECTOR, { state: 'visible' });

    // Click in an empty area outside the menu (top-left corner of the page).
    await page.mouse.click(2, 2);
    await page.waitForSelector(MENU_SELECTOR, { state: 'detached' });
  });

  test('when getContextMenuItems returns [], no menu mounts but the native browser menu is also suppressed', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(() => {
      const w = window as unknown as { __velocity-grid: GridSurface };
      w.__cgrid.setGridOption('getContextMenuItems', () => []);
    });

    const b = await cellBounds(page, 0, 'currentPrice');
    const off = await canvasOffset(page);
    // Use dispatchEvent so we can listen for `defaultPrevented` on the
    // synthetic contextmenu event — Playwright's `click({button:'right'})`
    // would let the native menu show in headed mode otherwise.
    const prevented = await page.evaluate(
      ({ cx, cy }) => {
        const c = document.querySelector('#grid canvas') as HTMLCanvasElement;
        const ev = new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2,
        });
        c.dispatchEvent(ev);
        return ev.defaultPrevented;
      },
      { cx: off.x + b.x + b.w / 2, cy: off.y + b.y + b.h / 2 },
    );
    expect(prevented).toBe(true);
    expect(await page.locator(MENU_SELECTOR).count()).toBe(0);
  });
});
