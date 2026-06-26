/**
 * Cycle 11 / Task 5 — custom panel API E2E.
 *
 * Two methods on `CGridApi`:
 *  - `refreshToolPanel(id)` calls `refresh()` on the live `ToolPanel`
 *    instance for `id`, silent no-op when the panel is not mounted.
 *  - `getToolPanelInstance(id)` returns the live instance (or `null`).
 *
 * Both must work for built-in panels (`agColumnsToolPanel`,
 * `agFiltersToolPanel`) AND for custom panels registered via
 * `CGridOptions.components`. The positions demo opts into the custom
 * path via `?customPanel=1`, which registers `DemoCustomPanel` and
 * appends a third tab ("Demo") to the side bar. `DemoCustomPanel`
 * records every lifecycle call as `data-init-count` /
 * `data-refresh-count` / `data-destroy-count` on its root element,
 * which this spec reads through the DOM as a side channel.
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';
const TAB_SELECTOR = '.cg-side-bar-tab';
const PANEL_SELECTOR = '.cg-side-bar-panel';
const CUSTOM_PANEL_SELECTOR = '.cg-demo-custom-panel';

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
  // `?customPanel=1` is the demo opt-in for the third (custom) tab;
  // `stress=light` keeps the STOMP stream tiny so `firstDataRendered`
  // fires within the default Playwright timeout.
  await page.goto('/?stress=light&customPanel=1');
  await page.waitForSelector(GRID_SELECTOR, { state: 'visible' });
  await page.waitForFunction(
    () => (window as unknown as { __cgridReady?: boolean }).__cgridReady === true,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

/** Call a CGridApi method on the live demo grid and return the result.
 *  Casts through `any` since the public types aren't loaded in
 *  page-eval scope; the spec asserts the result shape directly. */
async function callApi<T>(page: Page, fn: (api: any) => T): Promise<T> {
  return page.evaluate((src) => {
    const api = (window as unknown as { __cgrid: any }).__cgrid;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    return new Function('api', `return (${src})(api);`)(api);
  }, fn.toString()) as Promise<T>;
}

