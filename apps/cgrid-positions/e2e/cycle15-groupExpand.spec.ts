/**
 * Cycle 15 / Task 7 — chevron click → group toggle, end-to-end.
 *
 * The grid mounts grouped by `ticker` (one level) via `?grouping=ticker`.
 * The test seeds rows directly through `__cgrid.setRowData` so the
 * suite does not depend on a STOMP server. Every group is expanded
 * at mount (the default-all sentinel). The test:
 *   1. Reads the auto-group column's cell bounds for the first group
 *      row off the imperative API.
 *   2. Computes the chevron's expected center using the constants the
 *      `'group'` renderer + `hitTestGroupChevron` agree on
 *      (PADDING + CHEVRON_SIZE/2 at depth 0).
 *   3. Drives a real mouse click at that point.
 *   4. Asserts the `rowGroupOpened` event fired with `source: 'ui'`
 *      AND the API mirror collapsed the matching group key.
 *
 * What regression this catches:
 *   - Hit-test divergence: if the click point's hit zone formula in
 *     `velocityGrid.ts hitTestGroupChevron` drifts from the renderer's
 *     paint position, the click lands in the cell but resolves to
 *     `null` — no toggle fires.
 *   - Feature ordering break: if `GroupExpandFeature` moved behind
 *     `CellSelection` / `EditTrigger` in the chain, the click would
 *     either replace focus or open an editor instead of toggling.
 *   - Event surface break: a `rowGroupOpened` event missing
 *     `source: 'ui'` (or the source defaulting to `'api'`) would
 *     mean apps couldn't distinguish a chevron click from a
 *     programmatic toggle.
 *   - Mirror drift: a click that toggles the worker but doesn't
 *     update the main-side `expandedKeys` mirror would leak
 *     `getExpandedKeys()` snapshots that don't match what's
 *     painted.
 */
import { test, expect, Page } from '@playwright/test';

interface CellBounds { x: number; y: number; w: number; h: number }

interface GridApiSurface {
  getCellBoundsAt: (rowIndex: number, colId: string) => CellBounds | null;
  getExpandedKeys: () => Set<string>;
  setRowData: (rows: unknown[]) => void;
}

async function waitForFrames(page: Page, n = 6): Promise<void> {
  await page.evaluate(
    (count) => new Promise<void>((res) => {
      let i = 0;
      const tick = (): void => {
        if (++i >= count) res();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
    n,
  );
}

async function gridReady(page: Page): Promise<void> {
  await page.goto('/?grouping=ticker&totals=off');
  // Wait for `__cgrid` (the grid instance) to mount. We do NOT wait
  // for `__cgridReady` (firstDataRendered) — that fires after the
  // first non-empty viewport, which requires data to land. The demo
  // hooks STOMP for live data; in CI / a clean dev run there's no
  // STOMP server, so we seed rows ourselves via setRowData.
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

async function seedRows(page: Page, count: number): Promise<void> {
  await page.evaluate((n) => {
    const g = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
    const TICKERS = [
      'AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'BRK', 'JPM', 'XOM',
    ];
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < n; i++) {
      const ticker = TICKERS[i % TICKERS.length];
      const a = ((i * 2654435761) >>> 0) / 0x1_0000_0000;
      const b = (((i + 1) * 2246822519) >>> 0) / 0x1_0000_0000;
      const price = Math.round((50 + a * 450) * 100) / 100;
      const notional = Math.round((1_000 + b * 99_000) / 100) * 100;
      rows.push({
        positionId: `POS-${String(i).padStart(6, '0')}`,
        cusip: `CUSIP${i}`,
        ticker,
        sector: 'Tech',
        subSector: 'Software',
        notionalAmount: notional,
        marketValue: price * notional,
        currentPrice: price,
        pnl: 0,
        dailyPnl: 0,
        unrealizedPnl: 0,
        yield: 1,
        spread: 5,
        dv01: 10,
        pv01: 10,
      });
    }
    g.setRowData(rows);
  }, count);
  await waitForFrames(page, 12);
}

async function canvasOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = document.querySelector('#grid canvas') as HTMLCanvasElement | null;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

test.describe('Cycle 15 / Task 7 — chevron click toggles group expansion', () => {
  test('clicking the chevron on the first group row collapses that group and fires rowGroupOpened', async ({ page }) => {
    await gridReady(page);
    await seedRows(page, 50);

    // Snapshot of the initial expanded set so we can prove the click
    // mutated state vs. just firing an event for the wrong key.
    const before = await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return Array.from(api.getExpandedKeys()).sort();
    });
    expect(before.length).toBeGreaterThan(0);

    // Read the first group row's chevron geometry off the API. Row 0
    // is the first GROUP row (groups emit before their data rows in
    // the slicer's depth-first walk), column 'ag-Grid-AutoColumn' is
    // the synthesized auto-group column.
    const bounds = await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return api.getCellBoundsAt(0, 'ag-Grid-AutoColumn');
    });
    expect(bounds).not.toBeNull();

    // Install the listener BEFORE the click so the event lands in the
    // recorder array.
    type RowGroupOpenedEvent = { type: 'rowGroupOpened'; key: string; expanded: boolean; source: 'ui' | 'api' };
    interface GridWithEvents { on(type: 'rowGroupOpened', handler: (e: RowGroupOpenedEvent) => void): void }
    await page.evaluate(() => {
      const w = window as unknown as { __velocity-grid: GridWithEvents; __rgo: RowGroupOpenedEvent[] };
      w.__rgo = [];
      w.__cgrid.on('rowGroupOpened', (e: RowGroupOpenedEvent) => { w.__rgo.push(e); });
    });

    // Compute the chevron's center in viewport coords. Constants
    // mirror `velocityGrid.ts hitTestGroupChevron` + `renderer/cellRenderers/group.ts`:
    //   PADDING = 6, CHEVRON_SIZE = 12. depth 0 -> indentX = 0.
    // Chevron center X = boundsX + PADDING + CHEVRON_SIZE/2 = boundsX + 12.
    const off = await canvasOffset(page);
    const chevronX = off.x + bounds!.x + 6 + 6;
    const chevronY = off.y + bounds!.y + bounds!.h / 2;

    await page.mouse.move(chevronX, chevronY);
    await page.mouse.down();
    await page.mouse.up();
    await waitForFrames(page, 12);

    // The event fired exactly once with source: 'ui'.
    const events = await page.evaluate(() => {
      type RGO = { type: 'rowGroupOpened'; key: string; expanded: boolean; source: 'ui' | 'api' };
      return (window as unknown as { __rgo: RGO[] }).__rgo;
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.expanded).toBe(false);
    expect(events[0]!.source).toBe('ui');
    const collapsedKey = events[0]!.key;
    expect(collapsedKey.length).toBeGreaterThan(0);

    // The main-side mirror lost exactly that key (and kept all others).
    const after = await page.evaluate(() => {
      const api = (window as unknown as { __velocity-grid: GridApiSurface }).__cgrid;
      return Array.from(api.getExpandedKeys()).sort();
    });
    expect(after).not.toContain(collapsedKey);
    expect(after.length).toBe(before.length - 1);
  });
});
