/**
 * Cycle 26 — regression lock for the per-row snapshot gate.
 *
 * `rowDataSnapshotAt` costs one `cellAt` per visible column, per data row,
 * per paint — a second full pass over every row on top of the cell loop's
 * own `cellData` fetches. The gate skips it when nothing can read it and
 * must still compute it for each of the three real consumers:
 *
 *   1. column style callbacks (`cellClassFn` / `cellClassRules` /
 *      `cellStyleFn`),
 *   2. a FUNCTION-form `cellIcon` (string/IconRef forms never read data),
 *   3. the rule-engine ruleRow fallback when the `getRowDataById` mirror
 *      misses (the mirror is preferred; the snapshot is only the fallback).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { paintCellsByRows } from '../src/renderer/painters/byRows';
import { CellRendererRegistry, textCell, headerCell } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
});

const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 10, getRowHeight: () => 30, getCell: () => null,
};

function fakeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), closePath: vi.fn(),
    translate: vi.fn(), scale: vi.fn(),
    measureText: () => ({ width: 50 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) { return target[key]; },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
}

const theme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
  cellClassVariants: new Map(), headerClassVariants: new Map(),
} as unknown as ResolvedTheme;

function makeVs(): ViewportState {
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ],
    visibleRows: [
      { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 0, bottom: 30, height: 30 },
      { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 1, top: 30, bottom: 60, height: 30 },
    ],
    firstRow: 0, lastRow: 1,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: 100, bodyTop: 0, bodyBottom: 60, bodyWidth: 100, bodyHeight: 60,
    contentWidth: 100, contentHeight: 300, maxScrollLeft: 0, maxScrollTop: 240,
  } as ViewportState;
}

function makeReg(): CellRendererRegistry {
  const reg = new CellRendererRegistry();
  reg.register('text', textCell);
  reg.register('header', headerCell);
  return reg;
}

function baseDef(over: Partial<ResolvedColDef> = {}): ResolvedColDef {
  return {
    colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity,
    cellDataType: 'text', cellRenderer: 'text', sortable: true, resizable: true,
    editable: false, suppressFloatingFilterButton: false,
    ...over,
  } as ResolvedColDef;
}

/** Paint two data rows; return the snapshot spy + what a callback saw. */
function paint(def: ResolvedColDef, opts: {
  stringRowIdAt?: (rowIndex: number) => string;
  getRowDataById?: (rowId: string) => Record<string, unknown> | undefined;
} = {}) {
  const snapshot = vi.fn((rowIndex: number) => ({ a: `row-${rowIndex}` }));
  paintCellsByRows(fakeGc(), {
    viewport: makeVs(), theme, columnDefs: new Map([['a', def]]),
    cellRenderers: makeReg(),
    cellData: () => ({ value: 42, valueFormatted: '42' }),
    selection: { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() },
    sortModel: [], rowDataSnapshotAt: snapshot, quickFilterLowerTerms: [],
    stringRowIdAt: opts.stringRowIdAt,
    getRowDataById: opts.getRowDataById,
  } as never);
  return snapshot;
}

describe('byRows — rowData snapshot gate', () => {
  it('SKIPS the snapshot when no visible column can read it', () => {
    const snapshot = paint(baseDef());
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('skips the snapshot for a string-form cellIcon (never reads data)', () => {
    const snapshot = paint(baseDef({ cellIcon: 'star' } as Partial<ResolvedColDef>));
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('computes the snapshot when a column declares cellClassRules', () => {
    // Resolved form: pre-compiled `{ className, predicate }` entries.
    const snapshot = paint(baseDef({
      cellClassRules: [{ className: 'vg-cell-red', predicate: () => false }],
    } as unknown as Partial<ResolvedColDef>));
    expect(snapshot).toHaveBeenCalledTimes(2); // once per data row
  });

  it('computes the snapshot when a column declares cellStyleFn', () => {
    const snapshot = paint(baseDef({
      cellStyleFn: () => undefined,
    } as Partial<ResolvedColDef>));
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('feeds the snapshot to a function-form cellIcon via params.data', () => {
    const seen: unknown[] = [];
    const snapshot = paint(baseDef({
      cellIcon: (params: { data: unknown }) => { seen.push(params.data); return null; },
    } as Partial<ResolvedColDef>));
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([{ a: 'row-0' }, { a: 'row-1' }]);
  });

  it('skips the snapshot when the rule-fold mirror has the row', () => {
    const mirror = { a: 'from-mirror', hidden: 1 };
    const snapshot = paint(baseDef(), {
      stringRowIdAt: (ri) => `id-${ri}`,
      getRowDataById: () => mirror,
    });
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('falls back to the snapshot when the mirror misses a row with identity', () => {
    const snapshot = paint(baseDef(), {
      stringRowIdAt: (ri) => `id-${ri}`,
      getRowDataById: () => undefined,
    });
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
});
