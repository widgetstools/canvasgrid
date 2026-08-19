/**
 * Cycle 11 / Task 7 — Side bar events E2E.
 *
 * Verifies that the two new lifecycle events on the grid emitter fire
 * end-to-end against the running demo:
 *
 *   - `toolPanelVisibleChanged` — fires every time a tool panel opens or
 *     closes. Payload `{ key, visible, source }`. `source` carries the
 *     trigger:
 *       * `'api'` — programmatic `openToolPanel` / `closeToolPanel`;
 *       * `'sideBarButtonClicked'` — user clicked a tab;
 *       * `'sideBarInitializing'` — mount-time auto-open driven by
 *         `defaultToolPanel` (not exercised by the default positions demo,
 *         covered by the unit tests).
 *
 *   - `sideBarVisibleChanged` — fires when the WHOLE side bar shows or
 *     hides. Payload `{ visible, source }`. Hiding the bar while a panel
 *     is open does NOT cascade into a `toolPanelVisibleChanged` (the
 *     panel stays open in host state — that's also asserted here).
 *
 * Events are captured by attaching a listener to `window.__cgrid` and
 * pushing each payload into a `window.__cgridEvents` array we read back
 * with `page.evaluate`. The positions demo exposes the live grid as
 * `__cgrid`; the side bar is configured via
 * `sideBar: { toolPanels: ['columns', 'filters'] }` in
 * `apps/velocitygrid-positions/src/positionsGrid.ts`.
 */
import { test, expect, Page } from '@playwright/test';

const GRID_SELECTOR = '#grid canvas';
const TAB_SELECTOR = '.vg-side-bar-tab';

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

/** Attach a recorder to both events so subsequent triggers push payloads
 *  into `window.__cgridEvents`. The handlers push into the LIVE
 *  `window.__cgridEvents` array each time they fire (re-read on every
 *  call), so `resetEvents(page)` — which empties the array in place —
 *  doesn't strand prior captures or break the handlers. */
async function attachEventRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const grid = (window as unknown as { __cgrid: { on: (t: string, h: (e: unknown) => void) => () => void } }).__cgrid;
    (window as unknown as { __cgridEvents: unknown[] }).__cgridEvents = [];
    const push = (e: unknown) => {
      ((window as unknown as { __cgridEvents: unknown[] }).__cgridEvents).push(e);
    };
    grid.on('toolPanelVisibleChanged', push);
    grid.on('sideBarVisibleChanged', push);
  });
}

async function resetEvents(page: Page): Promise<void> {
  // Empty the live array in place — must NOT replace it, otherwise the
  // listeners attached by `attachEventRecorder` would still push into
  // the orphaned old reference.
  await page.evaluate(() => {
    const arr = (window as unknown as { __cgridEvents: unknown[] }).__cgridEvents;
    arr.length = 0;
  });
}

async function readEvents(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const out = (window as unknown as { __cgridEvents?: unknown[] }).__cgridEvents ?? [];
    return out as Array<Record<string, unknown>>;
  });
}