test.describe('Cycle 11 / Task 5 — refreshToolPanel + getToolPanelInstance', () => {
  test('the demo registers a third tool panel ("Demo") via CGridOptions.components when ?customPanel=1', async ({ page }) => {
    await gridReady(page);
    const tabs = page.locator(TAB_SELECTOR);
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveAttribute('aria-label', 'Columns');
    await expect(tabs.nth(1)).toHaveAttribute('aria-label', 'Filters');
    await expect(tabs.nth(2)).toHaveAttribute('aria-label', 'Demo');
  });

  test('getToolPanelInstance(id) returns null before any panel is opened, for both built-in and custom ids', async ({ page }) => {
    await gridReady(page);
    const columnsInstance = await callApi<unknown>(page, (api) => api.getToolPanelInstance('agColumnsToolPanel'));
    const filtersInstance = await callApi<unknown>(page, (api) => api.getToolPanelInstance('agFiltersToolPanel'));
    const customInstance = await callApi<unknown>(page, (api) => api.getToolPanelInstance('demoCustomPanel'));
    expect(columnsInstance).toBeNull();
    expect(filtersInstance).toBeNull();
    expect(customInstance).toBeNull();
  });

  test('getToolPanelInstance(id) returns null for an unknown id (no throw)', async ({ page }) => {
    await gridReady(page);
    const unknown = await callApi<unknown>(page, (api) => api.getToolPanelInstance('does-not-exist'));
    expect(unknown).toBeNull();
  });

  test('refreshToolPanel(id) is a silent no-op when nothing is mounted', async ({ page }) => {
    await gridReady(page);
    // Should not throw — wrap in try/catch and assert the catch never
    // fires by returning a marker string.
    const result = await callApi<string>(page, (api) => {
      try {
        api.refreshToolPanel('agColumnsToolPanel');
        api.refreshToolPanel('demoCustomPanel');
        api.refreshToolPanel('does-not-exist');
        return 'ok';
      } catch (e) {
        return String((e as Error).message ?? e);
      }
    });
    expect(result).toBe('ok');
  });

  test('opening the Demo tab mounts the custom panel; refreshToolPanel("demoCustomPanel") increments the live refresh-count', async ({ page }) => {
    await gridReady(page);

    // Open the Demo tab — the custom panel's `init` fires + the GUI
    // mounts inside .cg-side-bar-panel.
    const demoTab = page.locator(`${TAB_SELECTOR}[data-id="demoCustomPanel"]`);
    await demoTab.click();
    await waitForFrames(page, 3);
    await expect(demoTab).toHaveAttribute('aria-pressed', 'true');

    const customPanel = page.locator(CUSTOM_PANEL_SELECTOR);
    await expect(customPanel).toHaveCount(1);
    await expect(customPanel).toHaveAttribute('data-init-count', '1');
    await expect(customPanel).toHaveAttribute('data-refresh-count', '0');

    // getToolPanelInstance should now return the live instance.
    const isLive = await callApi<boolean>(page, (api) => {
      const inst = api.getToolPanelInstance('demoCustomPanel');
      return inst != null && typeof inst.getGui === 'function' && typeof inst.refresh === 'function';
    });
    expect(isLive).toBe(true);

    // First refreshToolPanel call → counter goes to 1.
    await callApi<void>(page, (api) => api.refreshToolPanel('demoCustomPanel'));
    await expect(customPanel).toHaveAttribute('data-refresh-count', '1');

    // Two more calls → counter at 3.
    await callApi<void>(page, (api) => { api.refreshToolPanel('demoCustomPanel'); api.refreshToolPanel('demoCustomPanel'); });
    await expect(customPanel).toHaveAttribute('data-refresh-count', '3');
  });

  test('refreshToolPanel works for built-in panel ids too (Columns)', async ({ page }) => {
    await gridReady(page);

    // Open the Columns tab so an instance exists. The real
    // ColumnsToolPanel rebuilds its row list on refresh(), so we can't
    // hang assertion on a counter — instead we assert that the call
    // does not throw + the panel DOM stays in place after refresh.
    const columnsTab = page.locator(`${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`);
    await columnsTab.click();
    await waitForFrames(page, 3);
    await expect(page.locator(`${PANEL_SELECTOR} .cg-columns-panel`)).toHaveCount(1);

    const result = await callApi<string>(page, (api) => {
      try {
        api.refreshToolPanel('agColumnsToolPanel');
        return 'ok';
      } catch (e) {
        return String((e as Error).message ?? e);
      }
    });
    expect(result).toBe('ok');
    await expect(page.locator(`${PANEL_SELECTOR} .cg-columns-panel`)).toHaveCount(1);
  });

  test('getToolPanelInstance(id) returns null again after the user closes the tab', async ({ page }) => {
    await gridReady(page);
    const demoTab = page.locator(`${TAB_SELECTOR}[data-id="demoCustomPanel"]`);
    await demoTab.click();
    await waitForFrames(page, 3);
    const customPanel = page.locator(CUSTOM_PANEL_SELECTOR);
    await expect(customPanel).toHaveAttribute('data-init-count', '1');

    // Close — host calls destroy() on the instance, removes the DOM.
    await demoTab.click();
    await waitForFrames(page, 3);
    await expect(demoTab).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(CUSTOM_PANEL_SELECTOR)).toHaveCount(0);

    // After close, getToolPanelInstance returns null.
    const afterClose = await callApi<unknown>(page, (api) => api.getToolPanelInstance('demoCustomPanel'));
    expect(afterClose).toBeNull();

    // And refreshToolPanel is a silent no-op (the instance was destroyed).
    const result = await callApi<string>(page, (api) => {
      try {
        api.refreshToolPanel('demoCustomPanel');
        return 'ok';
      } catch (e) {
        return String((e as Error).message ?? e);
      }
    });
    expect(result).toBe('ok');
  });
});
