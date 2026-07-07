// Cycle 28 / Task 3 — byRows headerIcon (leaf-header prefix/suffix icon).
//
// Verifies that a leaf column's resolved `headerIcon` fn draws an icon in
// the header row's leading or trailing slot and shifts the caption via
// `config.padding`; data rows never draw headerIcon and header rows never
// draw cellIcon.

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { paintCellsByRows } from '../src/renderer/painters/byRows';
import { CellRendererRegistry, textCell, headerCell } from '../src/renderer/cellRenderers/registry';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';
import { registerIconSet, _resetIconRegistry_forTests } from '../src/icons/registry';

beforeAll(() => {
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class {
      constructor(_d?: string) {}
    };
  }
});

const headerSubgrid: Subgrid = {
  type: 'header', isHeader: true, isData: false, isTotals: false, isFooter: false,
  getRowCount: () => 1, getRowHeight: () => 32, getCell: () => null,
};

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

function makeVs(subgrid: Subgrid, top: number, bottom: number): ViewportState {
  return {
    visibleColumns: [
      { colId: 'a', index: 0, left: 0, right: 100, width: 100 },
    ],
    visibleRows: [
      { rowIndex: 0, subgrid, localRowIndex: 0, top, bottom, height: bottom - top },
    ],
    firstRow: 0, lastRow: 0,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: 100, bodyTop: 0, bodyBottom: bottom, bodyWidth: 100, bodyHeight: bottom,
    contentWidth: 100, contentHeight: 300, maxScrollLeft: 0, maxScrollTop: 270,
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
    colId: 'a', headerName: 'Price', minWidth: 30, maxWidth: Infinity,
    cellDataType: 'text', cellRenderer: 'text', sortable: true, resizable: true,
    editable: false, suppressFloatingFilterButton: false,
    ...over,
  } as ResolvedColDef;
}

function paintHeader(gc: CachedContext2D, def: ResolvedColDef): void {
  paintCellsByRows(gc, {
    viewport: makeVs(headerSubgrid, 0, 32), theme, columnDefs: new Map([['a', def]]),
    cellRenderers: makeReg(),
    cellData: () => ({ value: 'Price', valueFormatted: 'Price' }),
    selection: { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() },
    sortModel: [], rowDataSnapshotAt: () => ({}), quickFilterLowerTerms: [],
  } as never);
}

function paintData(gc: CachedContext2D, def: ResolvedColDef): void {
  paintCellsByRows(gc, {
    viewport: makeVs(dataSubgrid, 0, 30), theme, columnDefs: new Map([['a', def]]),
    cellRenderers: makeReg(),
    cellData: () => ({ value: 42, valueFormatted: '42' }),
    selection: { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() },
    sortModel: [], rowDataSnapshotAt: () => ({}), quickFilterLowerTerms: [],
  } as never);
}

describe('byRows — headerIcon inline rendering', () => {
  beforeEach(() => _resetIconRegistry_forTests());

  it('headerIcon (static IconRef) draws a Path2D icon in the leading slot and shifts the caption right', () => {
    registerIconSet('lucide', { star: 'M1 1' });
    const gc = fakeGc();
    paintHeader(gc, baseDef({
      headerIcon: () => ({ name: 'star' }),
    } as Partial<ResolvedColDef>));
    expect(gc.stroke as any).toHaveBeenCalled();
    // Leading pad = 6 + floor(min(32,32)*0.55)=17 + 4 = 27.
    const [caption, textX] = (gc.fillText as any).mock.calls[0]!;
    expect(caption).toBe('Price');
    expect(textX).toBeGreaterThanOrEqual(6 + 17 + 4);
  });

  it('headerIcon trailing: icon draws at the right edge, caption x unchanged', () => {
    registerIconSet('lucide', { star: 'M1 1' });
    const gc = fakeGc();
    paintHeader(gc, baseDef({
      headerIcon: () => ({ name: 'star', position: 'trailing' }),
    } as Partial<ResolvedColDef>));
    expect(gc.stroke as any).toHaveBeenCalled();
    const [, textX] = (gc.fillText as any).mock.calls[0]!;
    // No-icon baseline is HEADER_PADDING (8).
    expect(textX).toBe(8);
  });

  it('headerIcon emoji draws via fillText', () => {
    const gc = fakeGc();
    paintHeader(gc, baseDef({
      headerIcon: () => ({ emoji: '🚀' }),
    } as Partial<ResolvedColDef>));
    const emojiCall = (gc.fillText as any).mock.calls.find((c: unknown[]) => c[0] === '🚀');
    expect(emojiCall).toBeTruthy();
    expect(gc.stroke as any).not.toHaveBeenCalled();
  });

  it('headerIcon function form receives { colId } and its result is honored', () => {
    registerIconSet('lucide', { star: 'M1 1' });
    const gc = fakeGc();
    const spy = vi.fn((p: { colId: string }) => (p.colId === 'a' ? { name: 'star' } : null));
    paintHeader(gc, baseDef({ headerIcon: spy } as Partial<ResolvedColDef>));
    expect(spy).toHaveBeenCalledWith({ colId: 'a' });
    expect(gc.stroke as any).toHaveBeenCalled();
  });

  it('data rows never draw headerIcon; header rows never draw cellIcon', () => {
    registerIconSet('lucide', { star: 'M1 1', 'trending-up': 'M0 0' });
    const def = baseDef({
      cellIcon: () => ({ name: 'trending-up' }),
      headerIcon: () => ({ name: 'star' }),
    } as Partial<ResolvedColDef>);

    const gcHeader = fakeGc();
    paintHeader(gcHeader, def);
    expect((gcHeader.stroke as any).mock.calls.length).toBe(1);

    const gcData = fakeGc();
    paintData(gcData, def);
    expect((gcData.stroke as any).mock.calls.length).toBe(1);
  });
});
