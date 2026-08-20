// @wellsfargo-starui/velocity-grid-ext/renderers — wireRenderersIntoKernel bridge tests (Cycle 21f / Task 13).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { compileCompositeColDef } from '@wellsfargo-starui/velocity-grid/format';
import { RENDERER_NAMES } from '../../../src/renderers/types';
import {
  wireRenderersIntoKernel,
  rendererPainterTableForTests,
} from '../../../src/renderers/bridge';
import { THREADING_PROGRAM } from '../../../src/renderers/colDefBuilders';
import { iconActionCluster, rowMenuCell, resolveHitRegion, setActionIconResolver } from '../../../src/renderers/actions';
import { makeFakeGc } from '../helpers/fakeGc';

function makeFakeGrid(
  columnDefs: Record<string, unknown>[] = [],
  rows: Array<{ rowId: string; row: Record<string, unknown> }> = [],
) {
  const registrations = new Map<string, unknown>();
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  let canvasPoint = { x: 0, y: 0 };

  const grid = {
    registerCellRenderer(name: string, painter: unknown) {
      registrations.set(name, painter);
    },
    on(type: string, fn: (e: unknown) => void) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
      return () => {
        const list = handlers.get(type) ?? [];
        handlers.set(type, list.filter((h) => h !== fn));
      };
    },
    addEventListener(type: string, fn: (e: unknown) => void) {
      return grid.on(type, fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      const list = handlers.get(type) ?? [];
      handlers.set(type, list.filter((h) => h !== fn));
    },
    forEachRow(fn: (rowId: string, row: Record<string, unknown>) => void) {
      for (const r of rows) fn(r.rowId, r.row);
    },
    refresh: vi.fn(),
    getGridOption(key: string) {
      if (key === 'columnDefs') return columnDefs;
      return undefined;
    },
    canvasCoordsFromEvent: () => canvasPoint,
    __renderersBridgeWired: undefined as unknown,
    setCanvasPoint(x: number, y: number) {
      canvasPoint = { x, y };
    },
    emit(type: string, e: unknown) {
      for (const fn of handlers.get(type) ?? []) fn(e);
    },
    _registrations: registrations,
    // Test-only escape hatch (F2) — the SAME array `forEachRow` iterates,
    // so mutating it in place simulates a real `setRowData` full-replace:
    // rowIds stay the same, but the row OBJECT REFERENCES change, which is
    // exactly what the kernel's real setRowData does and what the bridge's
    // rowId-keyed mirror can't detect without a modelUpdated subscription.
    _rows: rows,
  };

  return grid;
}

describe('wireRenderersIntoKernel — registration', () => {
  it('registers all 51 canonical painters', () => {
    const grid = makeFakeGrid();
    wireRenderersIntoKernel(grid);
    expect(grid._registrations.size).toBe(51);
    for (const name of RENDERER_NAMES) {
      expect(grid._registrations.has(name)).toBe(true);
    }
  });

  it('painter table aligns with RENDERER_NAMES', () => {
    const table = rendererPainterTableForTests();
    expect(Object.keys(table).sort()).toEqual([...RENDERER_NAMES].sort());
  });

  it('is idempotent — re-call returns the same handle', () => {
    const grid = makeFakeGrid();
    const first = wireRenderersIntoKernel(grid);
    const second = wireRenderersIntoKernel(grid);
    expect(second).toBe(first);
    expect(grid._registrations.size).toBe(51);
  });
});

