import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';

beforeAll(() => {
  // ── stubs copied from tests/rulesKernelApi.test.ts ──
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
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

function makeGrid(themeClass = 'vg-theme-quartz') {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = themeClass;
  document.body.appendChild(container);
  return new VelocityGrid<{ id: string; px: number }>(container, {
    columnDefs: [{ field: 'id' }, { field: 'px' }],
    getRowId: (r) => r.id,
    theme: themeClass,
  });
}

describe('rowsChanged event (Cycle 21e / Task 12)', () => {
  it('applyTransaction emits ONE event with source transaction, batching adds+updates+removes', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }, { id: 'b', px: 2 }] });
    const events: any[] = [];
    grid.on('rowsChanged', (e) => events.push(e));
    grid.applyTransaction({
      add: [{ id: 'c', px: 3 }],
      update: [{ id: 'a', px: 10 }, { id: 'b', px: 20 }],
      remove: [{ id: 'b', px: 2 }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('transaction');
    expect(events[0].added).toEqual([{ rowId: 'c', row: { id: 'c', px: 3 } }]);
    expect(events[0].updated).toEqual([
      { rowId: 'a', row: { id: 'a', px: 10 }, oldRow: { id: 'a', px: 1 } },
      { rowId: 'b', row: { id: 'b', px: 20 }, oldRow: { id: 'b', px: 2 } },
    ]);
    // remove ran after update in the same tx — prev is the just-updated row
    expect(events[0].removed).toEqual([{ rowId: 'b', row: { id: 'b', px: 20 } }]);
    grid.destroy();
  });

  it('applyTransactionAsync emits source transactionAsync at enqueue time', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }] });
    const events: any[] = [];
    grid.on('rowsChanged', (e) => events.push(e));
    grid.applyTransactionAsync({ update: [{ id: 'a', px: 2 }] });
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('transactionAsync');
    grid.destroy();
  });

  it('edit commit path emits source edit via mirrorEditCommit', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }] });
    const events: any[] = [];
    grid.on('rowsChanged', (e) => events.push(e));
    (grid as any).mirrorEditCommit([{ id: 'a', px: 99 }]);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('edit');
    expect(events[0].updated[0].oldRow).toEqual({ id: 'a', px: 1 });
    // second edit sees the freshened mirror
    (grid as any).mirrorEditCommit([{ id: 'a', px: 100 }]);
    expect(events[1].updated[0].oldRow).toEqual({ id: 'a', px: 99 });
    grid.destroy();
  });

  it('setRowData full replace does NOT emit', () => {
    const grid = makeGrid();
    const events: any[] = [];
    grid.on('rowsChanged', (e) => events.push(e));
    grid.setRowData([{ id: 'a', px: 1 }]);
    expect(events).toHaveLength(0);
    grid.destroy();
  });

  it('gating: no listener → no clones (ownKeys-counting proxy)', () => {
    const grid = makeGrid();
    let ownKeysCalls = 0;
    const row = new Proxy({ id: 'a', px: 1 }, {
      ownKeys(t) { ownKeysCalls++; return Reflect.ownKeys(t); },
    });
    grid.applyTransaction({ add: [row] });
    // Update WITHOUT a listener: the stored proxy row must never be
    // spread ({...prev} triggers ownKeys).
    const before = ownKeysCalls;
    grid.applyTransaction({ update: [{ id: 'a', px: 2 }] });
    expect(ownKeysCalls).toBe(before);
    // Re-seed the proxy, attach a listener → the snapshot spread runs.
    grid.applyTransaction({ update: [row] });
    grid.on('rowsChanged', () => {});
    const mid = ownKeysCalls;
    grid.applyTransaction({ update: [{ id: 'a', px: 3 }] });
    expect(ownKeysCalls).toBeGreaterThan(mid);
    grid.destroy();
  });

  it('gating: unsubscribing restores the zero-cost path', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }] });
    const events: any[] = [];
    const off = grid.on('rowsChanged', (e) => events.push(e));
    grid.applyTransaction({ update: [{ id: 'a', px: 2 }] });
    off();
    grid.applyTransaction({ update: [{ id: 'a', px: 3 }] });
    expect(events).toHaveLength(1);
    grid.destroy();
  });
});
