/**
 * 2026-08 look-and-feel — the selection edge.
 *
 * A selected row inside the canvas used to be a flat grey
 * (`--vg-row-selected-bg: #363A43`). A selected anything ELSE in the
 * product — drawer row, rail item, segmented control, menu entry — is an
 * accent wash plus a 2px accent edge, so the most common state in the
 * product had two unrelated appearances either side of the canvas
 * boundary. The wash now comes from the token; this locks the edge.
 *
 * The edge is painted per BUNDLE (the row-background pass already merges
 * adjacent rows sharing a background), so a block selection costs one
 * extra fillRect rather than one per row.
 */
import { describe, it, expect, vi } from 'vitest';
import { paintCellsByRows } from '../src/renderer/painters/byRows';
import { CellRendererRegistry, textCell, numberCell, headerCell } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';

const SELECTED_BG = 'rgba(129,161,193,0.14)';
const SELECTED_EDGE = '#81A1C1';

const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 4, getRowHeight: () => 30, getCell: () => null,
};

const theme: ResolvedTheme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fff', rowHoverBg: '#f5f5f5',
  rowSelectedBg: SELECTED_BG, rowSelectedEdge: SELECTED_EDGE,
  focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
  cellClassVariants: new Map(), headerClassVariants: new Map(),
} as unknown as ResolvedTheme;

const cols = new Map<string, ResolvedColDef>([
  ['a', { colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text', cellRenderer: 'text', sortable: true, resizable: true, editable: false }],
]) as unknown as Map<string, ResolvedColDef>;

function makeReg(): CellRendererRegistry {
  const r = new CellRendererRegistry();
  r.register('text', textCell);
  r.register('number', numberCell);
  r.register('header', headerCell);
  return r;
}

function fakeGc(): CachedContext2D {
  const ctx: Record<string, unknown> = {
    fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), closePath: vi.fn(),
    translate: vi.fn(), scale: vi.fn(),
    measureText: () => ({ width: 50 }),
    fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
    lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  ctx.cache = new Proxy(ctx, {
    get(t, k) { return (t as Record<string | symbol, unknown>)[k]; },
    set(t, k, v) { (t as Record<string | symbol, unknown>)[k] = v; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as unknown as CachedContext2D;
}

const vs = (): ViewportState => ({
  visibleColumns: [{ colId: 'a', index: 0, left: 0, right: 200, width: 200 }],
  visibleRows: [
    { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 0, bottom: 30, height: 30 },
    { rowIndex: 1, subgrid: dataSubgrid, localRowIndex: 1, top: 30, bottom: 60, height: 30 },
    { rowIndex: 2, subgrid: dataSubgrid, localRowIndex: 2, top: 60, bottom: 90, height: 30 },
    { rowIndex: 3, subgrid: dataSubgrid, localRowIndex: 3, top: 90, bottom: 120, height: 30 },
  ],
  firstRow: 0, lastRow: 3,
  scrollLeft: 0, scrollTop: 0,
  bodyLeft: 0, bodyRight: 200, bodyTop: 0, bodyBottom: 120,
  bodyWidth: 200, bodyHeight: 120,
  contentWidth: 200, contentHeight: 120, maxScrollLeft: 0, maxScrollTop: 0,
} as unknown as ViewportState);

function paint(selected: number[], t: ResolvedTheme = theme): number[][] {
  const c = fakeGc();
  paintCellsByRows(c, {
    viewport: vs(), theme: t, columnDefs: cols, cellRenderers: makeReg(),
    cellData: () => ({ value: 'x', valueFormatted: 'x' }),
    rowDataSnapshotAt: () => ({}), quickFilterLowerTerms: [],
    selection: {
      focusedRowIndex: null, focusedColId: null,
      selectedRowIndices: new Set(selected),
    },
    sortModel: [],
  } as never);
  return (c.fillRect as unknown as { mock: { calls: number[][] } }).mock.calls;
}

/** fillRects that are the 2px accent bar at x=0. */
const edges = (calls: number[][]): number[][] =>
  calls.filter((c) => c[0] === 0 && c[2] === 2);

describe('selection edge', () => {
  it('paints a 2px edge down the left of a selected row', () => {
    const calls = paint([1]);
    const e = edges(calls);
    expect(e.length).toBe(1);
    // row 1 spans 30..60
    expect(e[0]![1]).toBe(30);
    expect(e[0]![3]).toBe(30);
  });

  it('paints nothing when no row is selected', () => {
    expect(edges(paint([])).length).toBe(0);
  });

  it('merges a run of adjacent selected rows into ONE edge rect', () => {
    // Rows 1+2 are contiguous, so the background pass bundles them and the
    // edge follows: one rect spanning 30..90, not two of 30 each.
    const e = edges(paint([1, 2]));
    expect(e.length).toBe(1);
    expect(e[0]![1]).toBe(30);
    expect(e[0]![3]).toBe(60);
  });

  it('paints one edge per discontiguous run', () => {
    const e = edges(paint([0, 2]));
    expect(e.length).toBe(2);
    expect(e.map((r) => r[1]).sort((a, b) => a - b)).toEqual([0, 60]);
  });

  it('is skipped entirely when the theme declares no edge colour', () => {
    // Legacy themes and hand-built fixtures predate --vg-row-selected-edge;
    // they keep exactly the wash-only paint they always had.
    const legacy = { ...theme, rowSelectedEdge: undefined } as unknown as ResolvedTheme;
    expect(edges(paint([1], legacy)).length).toBe(0);
  });

  it('uses the theme edge colour, not the focus ring', () => {
    const styles: string[] = [];
    const base = fakeGc() as unknown as Record<string, unknown>;
    // Record every fillStyle the paint pass assigns, in order.
    const c = new Proxy(base, {
      get(t, k) { return k === 'cache' ? c : t[k as string]; },
      set(t, k, v) {
        if (k === 'fillStyle') styles.push(String(v));
        t[k as string] = v;
        return true;
      },
    }) as unknown as CachedContext2D;
    paintCellsByRows(c, {
      viewport: vs(), theme, columnDefs: cols, cellRenderers: makeReg(),
      cellData: () => ({ value: 'x', valueFormatted: 'x' }),
    rowDataSnapshotAt: () => ({}), quickFilterLowerTerms: [],
      selection: { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set([1]) },
      sortModel: [],
    } as never);
    expect(styles).toContain(SELECTED_EDGE);
    expect(styles).toContain(SELECTED_BG);
  });
});