describe('wireRenderersIntoKernel — colDef builders', () => {
  it('priceQuote emits composite threading stub', () => {
    const grid = makeFakeGrid();
    const { colDef } = wireRenderersIntoKernel(grid);
    const def = colDef.priceQuote('quote', { bidField: 'bid', askField: 'ask' });
    expect(def.cellRenderer).toBe('price-quote');
    expect(def._compositeProgram).toBe(THREADING_PROGRAM);
  });

  it('number omits composite threading', () => {
    const grid = makeFakeGrid();
    const { colDef } = wireRenderersIntoKernel(grid);
    const def = colDef.renderer('number', 'qty');
    expect(def._compositeProgram).toBeUndefined();
  });

  it('heat builder injects stats via selector', () => {
    const grid = makeFakeGrid([], [
      { rowId: 'r1', row: { pnl: 10 } },
      { rowId: 'r2', row: { pnl: 30 } },
    ]);
    const { colDef } = wireRenderersIntoKernel(grid, { statsColumns: ['pnl'] });
    const def = colDef.heat('pnl');
    const selected = (def.cellRendererSelector as ((p: {
      value: unknown; colId: string; data?: Record<string, unknown>;
    }) => { component?: string; params?: { stats?: { max?: number | null } } } | undefined))?.({
      value: 20, colId: 'pnl', data: { pnl: 20 },
    });
    expect(selected?.component).toBe('heat');
    expect((selected?.params as { stats?: { max?: number | null } }).stats?.max).toBe(30);
  });

  it('age builder starts gated refresh timer', () => {
    vi.useFakeTimers();
    const grid = makeFakeGrid();
    const { colDef } = wireRenderersIntoKernel(grid);
    colDef.age('createdAt');
    vi.advanceTimersByTime(1000);
    expect(grid.refresh).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('registered painters see the full mirrored row as p.rowData', () => {
    const grid = makeFakeGrid([], [
      { rowId: 'r1', row: { id: 'r1', bid: 98.1, ask: 98.14, mid: 98.12 } },
    ]);
    wireRenderersIntoKernel(grid);
    const wrapped = grid._registrations.get('price-quote') as {
      paint(gc: unknown, p: Record<string, unknown>): void;
    };
    let seenRow: unknown;
    const probe = {
      value: 98.12,
      valueFormatted: '98.12',
      bounds: { x: 0, y: 0, w: 150, h: 28 },
      font: '12px sans-serif', fg: '#fff', bg: '#000', borderColor: '#000',
      halign: 'left', prefillColor: '#000',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowId: 'r1',
      colId: 'quote',
      // Kernel threads the visible-column snapshot here — the bridge must
      // swap in the raw row so field lookups (bid/ask) resolve.
      rowData: { quote: 98.12 },
      params: { bidField: 'bid', askField: 'ask', midField: 'mid' },
    };
    const gcProbe = makeFakeGc();
    const origPaint = wrapped.paint.bind(wrapped);
    origPaint(gcProbe, new Proxy(probe, {
      get(t, k) {
        if (k === 'rowData') seenRow = Reflect.get(t, k);
        return Reflect.get(t, k);
      },
      set(t, k, v) { return Reflect.set(t, k, v); },
    }) as never);
    expect((seenRow as Record<string, unknown>).bid).toBe(98.1);
    // Restored after paint (kernel reuses the config object across cells).
    expect(probe.rowData).toEqual({ quote: 98.12 });
  });

  it('multi-field colDef compiles through @wellsfargo-starui/velocity-grid/format when typed composite', () => {
    const compiled = compileCompositeColDef({
      colId: 'summary',
      type: 'composite',
      fragments: [{ expr: '[symbol]' }],
      _compositeProgram: THREADING_PROGRAM,
      cellRenderer: 'stacked-value',
    } as never);
    expect(compiled.ok).toBe(true);
  });
});

describe('wireRenderersIntoKernel — F2 modelUpdated reseeds the row mirror', () => {
  function probeFor(rowId: string, colId: string) {
    return {
      value: 98.12,
      valueFormatted: '98.12',
      bounds: { x: 0, y: 0, w: 150, h: 28 },
      font: '12px sans-serif', fg: '#fff', bg: '#000', borderColor: '#000',
      halign: 'left', prefillColor: '#000',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowId,
      colId,
      rowData: { quote: 98.12 },
      params: { bidField: 'bid', askField: 'ask', midField: 'mid' },
    };
  }

  it('sees fresh values after setRowData replaces the SAME rowId (modelUpdated, no rowsChanged)', () => {
    const grid = makeFakeGrid([], [
      { rowId: 'r1', row: { id: 'r1', bid: 98.10, ask: 98.14, mid: 98.12 } },
    ]);
    wireRenderersIntoKernel(grid);
    const wrapped = grid._registrations.get('price-quote') as {
      paint(gc: unknown, p: Record<string, unknown>): void;
    };
    const gcProbe = makeFakeGc();

    // Real VelocityGrid.setRowData clears + repopulates its internal row store and
    // emits `modelUpdated` (never `rowsChanged`) — simulate exactly that:
    // same rowId, NEW row object with new values, no rowsChanged event.
    grid._rows.length = 0;
    grid._rows.push({ rowId: 'r1', row: { id: 'r1', bid: 99.50, ask: 99.54, mid: 99.52 } });
    grid.emit('modelUpdated', { type: 'modelUpdated', visibleRowCount: 1 });

    let seenRow: Record<string, unknown> | undefined;
    const probe = new Proxy(probeFor('r1', 'quote'), {
      get(t, k) {
        if (k === 'rowData') seenRow = Reflect.get(t, k) as Record<string, unknown>;
        return Reflect.get(t, k);
      },
      set(t, k, v) { return Reflect.set(t, k, v); },
    });
    wrapped.paint(gcProbe, probe as never);

    expect(seenRow?.bid).toBe(99.50);
  });

  it('WITHOUT a modelUpdated subscription the mirror would stay stale — this is the regression guard', () => {
    // Same scenario as above but never emits modelUpdated — proves the
    // fixture setup alone (row-object replacement) doesn't already produce
    // fresh values; only the modelUpdated handler does.
    const grid = makeFakeGrid([], [
      { rowId: 'r1', row: { id: 'r1', bid: 1, ask: 2, mid: 1.5 } },
    ]);
    wireRenderersIntoKernel(grid);
    const wrapped = grid._registrations.get('price-quote') as {
      paint(gc: unknown, p: Record<string, unknown>): void;
    };
    const gcProbe = makeFakeGc();

    grid._rows.length = 0;
    grid._rows.push({ rowId: 'r1', row: { id: 'r1', bid: 999, ask: 998, mid: 998.5 } });
    // No modelUpdated emitted.

    let seenRow: Record<string, unknown> | undefined;
    const probe = new Proxy(probeFor('r1', 'quote'), {
      get(t, k) {
        if (k === 'rowData') seenRow = Reflect.get(t, k) as Record<string, unknown>;
        return Reflect.get(t, k);
      },
      set(t, k, v) { return Reflect.set(t, k, v); },
    });
    wrapped.paint(gcProbe, probe as never);

    expect(seenRow?.bid).toBe(1); // stale — the old mirrored reference
  });
});

describe('wireRenderersIntoKernel — F3 hit-region eviction', () => {
  it('rowsChanged removed evicts that row\'s action hit regions', () => {
    const onAction = vi.fn();
    const columnDefs = [{
      colId: 'act',
      field: 'act',
      cellRenderer: 'icon-action-cluster',
      cellRendererParams: { actions: [{ icon: 'x', label: 'Cancel', onAction }] },
    }];
    const grid = makeFakeGrid(columnDefs);
    wireRenderersIntoKernel(grid);
    const gc = makeFakeGc();

    iconActionCluster.paint(gc, {
      value: null, valueFormatted: '',
      bounds: { x: 100, y: 10, w: 80, h: 28 },
      font: '13px sans-serif', fg: '#111', bg: '#fff', borderColor: '#ccc',
      halign: 'right', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowId: 'r1', colId: 'act',
      params: columnDefs[0]!.cellRendererParams,
    });

    grid.setCanvasPoint(154, 24);
    grid.emit('rowsChanged', {
      type: 'rowsChanged', added: [], updated: [], removed: [{ rowId: 'r1', row: {} }],
    });
    grid.emit('cellClicked', {
      type: 'cellClicked', rowId: 'r1', colId: 'act', value: null, mouse: {} as MouseEvent,
    });

    expect(onAction).not.toHaveBeenCalled();
  });

  it('destroy() clears all hit regions, even for rows the bridge never saw removed', () => {
    const onAction = vi.fn();
    const columnDefs = [{
      colId: 'act',
      field: 'act',
      cellRenderer: 'icon-action-cluster',
      cellRendererParams: { actions: [{ icon: 'x', label: 'Cancel', onAction }] },
    }];
    const grid = makeFakeGrid(columnDefs);
    const handle = wireRenderersIntoKernel(grid);
    const gc = makeFakeGc();

    iconActionCluster.paint(gc, {
      value: null, valueFormatted: '',
      bounds: { x: 100, y: 10, w: 80, h: 28 },
      font: '13px sans-serif', fg: '#111', bg: '#fff', borderColor: '#ccc',
      halign: 'right', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowId: 'r1', colId: 'act',
      params: columnDefs[0]!.cellRendererParams,
    });

    // The region resolves before destroy (sanity — proves the paint above
    // actually registered it on the shared default registry).
    expect(resolveHitRegion('r1', 'act', 154, 24)).toBeDefined();

    handle.destroy();

    // destroy() must sweep the whole shared registry, not just rows this
    // bridge instance happened to see a rowsChanged `removed` for.
    expect(resolveHitRegion('r1', 'act', 154, 24)).toBeUndefined();
  });
});

describe('wireRenderersIntoKernel — action click router', () => {
  let gc: ReturnType<typeof makeFakeGc>;

  beforeEach(() => {
    gc = makeFakeGc();
  });

  it('routes icon-action-cluster clicks to onAction', () => {
    const onAction = vi.fn();
    const columnDefs = [{
      colId: 'act',
      field: 'act',
      cellRenderer: 'icon-action-cluster',
      cellRendererParams: {
        actions: [{ icon: 'x', label: 'Cancel', onAction }],
      },
    }];
    const grid = makeFakeGrid(columnDefs);
    wireRenderersIntoKernel(grid);

    iconActionCluster.paint(gc, {
      value: null,
      valueFormatted: '',
      bounds: { x: 100, y: 10, w: 80, h: 28 },
      font: '13px sans-serif',
      fg: '#111',
      bg: '#fff',
      borderColor: '#ccc',
      halign: 'right',
      prefillColor: '#fff',
      isFocused: false,
      isSelected: false,
      isHovered: true,
      isHeader: false,
      rowId: 'r1',
      colId: 'act',
      params: columnDefs[0]!.cellRendererParams,
    });

    grid.setCanvasPoint(154, 24);
    grid.emit('cellClicked', {
      type: 'cellClicked',
      rowId: 'r1',
      colId: 'act',
      value: null,
      mouse: {} as MouseEvent,
    });

    expect(onAction).toHaveBeenCalledWith('r1', 'act');
  });

  it('routes row-menu clicks to onOpen with anchor bounds', () => {
    const onOpen = vi.fn();
    const columnDefs = [{
      colId: 'menu',
      field: 'menu',
      cellRenderer: 'row-menu',
      cellRendererParams: { onOpen },
    }];
    const grid = makeFakeGrid(columnDefs);
    wireRenderersIntoKernel(grid);

    rowMenuCell.paint(gc, {
      value: null,
      valueFormatted: '',
      bounds: { x: 100, y: 10, w: 80, h: 28 },
      font: '13px sans-serif',
      fg: '#111',
      bg: '#fff',
      borderColor: '#ccc',
      halign: 'right',
      prefillColor: '#fff',
      isFocused: false,
      isSelected: false,
      isHovered: false,
      isHeader: false,
      rowId: 'r2',
      colId: 'menu',
      params: { onOpen },
    });

    grid.setCanvasPoint(154, 24);
    grid.emit('cellClicked', {
      type: 'cellClicked',
      rowId: 'r2',
      colId: 'menu',
      value: null,
      mouse: {} as MouseEvent,
    });

    expect(onOpen).toHaveBeenCalledWith('r2', 'menu', expect.objectContaining({ w: 20, h: 20 }));
  });
});

describe('wireRenderersIntoKernel — destroy cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears age timer and handle on gridPreDestroyed', () => {
    vi.useFakeTimers();
    const grid = makeFakeGrid();
    const handle = wireRenderersIntoKernel(grid);
    handle.colDef.relativeTime('ts');
    grid.emit('gridPreDestroyed', { type: 'gridPreDestroyed', state: {} });
    vi.advanceTimersByTime(2000);
    expect(grid.refresh).not.toHaveBeenCalled();
    expect(grid.__renderersBridgeWired).toBeUndefined();
  });

  it('handle.destroy() is safe to call directly', () => {
    const grid = makeFakeGrid();
    const handle = wireRenderersIntoKernel(grid, { statsColumns: ['pnl'] });
    expect(() => handle.destroy()).not.toThrow();
    expect(grid.__renderersBridgeWired).toBeUndefined();
  });
});

