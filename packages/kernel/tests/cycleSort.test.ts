// Cycle 8 / Task 1 — cycleSort multi-column semantics.
//
// CGrid.cycleSort (private) cycles a single column's sort direction
// (unsorted → asc → desc → unsorted). With Cycle 8 / Task 1 the
// method takes an optional `{ append }` flag — when `true`, the
// column is appended to the existing sort model instead of replacing
// it. If the column is already in the model, append cycles its
// direction in place; if it cycles to "unsorted", it is removed.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
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

function mkGrid(extraOpts: Record<string, unknown> = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const grid = new CGrid<{ id: string; a: number; b: number; c: number }>(container, {
    columnDefs: [
      { field: 'id' },
      { field: 'a', type: 'number' },
      { field: 'b', type: 'number' },
      { field: 'c', type: 'number' },
    ],
    getRowId: (r) => r.id,
    rowData: [
      { id: 'r1', a: 3, b: 30, c: 300 },
      { id: 'r2', a: 1, b: 10, c: 100 },
      { id: 'r3', a: 2, b: 20, c: 200 },
    ],
    ...extraOpts,
  });
  return {
    grid,
    container,
    cycle: (colId: string, opts?: { append?: boolean }) => (grid as any).cycleSort(colId, opts),
    model: () => (grid as any).sortModel as Array<{ colId: string; direction: 'asc' | 'desc' }>,
    cleanup: () => { grid.destroy(); container.remove(); },
  };
}

describe('cycleSort — single-column cycle (plain click)', () => {
  it('unsorted → asc', async () => {
    const t = mkGrid();
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    expect(t.model()).toEqual([{ colId: 'a', direction: 'asc' }]);
    t.cleanup();
  });

  it('asc → desc', async () => {
    const t = mkGrid();
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    t.cycle('a');
    expect(t.model()).toEqual([{ colId: 'a', direction: 'desc' }]);
    t.cleanup();
  });

  it('desc → unsorted (empty model)', async () => {
    const t = mkGrid();
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    t.cycle('a');
    t.cycle('a');
    expect(t.model()).toEqual([]);
    t.cleanup();
  });

  it('plain click on a different column REPLACES the existing model', async () => {
    const t = mkGrid();
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    t.cycle('b');
    expect(t.model()).toEqual([{ colId: 'b', direction: 'asc' }]);
    t.cleanup();
  });
});

describe('cycleSort — multi-column cycle (Shift+click / append)', () => {
  it('append on an unsorted column appends to the existing model', async () => {
    const t = mkGrid();
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    t.cycle('b', { append: true });
    expect(t.model()).toEqual([
      { colId: 'a', direction: 'asc' },
      { colId: 'b', direction: 'asc' },
    ]);
    t.cleanup();
  });

  it('append on an already-sorted column cycles direction in place', async () => {
    const t = mkGrid();
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    t.cycle('b', { append: true });
    t.cycle('b', { append: true });
    expect(t.model()).toEqual([
      { colId: 'a', direction: 'asc' },
      { colId: 'b', direction: 'desc' },
    ]);
    t.cleanup();
  });

  it('append on a desc column REMOVES it from the model (does not collapse to single-col)', async () => {
    const t = mkGrid();
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    t.cycle('b', { append: true });
    t.cycle('b', { append: true });
    t.cycle('b', { append: true });
    expect(t.model()).toEqual([{ colId: 'a', direction: 'asc' }]);
    t.cleanup();
  });

  it('append preserves order — cycling a non-tail entry does NOT reorder it', async () => {
    const t = mkGrid();
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a');
    t.cycle('b', { append: true });
    t.cycle('c', { append: true });
    // a, b, c all asc — cycling b in place keeps it at index 1.
    t.cycle('b', { append: true });
    expect(t.model()).toEqual([
      { colId: 'a', direction: 'asc' },
      { colId: 'b', direction: 'desc' },
      { colId: 'c', direction: 'asc' },
    ]);
    t.cleanup();
  });

  it('append on an unsorted column with an empty model behaves like plain click (model = [new entry])', async () => {
    const t = mkGrid();
    await new Promise((r) => setTimeout(r, 30));
    t.cycle('a', { append: true });
    expect(t.model()).toEqual([{ colId: 'a', direction: 'asc' }]);
    t.cleanup();
  });
});
