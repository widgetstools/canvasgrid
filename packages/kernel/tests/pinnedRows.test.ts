import { describe, it, expect } from 'vitest';
import { PinnedRowsSubgrid, TotalsSubgrid, type Subgrid, type SubgridCell } from '../src/core/subgrid';
import { computeViewport } from '../src/core/viewport';
import { applyRuntimeOption, type RuntimeOptionTarget } from '../src/core/runtimeOptions';
import type { CGridOptions } from '../src/types';

// Cycle 14 / Task 2 — PinnedRowsSubgrid behaviour test suite.
//
// The unit-of-behaviour is the SUBGRID (data array → cells), the VIEWPORT
// (stack placement → row positioning), and the RUNTIME OPTION HOOK (the
// `pinnedTopRowData` / `pinnedBottomRowData` setGridOption path rebuilds
// the subgrid stack via `rebuildSubgrids`). Integration coverage for the
// full mount→paint cycle lives in the visual matrix cell 18 — that's
// where the chrome decisions from the design notes get a pixel diff.

// ─── Tiny test factories ──────────────────────────────────────────────

function header(height = 32): Subgrid {
  return {
    type: 'header',
    isHeader: true, isData: false, isTotals: false, isFooter: false,
    getRowCount: () => 1,
    getRowHeight: () => height,
    getCell: () => null,
  };
}

function data(rowCount = 100, rowHeight = 30): Subgrid {
  return {
    type: 'data',
    isHeader: false, isData: true, isTotals: false, isFooter: false,
    getRowCount: () => rowCount,
    getRowHeight: () => rowHeight,
    getCell: () => null,
  };
}

interface Row {
  label: string;
  notional: number;
  pnl: number;
}

/** Build a pinned subgrid backed by a literal row array and a lookup that
 *  pulls `row[colId]` and runs an optional column-formatter. The default
 *  formatter `String(value)` mirrors the cgrid.ts pinnedCellLookup fallback
 *  used when a column has no valueFormatter declared. */
function pinnedWith(
  rows: Row[],
  height = 30,
  formatters: Record<string, (v: unknown) => string> = {},
): PinnedRowsSubgrid<Row> {
  return new PinnedRowsSubgrid<Row>(
    () => rows,
    () => height,
    (row, colId) => {
      const value = (row as unknown as Record<string, unknown>)[colId];
      const formatter = formatters[colId];
      const valueFormatted = formatter
        ? formatter(value)
        : (value == null ? '' : String(value));
      return { value, valueFormatted } satisfies SubgridCell;
    },
  );
}

describe('PinnedRowsSubgrid — surface', () => {
  // CASE 1 — Class shape: type/isPinned + other isX flags are correctly
  // declared so the painter's branching (byRows.ts row-bg + cell pass) hits
  // the pinned branch and not the totals/data/header branches.
  it('declares type/isPinned true and all other isX flags false', () => {
    const sg = pinnedWith([{ label: 'Benchmark', notional: 100, pnl: 0 }]);
    expect(sg.type).toBe('pinned');
    expect(sg.isPinned).toBe(true);
    expect(sg.isHeader).toBe(false);
    expect(sg.isData).toBe(false);
    expect(sg.isTotals).toBe(false);
    expect(sg.isFooter).toBe(false);
    expect(sg.isFloatingFilter).toBeUndefined();
  });

  // CASE 2 — Multiple rows: getRowCount mirrors the data array's length so
  // a 3-row pinned stack renders 3 rows. Single source of truth (the
  // caller's array); a wrapper that froze the count would silently drop
  // updates when the array swapped.
  it('reports getRowCount === rows.length and reflects array swaps', () => {
    const rowsA: Row[] = [
      { label: 'Benchmark', notional: 1, pnl: 0 },
      { label: 'Target',    notional: 2, pnl: 0 },
      { label: 'Watchlist', notional: 3, pnl: 0 },
    ];
    let current: Row[] = rowsA;
    const sg = new PinnedRowsSubgrid<Row>(
      () => current,
      () => 30,
      (row, colId) => ({
        value: (row as unknown as Record<string, unknown>)[colId],
        valueFormatted: String((row as unknown as Record<string, unknown>)[colId] ?? ''),
      }),
    );
    expect(sg.getRowCount()).toBe(3);
    // Array swap (the runtime path setGridOption follows) — count updates
    // without rebuilding the subgrid instance.
    current = [{ label: 'Benchmark', notional: 9, pnl: 0 }];
    expect(sg.getRowCount()).toBe(1);
  });

  // CASE 3 — getCell reads through to the array entry via the supplied
  // lookup. This is the path that cgrid.ts's `pinnedCellLookup` plugs into;
  // here we verify the SubgridCell shape returned (value + valueFormatted).
  it('getCell returns the lookup result for each row × column', () => {
    const rows: Row[] = [
      { label: 'Benchmark', notional: 100, pnl: 5 },
      { label: 'Target',    notional: 200, pnl: -3 },
    ];
    const sg = pinnedWith(rows);
    expect(sg.getCell(0, 'label')).toEqual({ value: 'Benchmark', valueFormatted: 'Benchmark' });
    expect(sg.getCell(1, 'notional')).toEqual({ value: 200, valueFormatted: '200' });
    expect(sg.getCell(1, 'pnl')).toEqual({ value: -3, valueFormatted: '-3' });
  });

  // CASE 4 — getCell honours the supplied formatter (the column's
  // valueFormatter equivalent). This is the contract that lets a
  // moneyFormatter-decorated column render identically in a data row and
  // a pinned reference row.
  it('routes values through the column formatter when supplied', () => {
    const rows: Row[] = [{ label: 'Benchmark', notional: 12345, pnl: 0 }];
    const sg = pinnedWith(rows, 30, {
      notional: (v) => `$${Number(v).toLocaleString('en-US')}`,
    });
    const cell = sg.getCell(0, 'notional')!;
    expect(cell.value).toBe(12345);
    expect(cell.valueFormatted).toBe('$12,345');
  });

  // CASE 5 — getCell returns null for out-of-range rows. This guards
  // against the painter trying to read a row that the array no longer
  // contains (e.g. after a setGridOption shrink). Returning null lets
  // byRows.ts skip the cell cleanly.
  it('returns null when localRowIndex is past the array end', () => {
    const sg = pinnedWith([{ label: 'Benchmark', notional: 1, pnl: 0 }]);
    expect(sg.getCell(5, 'label')).toBeNull();
  });
});

