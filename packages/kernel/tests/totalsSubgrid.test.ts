import { describe, it, expect } from 'vitest';
import { TotalsSubgrid, type Subgrid } from '../src/core/subgrid';
import { computeViewport } from '../src/core/viewport';

// ─── Tiny test factories ──────────────────────────────────────────────
// Mirror the shape used by `tests/viewport.test.ts` so the viewport-math
// assertions below stay focused on the totals-row plumbing.

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

/** Build a totals subgrid with a stored totals map (the unit-of-behaviour
 *  here is the lookup callback — the chunk-side details live elsewhere). */
function totalsWith(
  totals: Record<string, { value: unknown; valueFormatted: string }>,
  height = 30,
): TotalsSubgrid {
  return new TotalsSubgrid(
    () => height,
    (colId) => totals[colId] ?? null,
  );
}

describe('TotalsSubgrid — surface', () => {
  it('declares type/isTotals true and all other isX flags false', () => {
    const sg = totalsWith({});
    expect(sg.type).toBe('totals');
    expect(sg.isTotals).toBe(true);
    expect(sg.isHeader).toBe(false);
    expect(sg.isData).toBe(false);
    expect(sg.isFooter).toBe(false);
    expect(sg.isFloatingFilter).toBeUndefined();
  });

  it('reports exactly one row (single grand-total)', () => {
    const sg = totalsWith({});
    expect(sg.getRowCount()).toBe(1);
  });

  it('returns the configured row height (default body height)', () => {
    const sg = totalsWith({}, 30);
    expect(sg.getRowHeight(0)).toBe(30);
  });

  it('honours a per-call height override accessor', () => {
    let h = 30;
    const sg = new TotalsSubgrid(() => h, () => null);
    expect(sg.getRowHeight(0)).toBe(30);
    h = 44; // simulate a `pinnedRowHeight` override landing at runtime
    expect(sg.getRowHeight(0)).toBe(44);
  });

  it('getCell returns the lookup result (value + valueFormatted)', () => {
    const sg = totalsWith({
      price: { value: 1234.5, valueFormatted: '1,234.50' },
    });
    expect(sg.getCell(0, 'price')).toEqual({
      value: 1234.5,
      valueFormatted: '1,234.50',
    });
  });

  it('getCell returns null when the column has no totals entry (no aggFunc)', () => {
    const sg = totalsWith({ price: { value: 0, valueFormatted: '0' } });
    expect(sg.getCell(0, 'unrelatedColumn')).toBeNull();
  });
});