test.describe('Cycle 11 / Task 7 — side bar events', () => {
  test('clicking a tab fires toolPanelVisibleChanged with source="sideBarButtonClicked"', async ({ page }) => {
    await gridReady(page);
    await attachEventRecorder(page);
    await resetEvents(page);

    const columnsTab = page.locator(`${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`);
    await columnsTab.click();
    await waitForFrames(page, 3);

    const events = await readEvents(page);
    const panelEvents = events.filter((e) => e.type === 'toolPanelVisibleChanged');
    expect(panelEvents.length).toBe(1);
    expect(panelEvents[0]).toMatchObject({
      type: 'toolPanelVisibleChanged',
      key: 'agColumnsToolPanel',
      visible: true,
      source: 'sideBarButtonClicked',
    });
  });

  test('toggling a tab off fires toolPanelVisibleChanged with visible=false + source="sideBarButtonClicked"', async ({ page }) => {
    await gridReady(page);
    const columnsTab = page.locator(`${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`);
    await columnsTab.click();
    await waitForFrames(page, 3);

    await attachEventRecorder(page);
    await resetEvents(page);

    await columnsTab.click();
    await waitForFrames(page, 3);
    const events = await readEvents(page);
    const panelEvents = events.filter((e) => e.type === 'toolPanelVisibleChanged');
    expect(panelEvents.length).toBe(1);
    expect(panelEvents[0]).toMatchObject({
      key: 'agColumnsToolPanel',
      visible: false,
      source: 'sideBarButtonClicked',
    });
  });

  test('switching panels via tab clicks fires close + open with source="sideBarButtonClicked"', async ({ page }) => {
    await gridReady(page);
    const columnsTab = page.locator(`${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`);
    const filtersTab = page.locator(`${TAB_SELECTOR}[data-id="agFiltersToolPanel"]`);

    await columnsTab.click();
    await waitForFrames(page, 3);

    await attachEventRecorder(page);
    await resetEvents(page);

    await filtersTab.click();
    await waitForFrames(page, 3);

    const events = await readEvents(page);
    const panelEvents = events.filter((e) => e.type === 'toolPanelVisibleChanged');
    expect(panelEvents.length).toBe(2);
    expect(panelEvents[0]).toMatchObject({
      key: 'agColumnsToolPanel',
      visible: false,
      source: 'sideBarButtonClicked',
    });
    expect(panelEvents[1]).toMatchObject({
      key: 'agFiltersToolPanel',
      visible: true,
      source: 'sideBarButtonClicked',
    });
  });

  test('openToolPanel(id) via the API fires toolPanelVisibleChanged with source="api"', async ({ page }) => {
    await gridReady(page);
    await attachEventRecorder(page);
    await resetEvents(page);

    await page.evaluate(() => {
      const api = (window as unknown as {
        __cgrid: { openToolPanel: (id: string) => void };
      }).__cgrid;
      api.openToolPanel('agColumnsToolPanel');
    });
    await waitForFrames(page, 3);

    const events = await readEvents(page);
    const panelEvents = events.filter((e) => e.type === 'toolPanelVisibleChanged');
    expect(panelEvents.length).toBe(1);
    expect(panelEvents[0]).toMatchObject({
      key: 'agColumnsToolPanel',
      visible: true,
      source: 'api',
    });
  });

  test('closeToolPanel() via the API fires toolPanelVisibleChanged with visible=false + source="api"', async ({ page }) => {
    await gridReady(page);
    await page.evaluate(() => {
      const api = (window as unknown as {
        __cgrid: { openToolPanel: (id: string) => void };
      }).__cgrid;
      api.openToolPanel('agColumnsToolPanel');
    });
    await waitForFrames(page, 3);

    await attachEventRecorder(page);
    await resetEvents(page);

    await page.evaluate(() => {
      const api = (window as unknown as {
        __cgrid: { closeToolPanel: () => void };
      }).__cgrid;
      api.closeToolPanel();
    });
    await waitForFrames(page, 3);

    const events = await readEvents(page);
    const panelEvents = events.filter((e) => e.type === 'toolPanelVisibleChanged');
    expect(panelEvents.length).toBe(1);
    expect(panelEvents[0]).toMatchObject({
      key: 'agColumnsToolPanel',
      visible: false,
      source: 'api',
    });
  });

  test('setSideBarVisible(false) then setSideBarVisible(true) fires two sideBarVisibleChanged events with source="api"', async ({ page }) => {
    await gridReady(page);
    await attachEventRecorder(page);
    await resetEvents(page);

    await page.evaluate(() => {
      const api = (window as unknown as {
        __cgrid: { setSideBarVisible: (show: boolean) => void };
      }).__cgrid;
      api.setSideBarVisible(false);
      api.setSideBarVisible(true);
    });
    await waitForFrames(page, 3);

    const events = await readEvents(page);
    const barEvents = events.filter((e) => e.type === 'sideBarVisibleChanged');
    expect(barEvents.length).toBe(2);
    expect(barEvents[0]).toMatchObject({
      type: 'sideBarVisibleChanged',
      visible: false,
      source: 'api',
    });
    expect(barEvents[1]).toMatchObject({
      type: 'sideBarVisibleChanged',
      visible: true,
      source: 'api',
    });
  });

  test('hiding the bar while a panel is open emits sideBarVisibleChanged but NOT toolPanelVisibleChanged', async ({ page }) => {
    await gridReady(page);
    // Open Columns first via tab click.
    const columnsTab = page.locator(`${TAB_SELECTOR}[data-id="agColumnsToolPanel"]`);
    await columnsTab.click();
    await waitForFrames(page, 3);

    await attachEventRecorder(page);
    await resetEvents(page);

    await page.evaluate(() => {
      const api = (window as unknown as {
        __cgrid: { setSideBarVisible: (show: boolean) => void };
      }).__cgrid;
      api.setSideBarVisible(false);
    });
    await waitForFrames(page, 3);

    const events = await readEvents(page);
    expect(events.filter((e) => e.type === 'sideBarVisibleChanged').length).toBe(1);
    expect(events.filter((e) => e.type === 'toolPanelVisibleChanged').length).toBe(0);
  });
});
