import { describe, it, expect, vi } from 'vitest';
import { paintCellsByRows } from '../src/renderer/painters/byRows';
import { CellRendererRegistry, textCell, numberCell, headerCell } from '../src/renderer/cellRenderers/registry';
import type { CellPaintConfig } from '../src/renderer/cellRenderers/registry';
import { resolveColDef } from '../src/core/propertyChain';
import type { ResolvedColDef } from '../src/core/propertyChain';
import type { ViewportState } from '../src/core/viewport';
import type { Subgrid } from '../src/core/subgrid';
import type { ResolvedTheme } from '../src/theming/cssReader';
import type { CachedContext2D } from '../src/renderer/gc';

const dataSubgrid: Subgrid = {
  type: 'data', isHeader: false, isData: true, isTotals: false, isFooter: false,
  getRowCount: () => 1000, getRowHeight: () => 30, getCell: () => null,
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
    get(t, k) { return t[k]; },
    set(t, k, v) { t[k] = v; return true; },
  });
  ctx.clearFill = vi.fn();
  return ctx as CachedContext2D;
}

const theme: ResolvedTheme = {
  font: '13px Inter', fg: '#000', bg: '#fff', headerBg: '#eee', headerFg: '#000',
  borderColor: '#ccc', gridLineColor: '#eee', rowAltBg: '#fafafa', rowHoverBg: '#f5f5f5',
  rowSelectedBg: 'rgba(0,0,0,0.1)', focusRingColor: '#08f', focusRingWidth: 2,
  flashFromColor: '#ffeb3b', flashToColor: 'transparent',
  rowHeight: 30, headerHeight: 32, resizerHotZone: 4, scrollbarThickness: 10,
};

const selectionEmpty = { focusedRowIndex: null, focusedColId: null, selectedRowIndices: new Set<number>() };

function singleCellViewport(colId: string, value: unknown, valueFormatted: string): {
  vs: ViewportState;
  cellData: () => { value: unknown; valueFormatted: string };
} {
  const vs: ViewportState = {
    visibleColumns: [{ colId, index: 0, left: 0, right: 100, width: 100 }],
    visibleRows: [
      { rowIndex: 0, subgrid: dataSubgrid, localRowIndex: 0, top: 32, bottom: 62, height: 30 },
    ],
    firstRow: 0, lastRow: 0,
    scrollLeft: 0, scrollTop: 0,
    bodyLeft: 0, bodyRight: 100, bodyTop: 32, bodyBottom: 62, bodyWidth: 100, bodyHeight: 30,
    contentWidth: 100, contentHeight: 1000, maxScrollLeft: 0, maxScrollTop: 970,
  };
  return { vs, cellData: () => ({ value, valueFormatted }) };
}

describe('resolveColDef — cellRendererParams + cellRendererSelector', () => {
  it('carries cellRendererParams through as the literal value (default undefined)', () => {
    const r = resolveColDef({ field: 'a' });
    expect(r.cellRendererParams).toBeUndefined();
  });

  it('carries cellRendererParams through unchanged', () => {
    const params = { fmt: '0.00', icon: 'arrow' };
    const r = resolveColDef({ field: 'a', cellRendererParams: params });
    expect(r.cellRendererParams).toBe(params);
  });

  it('carries cellRendererSelector through unchanged', () => {
    const selector = () => ({ component: 'badge' });
    const r = resolveColDef({ field: 'a', cellRendererSelector: selector });
    expect(r.cellRendererSelector).toBe(selector);
  });

  it('inherits cellRendererParams from defaultColDef', () => {
    const params = { fmt: '0.00' };
    const r = resolveColDef({ field: 'a' }, { cellRendererParams: params });
    expect(r.cellRendererParams).toBe(params);
  });

  it('column-level cellRendererParams overrides defaultColDef', () => {
    const r = resolveColDef(
      { field: 'a', cellRendererParams: { fmt: 'col' } },
      { cellRendererParams: { fmt: 'default' } },
    );
    expect(r.cellRendererParams).toEqual({ fmt: 'col' });
  });
});

describe('CellRendererRegistry — custom registration', () => {
  it('register("badge", painter) + get("badge") returns the painter', () => {
    const reg = new CellRendererRegistry();
    const badge = { paint: vi.fn() };
    reg.register('badge', badge);
    expect(reg.get('badge')).toBe(badge);
  });
});

