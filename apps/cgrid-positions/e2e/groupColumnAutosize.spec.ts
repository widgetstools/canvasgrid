/**
 * Group column autosize.
 *
 * Regression:
 *   `autoSizeColumns(['ag-Grid-AutoColumn'])` used to collapse the
 *   synthesized auto-group column to `max(minWidth, headerWidth)` — the
 *   worker looked up `WorkerColumn.field` and found `undefined` on the
 *   auto-group column, so `textOf` returned `''` for every sampled row
 *   and the pass measured only the header ("Group"). No indent, no
 *   chevron, no group values, no count. Widths would land at ~70 px
 *   regardless of grouping depth or value length.
 *
 *   The fix routes auto-group columns through a chrome-aware path: main
 *   ships an `AutosizeGroupContext` (chromeBase + indentUnit +
 *   suppressCount + countGap + optional depth slot); worker walks the
 *   group tree and measures per-node `chromeBase + depth × indentUnit +
 *   valueFormatted + optional (count)`.
 *
 * What this spec asserts:
 *   1. singleColumn mode: seed rows whose group values are LONG (10-char
 *      tickers). Auto-size the auto-group column. The resulting width
 *      must exceed the pre-fix ceiling (~80 px = header + padding)
 *      AND must fit the widest group value + chrome + count.
 *   2. multipleColumns mode: seed 2-level grouping. Each per-level
 *      auto-group column (`ag-Grid-AutoColumn-0`, `ag-Grid-AutoColumn-1`)
 *      auto-sizes to fit ONLY nodes at its own depth. Both columns end
 *      up wider than the pre-fix ceiling.
 */
import { test, expect, type Page } from '@playwright/test';

interface CellBounds { x: number; y: number; w: number; h: number }

interface GridApiSurface {
  autoSizeColumns: (keys: string[], skipHeader?: boolean) => Promise<void>;
  setRowData: (rows: unknown[]) => void;
  setColumnWidths: (
    columnWidths: Array<{ key: string; newWidth: number }>,
    finished?: boolean,
  ) => void;
  getCellBoundsAt: (rowIndex: number, colId: string) => CellBounds | null;
}

/** Width of the leftmost cell in `colId` — read via `getCellBoundsAt`.
 *  `getColumnState()` does not surface synthesized auto-group columns
 *  (they're not part of the persistable column state), so the cell
 *  bounds API is the durable public surface for observing their width.
 *  Row 0 is always the first group row on a grouped grid. */
async function columnWidth(page: Page, colId: string): Promise<number> {
  return page.evaluate(({ id }) => {
    const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
    const b = g.getCellBoundsAt(0, id);
    return b ? b.w : -1;
  }, { id: colId });
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

async function gridReady(page: Page, url: string): Promise<void> {
  await page.goto(url);
  // Wait for the grid instance; skip firstDataRendered because the
  // spec seeds its own rows below.
  await page.waitForFunction(
    () => (window as unknown as { __cgrid?: unknown }).__cgrid != null,
    null,
    { timeout: 20_000 },
  );
  await waitForFrames(page, 6);
}

/** Seed rows with LONG group values so the autosize-fix improvement is
 *  unambiguous. Groups by `ticker`; each row also carries a `sector` +
 *  `subSector` so the multipleColumns test can group two levels deep. */
async function seedRows(page: Page, count: number, longTickers: boolean): Promise<void> {
  await page.evaluate(({ n, longTickers }) => {
    const TICKERS = longTickers
      ? ['AAAAAAAAAA', 'BBBBBBBBBB', 'CCCCCCCCCC', 'DDDDDDDDDD']
      : ['AAPL', 'MSFT', 'GOOG', 'AMZN'];
    const SECTORS = ['Technology-Long', 'Financials-Long', 'Healthcare-Long'];
    const SUB = ['Software-Sub', 'Hardware-Sub', 'Banking-Sub'];
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        positionId: `POS-${String(i).padStart(6, '0')}`,
        cusip: `CUSIP${i}`,
        ticker: TICKERS[i % TICKERS.length],
        sector: SECTORS[i % SECTORS.length],
        subSector: SUB[i % SUB.length],
        notionalAmount: 1000 + i,
        marketValue: 5000 + i,
        currentPrice: 100 + i,
        pnl: 0,
        dailyPnl: 0,
        unrealizedPnl: 0,
        yield: 1,
        spread: 5,
        dv01: 10,
        pv01: 10,
      });
    }
    const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
    g.setRowData(rows);
  }, { n: count, longTickers });
  await waitForFrames(page, 12);
}

