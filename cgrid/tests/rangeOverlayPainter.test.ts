import { describe, it, expect, vi } from 'vitest';
import { paintRangeOverlay } from '../src/renderer/painters/rangeOverlayPainter';
import { CellRendererRegistry } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';
import type { SelectionRange } from '../src/types';

// Minimal subgrid stubs — `isData` is the only flag the painter inspects when
// it walks `visibleRows` looking for data rows that fall inside a range.
const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 1000, getRowHeight: () => 30, getCell: () => null,
};
const headerSubgrid: Subgrid = {
  type: 'header', isHeader: true, isData: false, isTotals: false, isFooter: false,
  getRowCount: () => 1, getRowHeight: () => 32, getCell: () => null,
};

function fakeGc(): CachedContext2D {
  const ctx: any = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(),
    measureText: () => ({ width: 0 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1,
  };
  ctx.cache = new Proxy(ctx, {
    get(target, key) { return target[key]; },
    set(target, key, value) { target[key] = value; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
}

const theme: ResolvedTheme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  quickFilterMatchBg: '#fff3b8',
  unsortIconColor: 'rgba(0,0,0,0.4)',
  rangeFillColor: 'rgba(59,130,246,0.22)',
  rangeBorderColor: '#3b82f6',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
  cellClassVariants: new Map(), headerClassVariants: new Map(),
} as ResolvedTheme;

const cols = new Map<string, ResolvedColDef>([
  ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
  ['b', { colId: 'b', headerName: 'B', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
  ['c', { colId: 'c', headerName: 'C', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
]);

const cellData = () => ({ value: 'x', valueFormatted: 'x' });

// Header row at y=[0,32] + 5 data rows at y=[32..182], localRowIndex 0..4.
function makeVs(): ViewportState {
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
      { colId: 'b', index: 1, left: 100, right: 200, width: 100 },
      { colId: 'c', index: 2, left: 200, right: 300, width: 100 },
    ],
    visibleRows: [
      { rowIndex: 0, subgrid: headerSubgrid, localRowIndex: 0, top: 0, bottom: 32, height: 32 },
      { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
      { rowIndex: 2, subgrid: dataSubgrid, localRowIndex: 1, top: 62, bottom: 92, height: 30 },
      { rowIndex: 3, subgrid: dataSubgrid, localRowIndex: 2, top: 92, bottom: 122, height: 30 },
      { rowIndex: 4, subgrid: dataSubgrid, localRowIndex: 3, top: 122, bottom: 152, height: 30 },
      { rowIndex: 5, subgrid: dataSubgrid, localRowIndex: 4, top: 152, bottom: 182, height: 30 },
    ],
    firstRow: 0, lastRow: 4,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: 300, bodyTop: 32, bodyBottom: 182, bodyWidth: 300, bodyHeight: 150,
    contentWidth: 300, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 850,
  };
}

function pctx(vs: ViewportState, ranges: SelectionRange[]) {
  return {
    viewport: vs,
    theme,
    columnDefs: cols,
    cellRenderers: new CellRendererRegistry(),
    cellData,
    selection: { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>(), ranges },
    sortModel: [],
    rowDataSnapshotAt: () => ({}),
    quickFilterLowerTerms: [],
  };
}

describe('paintRangeOverlay', () => {
  it('no ranges → no fillRect or strokeRect calls', () => {
    const gc = fakeGc();
    paintRangeOverlay(gc, pctx(makeVs(), []));
    expect((gc.fillRect as any)).not.toHaveBeenCalled();
    expect((gc.strokeRect as any)).not.toHaveBeenCalled();
  });

  it('one range → exactly one fillRect + one strokeRect with the bounding rect', () => {
    const gc = fakeGc();
    // Range: rows 1..3 × cols a..b. Expected bounding rect from viewport:
    // x = a.left (0), y = row(local=1).top (62),
    // w = b.right - a.left (200), h = row(local=3).bottom - row(local=1).top (152 - 62 = 90).
    paintRangeOverlay(gc, pctx(makeVs(), [{ rowStart: 1, rowEnd: 3, colIds: ['a', 'b'] }]));
    const fillCalls = (gc.fillRect as any).mock.calls as number[][];
    const strokeCalls = (gc.strokeRect as any).mock.calls as number[][];
    expect(fillCalls.length).toBe(1);
    expect(strokeCalls.length).toBe(1);
    const [fx, fy, fw, fh] = fillCalls[0]!;
    expect(fx).toBe(0);
    expect(fy).toBe(62);
    expect(fw).toBe(200);
    expect(fh).toBe(90);
  });

  it('two ranges → one fillRect + one strokeRect per range', () => {
    const gc = fakeGc();
    paintRangeOverlay(gc, pctx(makeVs(), [
      { rowStart: 0, rowEnd: 0, colIds: ['a'] },
      { rowStart: 2, rowEnd: 4, colIds: ['b', 'c'] },
    ]));
    expect((gc.fillRect as any).mock.calls.length).toBe(2);
    expect((gc.strokeRect as any).mock.calls.length).toBe(2);
  });

  it('range whose rows are entirely outside the visible window contributes zero paint', () => {
    const gc = fakeGc();
    // Visible data rows = local 0..4. A range that starts at local 100 is off-screen.
    paintRangeOverlay(gc, pctx(makeVs(), [{ rowStart: 100, rowEnd: 110, colIds: ['a', 'b'] }]));
    expect((gc.fillRect as any)).not.toHaveBeenCalled();
    expect((gc.strokeRect as any)).not.toHaveBeenCalled();
  });

  it('range whose colIds are entirely outside the visible columns contributes zero paint', () => {
    const gc = fakeGc();
    paintRangeOverlay(gc, pctx(makeVs(), [{ rowStart: 0, rowEnd: 2, colIds: ['notVisible'] }]));
    expect((gc.fillRect as any)).not.toHaveBeenCalled();
    expect((gc.strokeRect as any)).not.toHaveBeenCalled();
  });

  it('paints fill with theme.rangeFillColor and stroke with theme.rangeBorderColor', () => {
    // Capture the fillStyle/strokeStyle in effect at the moment of the
    // fillRect/strokeRect calls — the painter is allocation-free so it
    // sets them once before the loop. We snapshot via the proxy.
    const fillStyleAtCall: string[] = [];
    const strokeStyleAtCall: string[] = [];
    const ctx: any = {
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
      lineWidth: 1, globalAlpha: 1,
      save: vi.fn(), restore: vi.fn(),
      fillRect: vi.fn(function () { fillStyleAtCall.push(ctx.fillStyle); }),
      strokeRect: vi.fn(function () { strokeStyleAtCall.push(ctx.strokeStyle); }),
    };
    ctx.cache = new Proxy(ctx, {
      get(target, key) { return target[key]; },
      set(target, key, value) { target[key] = value; return true; },
    });
    paintRangeOverlay(ctx as CachedContext2D, pctx(makeVs(), [{ rowStart: 0, rowEnd: 0, colIds: ['a'] }]));
    expect(fillStyleAtCall[0]).toBe(theme.rangeFillColor);
    expect(strokeStyleAtCall[0]).toBe(theme.rangeBorderColor);
  });
});