describe('TotalsSubgrid — viewport-math placement', () => {
  it('mounts at the BOTTOM when stacked AFTER the data subgrid', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      // Stack: header → data → totals. Totals appears in pass 3 (post-data).
      subgrids: [header(32), data(10, 30), totalsWith({}, 28)],
      containerWidth: 100,
      containerHeight: 200,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    const totalsRows = vs.visibleRows.filter((r) => r.subgrid.isTotals);
    expect(totalsRows).toHaveLength(1);
    const totalsRow = totalsRows[0]!;
    const dataRows = vs.visibleRows.filter((r) => r.subgrid.isData);
    const lastData = dataRows[dataRows.length - 1]!;
    // Totals row sits immediately below the last visible data row.
    expect(totalsRow.top).toBe(lastData.bottom);
    expect(totalsRow.bottom - totalsRow.top).toBe(28);
  });

  it('mounts at the TOP when stacked BEFORE the data subgrid (still post-header)', () => {
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      // Stack: header → totals (top) → data. Totals lands in pass 1.
      subgrids: [header(32), totalsWith({}, 28), data(10, 30)],
      containerWidth: 100,
      containerHeight: 200,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    const totalsRow = vs.visibleRows.find((r) => r.subgrid.isTotals)!;
    expect(totalsRow.top).toBe(32);          // immediately below the 32px header
    expect(totalsRow.bottom).toBe(60);       // 32 + 28
    // bodyTop is now the SUM of header + totals heights so the scrollable
    // data region starts beneath the totals row.
    expect(vs.bodyTop).toBe(60);
  });

  it('null = no totals subgrid in the stack ⇒ zero totals rows in viewport', () => {
    // Caller's responsibility (cgrid.ts) — if options.totalsRowPosition is
    // null/omitted, no TotalsSubgrid is pushed. The viewport should then
    // contain only header + data rows.
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), data(10, 30)],
      containerWidth: 100,
      containerHeight: 200,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    expect(vs.visibleRows.filter((r) => r.subgrid.isTotals)).toHaveLength(0);
  });

  it('totals row sticks at the body bottom regardless of scrollTop (non-scrolling)', () => {
    // Tall data subgrid, scrolled deep. The totals row must remain at the
    // same y-position relative to the visible band (it does NOT scroll).
    const baseline = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), data(1000, 30), totalsWith({}, 28)],
      containerWidth: 100,
      containerHeight: 500,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    const scrolled = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), data(1000, 30), totalsWith({}, 28)],
      containerWidth: 100,
      containerHeight: 500,
      scrollLeft: 0, scrollTop: 4000,
      overscanRows: 0,
    });
    const baselineTotals = baseline.visibleRows.find((r) => r.subgrid.isTotals)!;
    const scrolledTotals = scrolled.visibleRows.find((r) => r.subgrid.isTotals)!;
    // Body region is fixed (header(32)→data→totals(28)); totals top equals
    // last-data-bottom in both cases.
    const baselineLastData = baseline.visibleRows.filter((r) => r.subgrid.isData).at(-1)!;
    const scrolledLastData = scrolled.visibleRows.filter((r) => r.subgrid.isData).at(-1)!;
    expect(baselineTotals.top).toBe(baselineLastData.bottom);
    expect(scrolledTotals.top).toBe(scrolledLastData.bottom);
  });

  it('coexists with FloatingFilter — totals lands after data, filter lands after header', () => {
    // Stack: header → floatingFilter → data → totals. Both non-data
    // subgrids should slot at their structural positions.
    const ff: Subgrid = {
      type: 'floatingFilter',
      isHeader: false, isData: false, isTotals: false, isFooter: false,
      isFloatingFilter: true,
      getRowCount: () => 1,
      getRowHeight: () => 24,
      getCell: () => null,
    };
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), ff, data(20, 30), totalsWith({}, 28)],
      containerWidth: 100,
      containerHeight: 300,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    expect(vs.bodyTop).toBe(56); // 32 (header) + 24 (filter)
    expect(vs.floatingFilterRowTop).toBe(32);
    expect(vs.floatingFilterRowHeight).toBe(24);
    const totalsRow = vs.visibleRows.find((r) => r.subgrid.isTotals)!;
    expect(totalsRow.height).toBe(28);
    // Totals row sits AFTER the last visible data row.
    const lastData = vs.visibleRows.filter((r) => r.subgrid.isData).at(-1)!;
    expect(totalsRow.top).toBe(lastData.bottom);
  });

  it('honours per-grid pinnedRowHeight override (Cycle 5 — variable row heights)', () => {
    // Simulating a taller totals row (e.g. caller sets a 40px row for the
    // grand-total). Viewport math should reserve exactly that height.
    const vs = computeViewport({
      columnLayout: [{ colId: 'a', left: 0, width: 100 }],
      subgrids: [header(32), data(5, 30), totalsWith({}, 40)],
      containerWidth: 100,
      containerHeight: 300,
      scrollLeft: 0, scrollTop: 0,
      overscanRows: 0,
    });
    const totalsRow = vs.visibleRows.find((r) => r.subgrid.isTotals)!;
    expect(totalsRow.height).toBe(40);
    expect(totalsRow.bottom - totalsRow.top).toBe(40);
  });
});

describe('TotalsSubgrid — chunk-driven refresh', () => {
  it('a fresh lookup is consulted on every getCell call (no internal caching)', () => {
    // A stale cache would be a bug — the chunk reference changes on every
    // worker reply, so the subgrid must always read through to the
    // current chunk. We assert by mutating the closure's source-of-truth
    // and observing the second getCell call returns the new value.
    let totals: Record<string, { value: number; valueFormatted: string }> = {
      price: { value: 10, valueFormatted: '10' },
    };
    const sg = new TotalsSubgrid(() => 30, (colId) => totals[colId] ?? null);
    expect(sg.getCell(0, 'price')?.valueFormatted).toBe('10');

    totals = { price: { value: 999, valueFormatted: '999' } };
    expect(sg.getCell(0, 'price')?.valueFormatted).toBe('999');
  });

  it('returns null for an unknown column even after a chunk lands', () => {
    const sg = totalsWith({ price: { value: 1, valueFormatted: '1' } });
    expect(sg.getCell(0, 'volume')).toBeNull();
  });
});
