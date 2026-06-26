/**
 * Cycle 6 / Task 5 — imperative column API.
 *
 * Three scenarios exercise the four toolbar-wired batch mutations against
 * the live demo:
 *  1. "Hide P&L" → setColumnsVisible([...], false) — the three P&L group
 *     leaves drop out of the visible-leaf order.
 *  2. "Pin Spread Left" → setColumnsPinned(['spread'], 'left') — `spread`
 *     joins the pinned-left bucket and lands before unpinned columns.
 *  3. "Reset widths" → setColumnWidths([...]) — explicit widths apply
 *     atomically and each emits a `columnResized` event with
 *     `finished: true` + `source: 'api'`.
 *
 * Unit tests (cgrid/tests/imperativeColumnApi.test.ts) cover the engine;
 * this spec asserts the toolbar → API → repaint pipeline lights up.
 */
import { test, expect } from '@playwright/test';

interface ColumnStateEntry {
  colId: string;
  width?: number;
  hide?: boolean;
  pinned?: 'left' | 'right' | null;
}

interface ResizedEventPayload {
  type: 'columnResized';
  colId: string;
  width: number;
  finished?: boolean;
  source?: string;
}

interface GridApiSurface {
  getColumnState: () => ColumnStateEntry[];
  on: (
    type: string,
    handler: (e: Record<string, unknown>) => void,
  ) => () => void;
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

async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((res) => {
      let n = 0;
      const tick = () => (++n >= 4 ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    }),
  );
}

async function visibleColIds(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
    return grid.getColumnState()
      .filter((e) => e.hide !== true)
      .map((e) => e.colId);
  });
}

test.describe('Cycle 6 / Task 5 — imperative column API', () => {
  test('Hide P&L toolbar button drops the three P&L leaves from the visible order', async ({ page }) => {
    await gridReady(page);

    const before = await visibleColIds(page);
    expect(before).toContain('pnl');
    expect(before).toContain('dailyPnl');
    expect(before).toContain('unrealizedPnl');

    await page.click('#imp-hide-pnl');
    await settle(page);

    const after = await visibleColIds(page);
    expect(after).not.toContain('pnl');
    expect(after).not.toContain('dailyPnl');
    expect(after).not.toContain('unrealizedPnl');

    // getColumnState still reports the hidden columns (symmetric round-trip).
    const state = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getColumnState();
    });
    const hiddenPnl = state.find((s) => s.colId === 'pnl');
    expect(hiddenPnl?.hide).toBe(true);
  });

  test('Pin Spread Left moves spread into the pinned-left bucket', async ({ page }) => {
    await gridReady(page);

    const stateBefore = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getColumnState();
    });
    expect(stateBefore.find((s) => s.colId === 'spread')?.pinned ?? null).toBe(null);

    await page.click('#imp-pin-spread');
    await settle(page);

    const stateAfter = await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      return grid.getColumnState();
    });
    expect(stateAfter.find((s) => s.colId === 'spread')?.pinned).toBe('left');
  });

  test('Reset widths fires columnResized per changed column with finished:true + source:api', async ({ page }) => {
    await gridReady(page);

    // Subscribe to columnResized BEFORE the click so we catch the events.
    // Handler writes to the live window slot every fire so resetting
    // `__resizeEvents.length = 0` between assertions works.
    await page.evaluate(() => {
      const grid = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      (window as unknown as { __resizeEvents: ResizedEventPayload[] }).__resizeEvents = [];
      grid.on('columnResized', (e) => {
        (window as unknown as { __resizeEvents: ResizedEventPayload[] })
          .__resizeEvents.push(e as unknown as ResizedEventPayload);
      });
    });

    // Mutate one of the widths via the imperative API first so the Reset
    // button has a real change to revert. ticker starts at 100; bump it
    // to 200 so the reset back to 100 produces a measurable event.
    await page.evaluate(() => {
      const api = (window as unknown as {
        __cgrid: { setColumnWidths: (w: Array<{ key: string; newWidth: number }>) => void };
      }).__cgrid;
      api.setColumnWidths([{ key: 'ticker', newWidth: 200 }]);
    });
    await settle(page);

    // Clear the capture array IN PLACE so the handler's reference still works.
    await page.evaluate(() => {
      (window as unknown as { __resizeEvents: ResizedEventPayload[] })
        .__resizeEvents.length = 0;
    });

    await page.click('#imp-reset-widths');
    await settle(page);

    const captured = await page.evaluate(() =>
      (window as unknown as { __resizeEvents: ResizedEventPayload[] }).__resizeEvents);

    // At least the ticker change (200 → 100) must surface.
    expect(captured.length).toBeGreaterThan(0);
    const ticker = captured.find((e) => e.colId === 'ticker');
    expect(ticker).toBeDefined();
    expect(ticker?.width).toBe(100);
    expect(ticker?.finished).toBe(true);
    expect(ticker?.source).toBe('api');
  });
});
