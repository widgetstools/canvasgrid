import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid, inferRowIdField } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';

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

  describe('setFocusedCell / setSelectedRowIds (Task 7)', () => {
    // Swap the fake Worker stub for a wired one that routes messages through
    // the real createWorkerHost — exercises the full main → worker → main loop
    // for the new ID-keyed APIs.
    function buildWiredGrid<T extends { id: string }>(rows: T[], cols: any[]) {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const prevWorker = (globalThis as any).Worker;
      (globalThis as any).Worker = class {
        listeners: Array<(e: { data: any }) => void> = [];
        host = createWorkerHost((msg) => {
          // Microtask delay mirrors the real Worker postMessage boundary.
          queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
        });
        constructor(public url: URL) {}
        postMessage(msg: any) { this.host.handle(msg); }
        addEventListener(_: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
        terminate() {}
      };
      const grid = new CGrid<T>(container, {
        columnDefs: cols,
        getRowId: (r) => r.id,
        rowSelection: 'multiple',
        rowData: rows,
      });
      const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
      return { grid, container, restore };
    }

    it('setSelectedRowIds resolves rowIds to indices and survives a setSortModel', async () => {
      const { grid, restore } = buildWiredGrid<{ id: string; pri: number }>(
        [
          { id: 'a', pri: 30 },
          { id: 'b', pri: 10 },
          { id: 'c', pri: 20 },
        ],
        [{ field: 'id' }, { field: 'pri', type: 'number' }],
      );
      const selectionEvents: string[][] = [];
      grid.on('selectionChanged', (e) => selectionEvents.push(e.selectedRowIds));

      await new Promise((r) => setTimeout(r, 50));
      expect((grid as any).rowCount).toBe(3);
      grid.setSelectedRowIds(['a', 'c']);
      await new Promise((r) => setTimeout(r, 50));
      // Initial order: a=0, b=1, c=2.
      const indices = Array.from((grid as any).selection.state.selectedRowIndices as Set<number>).sort();
      expect(indices).toEqual([0, 2]);
      expect(selectionEvents.at(-1)).toEqual(['a', 'c']);

      // Sort ascending by pri: b(10), c(20), a(30) → a=2, c=1.
      grid.setSortModel([{ colId: 'pri', direction: 'asc' }]);
      await new Promise((r) => setTimeout(r, 50));
      const afterSort = Array.from((grid as any).selection.state.selectedRowIndices as Set<number>).sort();
      expect(afterSort).toEqual([1, 2]);
      expect(grid.getSelectedRowIds().sort()).toEqual(['a', 'c']);

      grid.destroy();
      restore();
    });

    it('setFocusedCell resolves rowId to the visible-order index and survives setSortModel', async () => {
      const { grid, restore } = buildWiredGrid<{ id: string; pri: number }>(
        [
          { id: 'a', pri: 30 },
          { id: 'b', pri: 10 },
          { id: 'c', pri: 20 },
        ],
        [{ field: 'id' }, { field: 'pri', type: 'number' }],
      );
      await new Promise((r) => setTimeout(r, 50));
      expect((grid as any).rowCount).toBe(3);
      grid.setFocusedCell('c', 'pri');
      await new Promise((r) => setTimeout(r, 50));
      expect((grid as any).selection.state.focusedRowIndex).toBe(2);
      expect(grid.getFocusedCell()).toEqual({ rowId: 'c', colId: 'pri' });

      // Sort ascending: c → index 1.
      grid.setSortModel([{ colId: 'pri', direction: 'asc' }]);
      await new Promise((r) => setTimeout(r, 50));
      expect((grid as any).selection.state.focusedRowIndex).toBe(1);
      expect(grid.getFocusedCell()).toEqual({ rowId: 'c', colId: 'pri' });

      grid.destroy();
      restore();
    });

    it('focused cell ID survives applyTransaction({ update: [...] })', async () => {
      const { grid, restore } = buildWiredGrid<{ id: string; v: number }>(
        [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }],
        [{ field: 'id' }, { field: 'v', type: 'number' }],
      );
      await new Promise((r) => setTimeout(r, 50));
      grid.setFocusedCell('b', 'v');
      await new Promise((r) => setTimeout(r, 50));
      expect(grid.getFocusedCell()).toEqual({ rowId: 'b', colId: 'v' });

      // Sync update — worker pushes a modelUpdated which should re-resolve focus.
      grid.applyTransaction({ update: [{ id: 'b', v: 99 }] });
      await new Promise((r) => setTimeout(r, 50));
      expect(grid.getFocusedCell()).toEqual({ rowId: 'b', colId: 'v' });
      expect((grid as any).selection.state.focusedRowIndex).toBe(1);

      grid.destroy();
      restore();
    });

    it('setSelectedRowIds is a no-op for unknown rowIds (paint set empty, ids retained)', async () => {
      const { grid, restore } = buildWiredGrid<{ id: string }>(
        [{ id: 'a' }, { id: 'b' }],
        [{ field: 'id' }],
      );
      await new Promise((r) => setTimeout(r, 50));
      expect((grid as any).rowCount).toBe(2);
      grid.setSelectedRowIds(['ghost']);
      // Allow one round-trip for the worker resolve.
      await new Promise((r) => setTimeout(r, 20));
      expect((grid as any).selection.state.selectedRowIndices.size).toBe(0);
      expect(grid.getSelectedRowIds()).toEqual(['ghost']);
      grid.destroy();
      restore();
    });

    it('setFocusedCell with unknown colId is a no-op', async () => {
      const { grid, restore } = buildWiredGrid<{ id: string }>(
        [{ id: 'a' }],
        [{ field: 'id' }],
      );
      await new Promise((r) => setTimeout(r, 50));
      expect((grid as any).rowCount).toBe(1);
      grid.setFocusedCell('a', 'does-not-exist');
      await new Promise((r) => setTimeout(r, 20));
      expect((grid as any).selection.state.focusedColId).toBeNull();
      grid.destroy();
      restore();
    });
  });

  describe('column state round-trip (Cycle 6 / Task 2)', () => {
    function buildBareGrid<T extends { id: string }>(rows: T[], cols: any[]) {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const grid = new CGrid<T>(container, {
        columnDefs: cols,
        getRowId: (r) => r.id,
        rowData: rows,
      });
      // Drive the fake worker's `ready` so init resolves.
      const w = (grid as any).workerClient.worker;
      w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
      return { grid, container };
    }

    it('getColumnState returns one entry per leaf in declaration order including hidden leaves', () => {
      const { grid } = buildBareGrid<{ id: string; a: number; b: number }>(
        [],
        [
          { field: 'id', width: 100 },
          { field: 'a', width: 150, hide: true },
          { field: 'b', width: 200 },
        ],
      );
      const state = grid.getColumnState();
      expect(state.map((s) => s.colId)).toEqual(['id', 'a', 'b']);
      const aState = state.find((s) => s.colId === 'a')!;
      expect(aState.hide).toBe(true);
      grid.destroy();
    });

    it('applyColumnState triggers exactly one recomputeViewport invocation', () => {
      const { grid } = buildBareGrid<{ id: string; a: number; b: number }>(
        [],
        [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
      );
      const spy = vi.spyOn(grid as any, 'recomputeViewport');
      spy.mockClear();
      grid.applyColumnState({
        state: [
          { colId: 'a', width: 300 },
          { colId: 'b', width: 250 },
        ],
      });
      expect(spy).toHaveBeenCalledTimes(1);
      grid.destroy();
    });

    it('applyColumnState with hide:true filters the column out of the visible-leaf order', () => {
      const { grid } = buildBareGrid<{ id: string; a: number; b: number }>(
        [],
        [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
      );
      grid.applyColumnState({ state: [{ colId: 'a', hide: true }] });
      const visibleIds = ((grid as any).columnOrder as Array<{ colId: string }>).map((c) => c.colId);
      expect(visibleIds).toEqual(['id', 'b']);
      // But getColumnState still reports the hidden column.
      const state = grid.getColumnState();
      expect(state.find((s) => s.colId === 'a')?.hide).toBe(true);
      grid.destroy();
    });

    it('lockVisible silently rejects a hide mutation', () => {
      const { grid } = buildBareGrid<{ id: string; a: number }>(
        [],
        [{ field: 'id' }, { field: 'a', lockVisible: true }],
      );
      const ok = grid.applyColumnState({ state: [{ colId: 'a', hide: true }] });
      expect(ok).toBe(true);
      // `a` remains visible because lockVisible vetoed the hide flip.
      const visibleIds = ((grid as any).columnOrder as Array<{ colId: string }>).map((c) => c.colId);
      expect(visibleIds).toEqual(['id', 'a']);
      grid.destroy();
    });

    it('lockPinned silently rejects a pinned mutation', () => {
      const { grid } = buildBareGrid<{ id: string; a: number }>(
        [],
        [{ field: 'id' }, { field: 'a', pinned: 'left', lockPinned: true }],
      );
      const events: any[] = [];
      grid.on('columnPinned', (e) => events.push(e));
      grid.applyColumnState({ state: [{ colId: 'a', pinned: null }] });
      // Resolved pinned untouched.
      expect((grid as any).columnDefsMap.get('a').pinned).toBe('left');
      expect(events).toEqual([]);
      grid.destroy();
    });

    it('defaultState applies to leaves not mentioned in state', () => {
      const { grid } = buildBareGrid<{ id: string; a: number; b: number }>(
        [],
        [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
      );
      grid.applyColumnState({
        state: [{ colId: 'id', hide: false }],
        defaultState: { hide: true },
      });
      const visibleIds = ((grid as any).columnOrder as Array<{ colId: string }>).map((c) => c.colId);
      expect(visibleIds).toEqual(['id']);
      grid.destroy();
    });

    it('resetColumnState restores the construction-time snapshot and fires columnsReset', async () => {
      const { grid } = buildBareGrid<{ id: string; a: number; b: number }>(
        [],
        [
          { field: 'id', width: 100 },
          { field: 'a', width: 150 },
          { field: 'b', width: 200 },
        ],
      );
      // Mutate first — hide `a`, widen `b`.
      grid.applyColumnState({
        state: [{ colId: 'a', hide: true }, { colId: 'b', width: 500 }],
      });
      const events: string[] = [];
      grid.on('columnsReset', () => events.push('columnsReset'));
      grid.on('columnVisible', () => events.push('columnVisible'));
      grid.on('columnResized', () => events.push('columnResized'));
      grid.resetColumnState();
      expect(events[0]).toBe('columnsReset');
      // After reset, `a` is visible again and `b` is back to its initial width.
      expect((grid as any).columnDefsMap.get('a').hide).toBe(false);
      expect((grid as any).columnDefsMap.get('b').width).toBe(200);
      grid.destroy();
    });

    it('applyColumnState with applyOrder: true rewrites the visible leaf order', () => {
      const { grid } = buildBareGrid<{ id: string; a: number; b: number; c: number }>(
        [],
        [{ field: 'id' }, { field: 'a' }, { field: 'b' }, { field: 'c' }],
      );
      const initial = grid.getColumnState().map((s) => s.colId);
      expect(initial).toEqual(['id', 'a', 'b', 'c']);
      grid.applyColumnState({
        state: [
          { colId: 'id' },
          { colId: 'c' },
          { colId: 'b' },
          { colId: 'a' },
        ],
        applyOrder: true,
      });
      const after = grid.getColumnState().map((s) => s.colId);
      expect(after).toEqual(['id', 'c', 'b', 'a']);
    });

    it('applyColumnState returns false when one or more colIds are unknown', () => {
      const { grid } = buildBareGrid<{ id: string; a: number }>(
        [],
        [{ field: 'id' }, { field: 'a' }],
      );
      const ok = grid.applyColumnState({
        state: [{ colId: 'a', width: 250 }, { colId: 'does-not-exist', hide: true }],
      });
      expect(ok).toBe(false);
      grid.destroy();
    });
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
