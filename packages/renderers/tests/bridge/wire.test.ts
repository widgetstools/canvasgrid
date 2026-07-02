// @cgrid/renderers — wireRenderersIntoKernel bridge tests (Cycle 21f / Task 13).

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { compileCompositeColDef } from '@cgrid/format';
import { RENDERER_NAMES } from '../../src/types';
import {
  wireRenderersIntoKernel,
  rendererPainterTableForTests,
} from '../../src/bridge';
import { THREADING_PROGRAM } from '../../src/colDefBuilders';
import { iconActionCluster, rowMenuCell } from '../../src/actions';
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

  it('multi-field colDef compiles through @cgrid/format when typed composite', () => {
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