test.describe('auto-group column autosize', () => {
  test('singleColumn: widens Group column to fit long group values + count + chrome', async ({ page }) => {
    await gridReady(page, '/?grouping=ticker&totals=off');
    await seedRows(page, 40, /* longTickers */ true);

    // Pin the auto-group column to a narrow width so the "did autosize
    // grow it" assertion is unambiguous. Pre-fix, autosize would leave
    // this at header/minWidth (~70 px) regardless of content.
    await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      g.setColumnWidths([{ key: 'ag-Grid-AutoColumn', newWidth: 40 }]);
    });
    await waitForFrames(page, 4);

    // Sanity — the narrow width stuck.
    const before = await columnWidth(page, 'ag-Grid-AutoColumn');
    expect(before).toBe(40);

    // Autosize the auto-group column ONLY. skipHeader stays false so
    // the header label still competes; the group values must dominate.
    await page.evaluate(async () => {
      const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      await g.autoSizeColumns(['ag-Grid-AutoColumn']);
    });
    await waitForFrames(page, 6);

    const after = await columnWidth(page, 'ag-Grid-AutoColumn');
    // Pre-fix ceiling (header "Group" + headerPadding=30) sits around
    // 70 px. The fix must produce a width that fits the widest group
    // value's paint. With 10-character tickers + chrome (chevronBox +
    // padding + count suffix), the resulting width comfortably exceeds
    // 120 px on any measurer. This bound is well above the pre-fix
    // path's ceiling — a regression that reintroduces the header /
    // minWidth collapse would land here at ~40-70 px and fail.
    expect(after).toBeGreaterThan(120);
    // Upper bound: a defensive cap so a runaway measurer bug would
    // fail loudly. 400 px is far above the widest realistic width for
    // a 10-char group value + chrome at 13px system-ui.
    expect(after).toBeLessThan(400);
  });

  test('multipleColumns: each per-level column widens to fit its own depth', async ({ page }) => {
    await gridReady(page, '/?grouping=multipleColumns&totals=off');
    await seedRows(page, 60, /* longTickers */ true);

    // Pin all three per-level columns to narrow widths so the growth
    // is unambiguous across depths (mirrors `AUTO_GROUP_MULTIPLE_DEFAULT_WIDTH`
    // default of 140 — we drop below it deliberately).
    await page.evaluate(() => {
      const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      g.setColumnWidths([
        { key: 'ag-Grid-AutoColumn-0', newWidth: 40 },
        { key: 'ag-Grid-AutoColumn-1', newWidth: 40 },
        { key: 'ag-Grid-AutoColumn-2', newWidth: 40 },
      ]);
    });
    await waitForFrames(page, 4);

    const before = {
      depth0: await columnWidth(page, 'ag-Grid-AutoColumn-0'),
      depth1: await columnWidth(page, 'ag-Grid-AutoColumn-1'),
      depth2: await columnWidth(page, 'ag-Grid-AutoColumn-2'),
    };
    expect(before.depth0).toBe(40);
    expect(before.depth1).toBe(40);
    expect(before.depth2).toBe(40);

    await page.evaluate(async () => {
      const g = (window as unknown as { __cgrid: GridApiSurface }).__cgrid;
      await g.autoSizeColumns([
        'ag-Grid-AutoColumn-0',
        'ag-Grid-AutoColumn-1',
        'ag-Grid-AutoColumn-2',
      ]);
    });
    await waitForFrames(page, 6);

    const after = {
      depth0: await columnWidth(page, 'ag-Grid-AutoColumn-0'),
      depth1: await columnWidth(page, 'ag-Grid-AutoColumn-1'),
      depth2: await columnWidth(page, 'ag-Grid-AutoColumn-2'),
    };
    // Every per-level column must exceed the pre-fix ceiling. Depths 0
    // and 1 fit long strings ('AAAAAAAAAA' / 'Technology-Long'); depth 2
    // fits 'Software-Sub' (12 chars). Bounds are conservative so the
    // test survives font / measurer drift.
    expect(after.depth0).toBeGreaterThan(100);
    expect(after.depth1).toBeGreaterThan(120);
    expect(after.depth2).toBeGreaterThan(100);
    // Upper defensive cap.
    for (const w of [after.depth0, after.depth1, after.depth2]) {
      expect(w).toBeLessThan(400);
    }
  });
});
