import { test, expect, type Page } from '@playwright/test';
import { gotoFeature } from './helpers';

// Cycle 21d / Task 15 — calculated columns feature.
//
// Calc values are worker-computed and ship in viewport chunks, so
// assertions probe grid.getCellValue(rowIndex, colId) (raw chunk value)
// plus resolved defs via columnDefsMap and the engine on
// window.__cgridCalc — mirroring conditionalStyling.spec.ts's
// engine-probe strategy and groupSort.spec.ts's async-settle polling.
//
// Landed-behavior notes that shape the assertions below (verified
// against the live tree):
//
// 1. All three calc columns use `cellDataType: 'number'` — NOT
//    'currency'/'percent' for notional/pctOfSector. Kernel's
//    cellDataType is BINARY (packages/kernel/src/types/column.ts); the
//    paint path only invokes the compiled `valueFormatter` for
//    numericCols-backed ('number') columns (velocityGrid.ts `cellAt`'s
//    `numeric` branch calls `formatNumber`; the `text` branch renders
//    the raw decoded string with no formatter pass). Currency/percent
//    PRESENTATION comes entirely from the `format` string; the
//    CellDataType stays 'number' so the value round-trips as a real
//    JS number via getCellValue AND paints formatted.
// 2. A `cellDataType: 'number'` calc column's chunk slot is a
//    Float64Array (viewportSlicer.ts: `arr[i] = Number(src.valueAt(...))`)
//    — it cannot represent `null`. `Number(null) === 0`, so PREV's
//    "no capture yet" null resolves to `0` on read-back via
//    getCellValue, not `null`.
//
// Seed notionals: AAPL 30000, MSFT 30000, NVDA 25000 (Tech 85000);
// XOM 40000, CVX 15000 (Energy 55000); JPM 60000, GS 10000
// (Finance 70000). Grand total 210000.
//
// pctOfSector aggregates the DATA field [qty] via SUM([qty], 'group')
// — NOT the notional calc column. The landed CalcEngine rejects
// calc-on-calc references (registerCalculatedColumn, Task 12 review
// fix: the worker's Stage A/B pipeline has no defined evaluation order
// between calc columns within a single pass), so SUM([notional],
// 'group') would be rejected at registration time. Seed qtys: AAPL
// 200, MSFT 100, NVDA 50 (Tech 350); XOM 400, CVX 100 (Energy 500);
// JPM 300, GS 25 (Finance 325). Grand total qty 1175.

/** Chunk value for `colId` on the row whose symbol cell matches —
 *  index-independent so it survives sorting AND grouping (group header
 *  rows scan past as non-matches). undefined ⇒ symbol not found. */
async function cellOf(page: Page, symbol: string, colId: string): Promise<unknown> {
  return page.evaluate(([sym, col]) => {
    const g = window.__cgrid as any;
    const n = g.getDisplayedRowCount?.() ?? g.rowCount ?? 0;
    for (let i = 0; i < n; i += 1) {
      if (g.getCellValue(i, 'symbol') === sym) return g.getCellValue(i, col);
    }
    return undefined;
  }, [symbol, colId] as const);
}