describe('PinnedRowsSubgrid — viewport-math placement', () => {
  // CASE 6 — Pinned-TOP stack: a PinnedRowsSubgrid stacked BEFORE the
  // DataSubgrid pins at the top of the body (computeViewport's pass-1
  // pre-data band). Multi-row stacks contribute every row in array order.
  it('mounts at the TOP when stacked BEFORE the data subgrid (N rows contribute to bodyTop)', () => {
    const pinned = pinnedWith([
      { label: 'Benchmark', notional: 100, pnl: 0 },
      { label: 'Target',    notional: 200, pnl: 0 },
    ], 28);
    const vs = computeViewport({
      columnLayout: [{ colId: 'label', left: 0, width: 100 }],
      subgrids: [header(32), pinned, data(10, 30)],
      containerWidth: 100,
      containerHeight: 400,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    const pinnedRows = vs.visibleRows.filter((r) => r.subgrid.isPinned);
    expect(pinnedRows).toHaveLength(2);
    expect(pinnedRows[0]!.top).toBe(32);     // immediately below the 32px header
    expect(pinnedRows[0]!.bottom).toBe(60);  // 32 + 28
    expect(pinnedRows[1]!.top).toBe(60);     // stacked under row 0
    expect(pinnedRows[1]!.bottom).toBe(88);  // 60 + 28
    // bodyTop is now the SUM of header + pinned rows so the scrollable
    // data band starts beneath the pinned stack.
    expect(vs.bodyTop).toBe(88);
    // localRowIndex values point at the array entries (0, 1).
    expect(pinnedRows[0]!.localRowIndex).toBe(0);
    expect(pinnedRows[1]!.localRowIndex).toBe(1);
  });

  // CASE 7 — Pinned-BOTTOM stack: a PinnedRowsSubgrid stacked AFTER the
  // DataSubgrid lands in computeViewport's pass-3 post-data band. The
  // pinned rows sit immediately below the last visible data row and DO
  // NOT scroll — verified by snapshotting two viewports at different
  // scrollTops and asserting the pinned row stays glued to the last data
  // row's bottom in both.
  it('mounts at the BOTTOM (post-data band) and stays non-scrolling under scroll', () => {
    const pinned = pinnedWith([{ label: 'Watchlist anchor', notional: 0, pnl: 0 }], 28);
    const opts = (scrollTop: number) => ({
      columnLayout: [{ colId: 'label', left: 0, width: 100 }],
      subgrids: [header(32), data(1000, 30), pinned],
      containerWidth: 100,
      containerHeight: 500,
      scrollLeft: 0, scrollTop,
      overscanRows: 0,
    });
    const baseline = computeViewport(opts(0));
    const scrolled = computeViewport(opts(4000));
    const basePinned = baseline.visibleRows.find((r) => r.subgrid.isPinned)!;
    const scrolledPinned = scrolled.visibleRows.find((r) => r.subgrid.isPinned)!;
    const baseLastData = baseline.visibleRows.filter((r) => r.subgrid.isData).at(-1)!;
    const scrolledLastData = scrolled.visibleRows.filter((r) => r.subgrid.isData).at(-1)!;
    expect(basePinned.top).toBe(baseLastData.bottom);
    expect(scrolledPinned.top).toBe(scrolledLastData.bottom);
    expect(basePinned.height).toBe(28);
    expect(scrolledPinned.height).toBe(28);
  });

  // CASE 8 — Empty data array → ZERO rows contributed to the viewport.
  // This is the contract callers rely on for the "null / empty array
  // suppresses the row" semantic: cgrid.ts only mounts the subgrid when
  // the array is non-empty, but even if it DID push an empty subgrid the
  // viewport math wouldn't see it as a row source. Defence in depth.
  it('empty data array contributes zero rows to the visible stack', () => {
    const empty = pinnedWith([], 28);
    const vs = computeViewport({
      columnLayout: [{ colId: 'label', left: 0, width: 100 }],
      subgrids: [header(32), empty, data(10, 30)],
      containerWidth: 100,
      containerHeight: 300,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    expect(vs.visibleRows.filter((r) => r.subgrid.isPinned)).toHaveLength(0);
    // bodyTop reflects header only — the empty pinned subgrid contributes
    // zero height even when present in the stack.
    expect(vs.bodyTop).toBe(32);
  });

  // CASE 9 — Coexistence with TotalsSubgrid at the same edge. The design
  // plan (cycle-14-aggregation-design.md § Task 2 — Coexistence) puts
  // totals OUTERMOST (closest to the chrome edge) and pinned INNERMOST
  // (closest to data). For bottom: data → pinned-bottom → totals. We
  // assert the y-order in the visible stack mirrors that, AND that both
  // subgrids contribute exactly one row each at their declared heights.
  it('coexists with a totals subgrid — order is data → pinned → totals (bottom)', () => {
    const pinned = pinnedWith([{ label: 'Benchmark', notional: 1, pnl: 0 }], 28);
    const totals = new TotalsSubgrid(() => 30, () => ({ value: 0, valueFormatted: '0' }));
    const vs = computeViewport({
      columnLayout: [{ colId: 'label', left: 0, width: 100 }],
      subgrids: [header(32), data(20, 30), pinned, totals],
      containerWidth: 100,
      containerHeight: 300,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    const pinnedRow = vs.visibleRows.find((r) => r.subgrid.isPinned)!;
    const totalsRow = vs.visibleRows.find((r) => r.subgrid.isTotals)!;
    const lastData = vs.visibleRows.filter((r) => r.subgrid.isData).at(-1)!;
    // Order: data ends, pinned starts immediately, totals starts at pinned end.
    expect(pinnedRow.top).toBe(lastData.bottom);
    expect(totalsRow.top).toBe(pinnedRow.bottom);
    expect(pinnedRow.height).toBe(28);
    expect(totalsRow.height).toBe(30);
  });
});

describe('PinnedRowsSubgrid — runtime option hook', () => {
  // CASE 10 — Runtime mutation: setGridOption('pinnedTopRowData', …)
  // routes through `applyRuntimeOption` which fires `rebuildSubgrids` on
  // the target. We exercise the runtime-options module directly here (no
  // CGrid + worker spin-up) to assert the wiring exists and is reachable.
  // The cgrid.ts adapter's `rebuildSubgrids` implementation
  // (rebuildSubgridStack + recomputeViewport + repaint) is exercised by
  // the integration-level visual matrix cell 18.
  it('setGridOption("pinnedTopRowData", …) invokes rebuildSubgrids on the runtime target', () => {
    const options: CGridOptions<Row> = { columnDefs: [] };
    let rebuildCount = 0;
    let refreshCount = 0;
    const target: RuntimeOptionTarget<Row> = {
      options,
      setTheme: () => {},
      rebuildColumns: () => {},
      refreshLayout: () => { refreshCount++; },
      setSelectionMode: () => {},
      applyRowData: () => {},
      applyQuickFilter: () => {},
      forwardEnableCellChangeFlash: () => {},
      rebuildSubgrids: () => { rebuildCount++; },
    };
    // Storage is the CALLER's job (cgrid.ts does it before invoking the
    // applyRuntimeOption table); mirror that here so the assertion mirrors
    // the live path.
    options.pinnedTopRowData = [{ label: 'Benchmark', notional: 1, pnl: 0 }];
    applyRuntimeOption(target, 'pinnedTopRowData', options.pinnedTopRowData);
    expect(rebuildCount).toBe(1);
    expect(refreshCount).toBe(0); // rebuildSubgrids replaces refreshLayout for this key

    // And the bottom array routes through the same hook.
    options.pinnedBottomRowData = [{ label: 'Total', notional: 0, pnl: 0 }];
    applyRuntimeOption(target, 'pinnedBottomRowData', options.pinnedBottomRowData);
    expect(rebuildCount).toBe(2);
  });
});