describe('wireRenderersIntoKernel — B2 icon resolver threading', () => {
  afterEach(() => { setActionIconResolver(null); });

  it('threads the grid\'s public resolveIcon through to IconActionCluster (zero kernel diff)', () => {
    const fakePath = {} as Path2D;
    const grid = makeFakeGrid() as ReturnType<typeof makeFakeGrid> & {
      resolveIcon(name: string, setHint?: string): Path2D | null;
    };
    grid.resolveIcon = (name: string) => (name === 'route' ? fakePath : null);
    wireRenderersIntoKernel(grid);

    const gc = makeFakeGc();
    iconActionCluster.paint(gc, {
      value: null, valueFormatted: '',
      bounds: { x: 0, y: 0, w: 40, h: 28 },
      font: '13px sans-serif', fg: '#111', bg: '#fff', borderColor: '#ccc',
      halign: 'right', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowId: 'r1', colId: 'act',
      params: { actions: [{ icon: 'route', label: 'Route', onAction: () => {} }] },
    });

    expect(gc.calls.some((c) => c.op === 'stroke' && c.args[0] === fakePath)).toBe(true);
  });

  it('destroy() unwires the resolver — subsequent paints fall back to the letter badge', () => {
    const fakePath = {} as Path2D;
    const grid = makeFakeGrid() as ReturnType<typeof makeFakeGrid> & {
      resolveIcon(name: string, setHint?: string): Path2D | null;
    };
    grid.resolveIcon = () => fakePath;
    const handle = wireRenderersIntoKernel(grid);
    handle.destroy();

    const gc = makeFakeGc();
    iconActionCluster.paint(gc, {
      value: null, valueFormatted: '',
      bounds: { x: 0, y: 0, w: 40, h: 28 },
      font: '13px sans-serif', fg: '#111', bg: '#fff', borderColor: '#ccc',
      halign: 'right', prefillColor: '#fff',
      isFocused: false, isSelected: false, isHovered: false, isHeader: false,
      rowId: 'r1', colId: 'act',
      params: { actions: [{ icon: 'route', label: 'Route', onAction: () => {} }] },
    });

    expect(gc.calls.some((c) => c.op === 'fillText' && c.args[0] === 'R')).toBe(true);
  });
});
