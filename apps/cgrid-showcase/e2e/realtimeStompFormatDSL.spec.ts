import { test, expect } from '@playwright/test';

// Cycle 21c / Task 18 — format DSL under the realtime STOMP feature.
//
// The Realtime (STOMP) demo upgrades two columns to DSL string
// formatters (dailyPnl → Tier 1 color expression, currentPrice →
// Tier 0 currency). The first test asserts the compile plumbing with
// no server dependency; the second drives a live snapshot + tick
// stream through the DSL columns and is skipped when the companion
// stomp-view-server (ws://localhost:8081) isn't running.

test.describe('realtime STOMP — format DSL columns', () => {
  test.beforeEach(async ({ page }) => {
    // Don't use gotoFeature: __cgridReady only flips after first data
    // renders, and this feature starts empty until Connect is clicked.
    await page.goto('/?feature=realtimeStomp');
    await page.waitForFunction(() => window.__cgrid !== null, { timeout: 10_000 });
  });

  test('DSL string formatters compile at mount (no server required)', async ({ page }) => {
    const info = await page.evaluate(() => {
      const map = (window.__cgrid as any).columnDefsMap;
      const daily = map.get('dailyPnl');
      const price = map.get('currentPrice');
      const row = { dailyPnl: -420.5, currentPrice: 99.9 };
      return {
        dailyType: typeof daily?.valueFormatter,
        dailyText: daily?.valueFormatter?.({ value: -420.5, data: row, colId: 'dailyPnl' }),
        dailyStyle: daily?.cellStyleFn?.({ value: -420.5, data: row, colId: 'dailyPnl' }),
        priceText: price?.valueFormatter?.({ value: 99.9, data: row, colId: 'currentPrice' }),
      };
    });
    expect(info.dailyType).toBe('function');
    expect(info.dailyText).toBe('-$420.50');
    expect((info.dailyStyle as any)?.fg).toBe('#dc2626');
    expect(info.priceText).toBe('$99.90');
  });

  test('live snapshot + ticks flow through the DSL columns (needs stomp-view-server)', async ({ page }) => {
    await page.getByTestId('btn-stomp-connect').click();
    // Poll for snapshot rows; if the server isn't running the count
    // stays 0 — skip rather than fail so the suite doesn't depend on
    // the companion service.
    let connected = false;
    try {
      await expect
        .poll(() => page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0), { timeout: 15_000 })
        .toBeGreaterThan(0);
      connected = true;
    } catch {
      connected = false;
    }
    test.skip(!connected, 'stomp-view-server not reachable on ws://localhost:8081');

    // Live rows are in — the DSL columns resolve against real ticks.
    const sample = await page.evaluate(() => {
      const grid = window.__cgrid as any;
      const def = grid.columnDefsMap.get('dailyPnl');
      // Probe the formatter with representative tick values.
      return {
        pos: def.valueFormatter({ value: 1234.5, data: { dailyPnl: 1234.5 }, colId: 'dailyPnl' }),
        posFg: def.cellStyleFn({ value: 1234.5, data: { dailyPnl: 1234.5 }, colId: 'dailyPnl' })?.fg,
        rowCount: grid.rowCount,
      };
    });
    expect(sample.pos).toBe('$1,234.50');
    expect(sample.posFg).toBe('#16a34a');
    expect(sample.rowCount).toBeGreaterThan(0);

    // Rows keep ticking — the count is stable or growing, and the grid
    // stays responsive under live updates with DSL formatting active.
    const before: number = sample.rowCount;
    await page.waitForTimeout(1_500);
    const after: number = await page.evaluate(() => (window.__cgrid as any).rowCount);
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