test.describe('calculated columns (calc)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFeature(page, 'calculated-columns');
    // Stage-A values arrive with the first worker chunk — settle on
    // notional before each test body.
    await expect.poll(() => cellOf(page, 'AAPL', 'notional')).toBe(30_000);
  });

  test('mounts 7 rows, synthesizes the three calc columns, engine probe wired', async ({ page }) => {
    const rowCount: number = await page.evaluate(() => (window.__cgrid as any)?.rowCount ?? 0);
    expect(rowCount).toBe(7);
    const info = await page.evaluate(() => {
      const g = window.__cgrid as any;
      const calc = (window as any).__cgridCalc;
      return {
        calcDefIds: calc?.listCalculatedColumns().map((d: any) => d.colId),
        synthesized: ['notional', 'pctOfSector', 'pxChange'].map((id) => g.columnDefsMap.has(id)),
      };
    });
    expect(info.calcDefIds).toEqual(['notional', 'pctOfSector', 'pxChange']);
    expect(info.synthesized).toEqual([true, true, true]);
    await expect(page.locator('#desc-bar')).toContainText('Cycle 21d');
  });

  test('notional (row-local Stage A) sorts like an ordinary column', async ({ page }) => {
    await page.evaluate(() =>
      (window.__cgrid as any).setSortModel([{ colId: 'notional', sort: 'desc' }]));
    // Worker re-sort is async (setSortModel → round-trip → chunk).
    await page.waitForFunction(
      () => (window.__cgrid as any).getCellValue(0, 'symbol') === 'JPM',
      undefined, { timeout: 5_000 },
    );
    expect(await page.evaluate(() => (window.__cgrid as any).getCellValue(0, 'notional'))).toBe(60_000);
    expect(await page.evaluate(() => (window.__cgrid as any).getCellValue(1, 'symbol'))).toBe('XOM'); // 40 000
  });

  test("pctOfSector re-scopes live when grouping toggles ('group' scope)", async ({ page }) => {
    // Ungrouped: 'group' promotes to the whole visible set —
    // AAPL qty 200 / grand qty 1175.
    await expect.poll(() => cellOf(page, 'AAPL', 'pctOfSector'))
      .toBeCloseTo(200 / 1175, 4);

    await page.getByTestId('btn-calc-group').click();

    // Grouped by sector (groupDefaultExpanded 'all' keeps leaves
    // visible): AAPL qty 200 / Tech qty 350.
    await expect.poll(() => cellOf(page, 'AAPL', 'pctOfSector'))
      .toBeCloseTo(200 / 350, 4);
  });

  test('PREV: pxChange shows the tick delta after one deterministic tick', async ({ page }) => {
    // No transaction yet → the interpreter's PREV result is null
    // ("errors → null cell"), but the chunk's numericCols slot is a
    // Float64Array, which cannot represent null, so the wire-format
    // round-trip coerces it to 0 (viewportSlicer.ts: `Number(null) ===
    // 0`). See module doc note 2.
    expect(await cellOf(page, 'AAPL', 'pxChange')).toBe(0);
    await page.getByTestId('btn-calc-tick-once').click();
    await expect.poll(() => cellOf(page, 'AAPL', 'pxChange')).toBeCloseTo(1.25, 6);
    // Untouched rows stay at the PREV-unresolved 0 — PREV is
    // tick-scoped to touched rows.
    expect(await cellOf(page, 'GS', 'pxChange')).toBe(0);
  });

  test('template + override fold renames headers and narrows widths', async ({ page }) => {
    await page.getByTestId('btn-calc-template').click();
    // onColumnsChanged → kernel colDef rebuild is async — poll the
    // resolved defs.
    await expect
      .poll(() => page.evaluate(() =>
        (window.__cgrid as any).columnDefsMap.get('price')?.headerName))
      .toBe('Px (compact)');
    const folded = await page.evaluate(() => {
      const g = window.__cgrid as any;
      return {
        qtyHeader: g.columnDefsMap.get('qty')?.headerName,
        qtyWidth: g.columnDefsMap.get('qty')?.width,
        priceWidth: g.columnDefsMap.get('price')?.width,
      };
    });
    expect(folded.qtyHeader).toBe('Numeric'); // template layer
    expect(folded.qtyWidth).toBe(90);         // template width on both
    expect(folded.priceWidth).toBe(90);       // …assignment only renamed
  });

  test('calc columns are non-editable and ignore editable overrides', async ({ page }) => {
    // CalcEngine.applyOverrides validates shape (non-empty colId,
    // compiling format) but does NOT reject an `editable` override
    // targeting a calc colId — that happens downstream, silently, at
    // fold time: overrideToKernelPatch drops the `editable` key when
    // `isCalcColumn` is true (packages/calc/src/calcEngine.ts
    // resolvedPatchFor → overrideToKernelPatch), so the accepted
    // override never reaches the resolved colDef. Synthesized defs
    // pin `editable: false` at registration and that pin survives.
    const res = await page.evaluate(() => {
      const g = window.__cgrid as any;
      const calc = (window as any).__cgridCalc;
      const before = g.columnDefsMap.get('notional')?.editable;
      const attempt = calc.applyOverrides([{ colId: 'notional', editable: true }]);
      return { before, attempt };
    });
    expect(res.before).toBe(false);        // synthesized defs pin editable: false
    expect(res.attempt.ok).toBe(true);     // shape-valid override is accepted…
    expect(res.attempt.errors).toEqual([]);
    // …but folds to a no-op: editable stays false on the resolved def.
    await expect
      .poll(() => page.evaluate(() => (window.__cgrid as any).columnDefsMap.get('notional')?.editable))
      .toBe(false);
  });
});
