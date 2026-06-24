import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid, inferRowIdField } from '../src/cgrid';

// Stub Worker for happy-dom env. CGrid accepts options.worker.url; in tests we inject a fake.
beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };

  // Stub canvas 2D context — happy-dom does not implement it. attachGcCache
  // walks our explicit CACHED_PROPS list and installs getters/setters on a
  // proxy of this object, so the fake just needs the methods + plain data
  // properties.
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

describe('CGrid integration', () => {
  it('constructs and emits gridReady', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'cg-theme-quartz';
    document.body.appendChild(container);
    const events: any[] = [];
    const grid = new CGrid<{ id: string; name: string }>(container, {
      columnDefs: [{ field: 'id' }, { field: 'name' }],
      getRowId: (r) => r.id,
      theme: 'cg-theme-quartz',
    });
    grid.on('gridReady', (e) => events.push(e));
    // Simulate worker 'ready' response so the integration completes.
    const w = (grid as any).workerClient.worker;  // fakeWorker
    w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(events.length).toBe(1);
    grid.destroy();
  });

  it('ensureColumnVisible is a no-op for pinned columns and unknown IDs', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'cg-theme-quartz';
    document.body.appendChild(container);
    const grid = new CGrid<{ id: string; a: number; b: number }>(container, {
      columnDefs: [
        { field: 'id', width: 80, pinned: 'left' },
        { field: 'a',  width: 200 },
        { field: 'b',  width: 200 },
      ],
      getRowId: (r) => r.id,
    });
    const api = (grid as any).makeApi();
    // No throw; the API surface accepts both signatures.
    api.ensureColumnVisible('id');           // pinned → no-op
    api.ensureColumnVisible('does-not-exist'); // unknown → no-op
    api.ensureColumnVisible('a', 'start');
    api.ensureColumnVisible('b', 'middle');
    grid.destroy();
  });

  it('ensureColumnGroupVisible opens ancestor groups before scrolling to the first leaf', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'cg-theme-quartz';
    document.body.appendChild(container);
    const grid = new CGrid<{ id: string; a: number; b: number; c: number }>(container, {
      columnDefs: [
        { field: 'id', width: 80 },
        {
          groupId: 'outer',
          openByDefault: false,
          children: [
            { field: 'a', width: 100 },
            {
              groupId: 'inner',
              openByDefault: false,
              children: [
                { field: 'b', width: 100 },
                { field: 'c', width: 100 },
              ],
            },
          ],
        },
      ],
      getRowId: (r) => r.id,
    });
    const groupState = (grid as any).columnGroupState;
    expect(groupState.isOpen('outer')).toBe(false);
    expect(groupState.isOpen('inner')).toBe(false);
    const api = (grid as any).makeApi();
    api.ensureColumnGroupVisible('inner');
    expect(groupState.isOpen('outer')).toBe(true);
    expect(groupState.isOpen('inner')).toBe(true);
    // Unknown groupId is a no-op (no throw).
    api.ensureColumnGroupVisible('not-a-group');
    grid.destroy();
  });

  it('accepts a CColGroupDef in columnDefs and resolves leaves in declaration order', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'cg-theme-quartz';
    document.body.appendChild(container);
    const grid = new CGrid<{ id: string; a: number; b: number; c: number }>(container, {
      columnDefs: [
        { field: 'id', width: 80 },
        {
          headerName: 'metrics',
          children: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
        },
      ],
      getRowId: (r) => r.id,
    });
    const tree = (grid as any).columnTree;
    expect(tree.leaves.map((l: any) => l.colId)).toEqual(['id', 'a', 'b', 'c']);
    expect(tree.maxDepth).toBe(1);
    grid.destroy();
  });
});

describe('inferRowIdField', () => {
  it('captures the field in a single-level accessor', () => {
    expect(inferRowIdField((row: { id: string }) => row.id)).toBe('id');
  });

  it('throws for a nested accessor (row.meta.id) because RowStore does flat lookup', () => {
    expect(() => inferRowIdField((row: { meta: { id: string } }) => row.meta.id)).toThrow(/nested/);
  });

  it('throws for a deeply-nested accessor (row.deeply.nested.field)', () => {
    expect(() => inferRowIdField((row: any) => row.deeply.nested.field)).toThrow(/nested/);
  });

  it('throws when no property access present', () => {
    expect(() => inferRowIdField(() => 'literal')).toThrow(/Foundation cycle/);
  });
});
