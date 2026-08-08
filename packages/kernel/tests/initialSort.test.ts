// Cycle 8 / Task 2 — initialSort + initialSortIndex + sortingOrder.
//
// `CColDef.initialSort` seeds the column's sort direction on first
// construction (consumed once; subsequent applyColumnState reads `sort`).
// `CColDef.initialSortIndex` orders multi-column initial sorts; columns
// with an initialSort but no index sort to the tail in their declaration
// order.
//
// `VelocityGridOptions.sortingOrder` reshapes the cycleSort cycle — default
// `['asc', 'desc', null]`. Setting `['asc', 'desc']` removes the unsorted
// state so the column always sorted (third cycle stage wraps back to asc).

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    host = createWorkerHost((msg) => {
      queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
    });
    constructor(public url: URL) {}
    postMessage(msg: any) { this.host.handle(msg); }
    addEventListener(_: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
    terminate() {}
  };

  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    return () => fakeCtx as any;
  })() as any;
});

function mkGrid(opts: {
  columnDefs: Array<Record<string, unknown>>;
  sortingOrder?: Array<'asc' | 'desc' | null>;
}) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const grid = new VelocityGrid<{ id: string; a: number; b: number; c: number }>(container, {
    columnDefs: opts.columnDefs as any,
    sortingOrder: opts.sortingOrder,
    getRowId: (r) => r.id,
    rowData: [
      { id: 'r1', a: 3, b: 30, c: 300 },
      { id: 'r2', a: 1, b: 10, c: 100 },
      { id: 'r3', a: 2, b: 20, c: 200 },
    ],
  });
  return {
    grid,
    container,
    cycle: (colId: string, opts2?: { append?: boolean }) => (grid as any).cycleSort(colId, opts2),
    model: () => (grid as any).sortModel as Array<{ colId: string; direction: 'asc' | 'desc' }>,
    cleanup: () => { grid.destroy(); container.remove(); },
  };
}

describe('initialSort — seeds the sort model on construction', () => {
  it('single column with initialSort: "desc" produces a one-entry sort model', async () => {
    const t = mkGrid({
      columnDefs: [
        { field: 'id' },
        { field: 'a', type: 'number', initialSort: 'desc' },
        { field: 'b', type: 'number' },
      ],
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(t.model()).toEqual([{ colId: 'a', direction: 'desc' }]);
    t.cleanup();
  });

  it('multiple columns with initialSort + initialSortIndex are ordered by index', async () => {
    const t = mkGrid({
      columnDefs: [
        { field: 'id' },
        { field: 'a', type: 'number', initialSort: 'asc', initialSortIndex: 1 },
        { field: 'b', type: 'number', initialSort: 'desc', initialSortIndex: 0 },
        { field: 'c', type: 'number' },
      ],
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(t.model()).toEqual([
      { colId: 'b', direction: 'desc' },
      { colId: 'a', direction: 'asc' },
    ]);
    t.cleanup();
  });

  it('initialSort columns without initialSortIndex sort to the tail in declaration order', async () => {
    const t = mkGrid({
      columnDefs: [
        { field: 'id' },
        { field: 'a', type: 'number', initialSort: 'asc' },
        { field: 'b', type: 'number', initialSort: 'desc', initialSortIndex: 0 },
        { field: 'c', type: 'number', initialSort: 'asc' },
      ],
    });
    await new Promise((r) => setTimeout(r, 30));
    // b (index 0) first, then a + c (no index) in declaration order.
    expect(t.model()).toEqual([
      { colId: 'b', direction: 'desc' },
      { colId: 'a', direction: 'asc' },
      { colId: 'c', direction: 'asc' },
    ]);
    t.cleanup();
  });

  it('no initialSort fields → sort model starts empty', async () => {
    const t = mkGrid({
      columnDefs: [
        { field: 'id' },
        { field: 'a', type: 'number' },
        { field: 'b', type: 'number' },
      ],
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(t.model()).toEqual([]);
    t.cleanup();
  });
});

describe('sortingOrder — reshapes the cycleSort cycle', () => {
  it('default cycle (omitted) is asc → desc → null', async () => {
    const t = mkGrid({
      columnDefs: [
        { field: 'id' },
        { field: 'a', type: 'number' },
      ],
    });
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    expect(t.model()).toEqual([{ colId: 'a', direction: 'asc' }]);
    t.cycle('a');
    expect(t.model()).toEqual([{ colId: 'a', direction: 'desc' }]);
    t.cycle('a');
    expect(t.model()).toEqual([]);
    t.cleanup();
  });

  it('["asc", "desc"] wraps back to asc instead of clearing on the third cycle', async () => {
    const t = mkGrid({
      columnDefs: [
        { field: 'id' },
        { field: 'a', type: 'number' },
      ],
      sortingOrder: ['asc', 'desc'],
    });
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    expect(t.model()).toEqual([{ colId: 'a', direction: 'asc' }]);
    t.cycle('a');
    expect(t.model()).toEqual([{ colId: 'a', direction: 'desc' }]);
    t.cycle('a');
    expect(t.model()).toEqual([{ colId: 'a', direction: 'asc' }]);
    t.cleanup();
  });

  it('["desc", "asc", null] starts with desc', async () => {
    const t = mkGrid({
      columnDefs: [
        { field: 'id' },
        { field: 'a', type: 'number' },
      ],
      sortingOrder: ['desc', 'asc', null],
    });
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    expect(t.model()).toEqual([{ colId: 'a', direction: 'desc' }]);
    t.cycle('a');
    expect(t.model()).toEqual([{ colId: 'a', direction: 'asc' }]);
    t.cycle('a');
    expect(t.model()).toEqual([]);
    t.cleanup();
  });

  it('sortingOrder honored in append (Shift+click) mode too', async () => {
    const t = mkGrid({
      columnDefs: [
        { field: 'id' },
        { field: 'a', type: 'number' },
        { field: 'b', type: 'number' },
      ],
      sortingOrder: ['asc', 'desc'],
    });
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    t.cycle('b', { append: true });
    t.cycle('b', { append: true });
    // Third click on b would normally remove it; with ['asc','desc'] it wraps to asc.
    t.cycle('b', { append: true });
    expect(t.model()).toEqual([
      { colId: 'a', direction: 'asc' },
      { colId: 'b', direction: 'asc' },
    ]);
    t.cleanup();
  });
});