describe('paintCellsByRows — custom cellRenderer dispatch', () => {
  it('dispatches to a custom renderer when colDef.cellRenderer is a registered name', () => {
    const badgePaint = vi.fn();
    const textPaint = vi.fn();
    const reg = new CellRendererRegistry();
    reg.register('text', { paint: textPaint });
    reg.register('badge', { paint: badgePaint });
    reg.register('header', headerCell);

    const cols = new Map<string, ResolvedColDef>([
      ['status', {
        colId: 'status', headerName: 'Status', minWidth: 30, maxWidth: Infinity, type: 'text',
        cellRenderer: 'badge', sortable: true, resizable: true, editable: false,
      } as ResolvedColDef],
    ]);
    const { vs, cellData } = singleCellViewport('status', 'OK', 'OK');

    paintCellsByRows(fakeGc(), {
      viewport: vs, theme, columnDefs: cols, cellRenderers: reg,
      cellData, selection: selectionEmpty, sortModel: [],
    });

    expect(badgePaint).toHaveBeenCalledTimes(1);
    expect(textPaint).not.toHaveBeenCalled();
  });

  it('passes resolved cellRendererParams to the painter as config.params', () => {
    const captured: CellPaintConfig[] = [];
    const badge = {
      paint: (_gc: CachedContext2D, p: CellPaintConfig) => {
        captured.push({ ...p, bounds: { ...p.bounds } });
      },
    };
    const reg = new CellRendererRegistry();
    reg.register('badge', badge);
    reg.register('text', textCell);
    reg.register('number', numberCell);
    reg.register('header', headerCell);

    const params = { fmt: '0.00' };
    const cols = new Map<string, ResolvedColDef>([
      ['price', {
        colId: 'price', headerName: 'Price', minWidth: 30, maxWidth: Infinity, type: 'number',
        cellRenderer: 'badge', cellRendererParams: params,
        sortable: true, resizable: true, editable: false,
      } as ResolvedColDef],
    ]);
    const { vs, cellData } = singleCellViewport('price', 42, '42');

    paintCellsByRows(fakeGc(), {
      viewport: vs, theme, columnDefs: cols, cellRenderers: reg,
      cellData, selection: selectionEmpty, sortModel: [],
    });

    expect(captured.length).toBe(1);
    expect(captured[0]!.params).toBe(params);
  });

  it('cellRendererSelector overrides the static cellRenderer name per cell', () => {
    const greenBadge = { paint: vi.fn() };
    const redBadge = { paint: vi.fn() };
    const reg = new CellRendererRegistry();
    reg.register('text', textCell);
    reg.register('header', headerCell);
    reg.register('greenBadge', greenBadge);
    reg.register('redBadge', redBadge);

    const cols = new Map<string, ResolvedColDef>([
      ['change', {
        colId: 'change', headerName: 'Change', minWidth: 30, maxWidth: Infinity, type: 'number',
        cellRenderer: 'text',
        cellRendererSelector: (p: any) => ({
          component: (p.value as number) >= 0 ? 'greenBadge' : 'redBadge',
        }),
        sortable: true, resizable: true, editable: false,
      } as ResolvedColDef],
    ]);
    const { vs, cellData } = singleCellViewport('change', -3, '-3');

    paintCellsByRows(fakeGc(), {
      viewport: vs, theme, columnDefs: cols, cellRenderers: reg,
      cellData, selection: selectionEmpty, sortModel: [],
    });

    expect(redBadge.paint).toHaveBeenCalledTimes(1);
    expect(greenBadge.paint).not.toHaveBeenCalled();
  });

  it('cellRendererSelector returning undefined falls back to the static cellRenderer', () => {
    const textPaint = vi.fn();
    const badgePaint = vi.fn();
    const reg = new CellRendererRegistry();
    reg.register('text', { paint: textPaint });
    reg.register('badge', { paint: badgePaint });
    reg.register('header', headerCell);

    const cols = new Map<string, ResolvedColDef>([
      ['name', {
        colId: 'name', headerName: 'Name', minWidth: 30, maxWidth: Infinity, type: 'text',
        cellRenderer: 'text',
        cellRendererSelector: () => undefined,
        sortable: true, resizable: true, editable: false,
      } as ResolvedColDef],
    ]);
    const { vs, cellData } = singleCellViewport('name', 'Alice', 'Alice');

    paintCellsByRows(fakeGc(), {
      viewport: vs, theme, columnDefs: cols, cellRenderers: reg,
      cellData, selection: selectionEmpty, sortModel: [],
    });

    expect(textPaint).toHaveBeenCalledTimes(1);
    expect(badgePaint).not.toHaveBeenCalled();
  });

  it('cellRendererSelector-returned params override static cellRendererParams', () => {
    const captured: CellPaintConfig[] = [];
    const reg = new CellRendererRegistry();
    reg.register('badge', {
      paint: (_gc, p) => { captured.push({ ...p, bounds: { ...p.bounds } }); },
    });
    reg.register('text', textCell);
    reg.register('header', headerCell);

    const staticParams = { fmt: 'static' };
    const dynamicParams = { fmt: 'dynamic' };
    const cols = new Map<string, ResolvedColDef>([
      ['v', {
        colId: 'v', headerName: 'V', minWidth: 30, maxWidth: Infinity, type: 'text',
        cellRenderer: 'text', cellRendererParams: staticParams,
        cellRendererSelector: () => ({ component: 'badge', params: dynamicParams }),
        sortable: true, resizable: true, editable: false,
      } as ResolvedColDef],
    ]);
    const { vs, cellData } = singleCellViewport('v', 'x', 'x');

    paintCellsByRows(fakeGc(), {
      viewport: vs, theme, columnDefs: cols, cellRenderers: reg,
      cellData, selection: selectionEmpty, sortModel: [],
    });

    expect(captured.length).toBe(1);
    expect(captured[0]!.params).toBe(dynamicParams);
  });

  it('header rows still dispatch to the header renderer regardless of cellRendererSelector', () => {
    const headerPaint = vi.fn();
    const badgePaint = vi.fn();
    const reg = new CellRendererRegistry();
    reg.register('text', textCell);
    reg.register('header', { paint: headerPaint });
    reg.register('badge', { paint: badgePaint });

    const selector = vi.fn(() => ({ component: 'badge' }));
    const cols = new Map<string, ResolvedColDef>([
      ['a', {
        colId: 'a', headerName: 'A', minWidth: 30, maxWidth: Infinity, type: 'text',
        cellRenderer: 'text', cellRendererSelector: selector,
        sortable: true, resizable: true, editable: false,
      } as ResolvedColDef],
    ]);
    const headerSubgrid: Subgrid = {
      type: 'header', isHeader: true, isData: false, isTotals: false, isFooter: false,
      getRowCount: () => 1, getRowHeight: () => 32, getCell: () => null,
    };
    const vs: ViewportState = {
      visibleColumns: [{ colId: 'a', index: 0, left: 0, right: 100, width: 100 }],
      visibleRows: [
        { rowIndex: 0, subgrid: headerSubgrid, localRowIndex: 0, top: 0, bottom: 32, height: 32 },
      ],
      firstRow: 0, lastRow: -1,
      scrollLeft: 0, scrollTop: 0,
      bodyLeft: 0, bodyRight: 100, bodyTop: 32, bodyBottom: 32, bodyWidth: 100, bodyHeight: 0,
      contentWidth: 100, contentHeight: 0, maxScrollLeft: 0, maxScrollTop: 0,
    };

    paintCellsByRows(fakeGc(), {
      viewport: vs, theme, columnDefs: cols, cellRenderers: reg,
      cellData: () => ({ value: '', valueFormatted: '' }),
      selection: selectionEmpty, sortModel: [],
    });

    expect(headerPaint).toHaveBeenCalledTimes(1);
    expect(badgePaint).not.toHaveBeenCalled();
    expect(selector).not.toHaveBeenCalled();
  });
});

describe('CGrid public API — registerCellRenderer', () => {
  it('exposes registerCellRenderer on CGrid + CGridApi', async () => {
    const { CGrid } = await import('../src/cgrid');
    // We don't construct a grid here (would need full DOM + worker stub);
    // we only assert the method exists on the prototype and is callable
    // shape-wise. Full construction-path coverage lives in cgrid.integration.
    expect(typeof (CGrid.prototype as any).registerCellRenderer).toBe('function');
  });
});
