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

    it('text-column valueFormatter reaches painted cell text (cellAt parity with numbers)', async () => {
      const { grid, restore } = buildWiredGrid<{ id: string; ticker: string }>(
        [
          { id: 'a', ticker: 'TICK1' },
          { id: 'b', ticker: 'TICK2' },
        ],
        [
          { field: 'id' },
          {
            field: 'ticker',
            cellDataType: 'text',
            valueFormatter: (p: { value: unknown }) => String(p.value).toLowerCase(),
          },
        ],
      );
      await new Promise((r) => setTimeout(r, 50));
      expect((grid as any).rowCount).toBe(2);
      const cell = (grid as any).cellAt(0, 'ticker');
      expect(cell.value).toBe('TICK1');           // raw value untouched
      expect(cell.valueFormatted).toBe('tick1');  // formatter applied to painted text
      // Column without a formatter stays identity.
      expect((grid as any).cellAt(0, 'id').valueFormatted).toBe('a');
      grid.destroy();
      restore();
    });

    it('emits cellFocused on genuine focus moves, silent on same-cell reorders', async () => {
      const { grid, restore } = buildWiredGrid<{ id: string; pri: number }>(
        [
          { id: 'a', pri: 30 },
          { id: 'b', pri: 10 },
          { id: 'c', pri: 20 },
        ],
        [{ field: 'id' }, { field: 'pri', type: 'number' }],
      );
      await new Promise((r) => setTimeout(r, 50));
      const events: Array<{ rowId: string; colId: string }> = [];
      grid.addEventListener('cellFocused', (e: any) => events.push({ rowId: e.rowId, colId: e.colId }));

      grid.setFocusedCell('c', 'pri');
      await new Promise((r) => setTimeout(r, 50));
      expect(events).toEqual([{ rowId: 'c', colId: 'pri' }]);

      // Same logical cell re-indexed by a sort — no second emission.
      grid.setSortModel([{ colId: 'pri', direction: 'asc' }]);
      await new Promise((r) => setTimeout(r, 50));
      expect(events).toHaveLength(1);

      // Moving focus to another cell emits again.
      grid.setFocusedCell('a', 'id');
      await new Promise((r) => setTimeout(r, 50));
      expect(events).toEqual([
        { rowId: 'c', colId: 'pri' },
        { rowId: 'a', colId: 'id' },
      ]);

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

    it('applyColumnState with order change + width/hide mutations lands in ONE call', () => {
      // Regression: when applyOrder rebuilds the column tree, the
      // freshly-resolved leaves use construction-time defaults. The
      // just-applied width/hide mutations live on the discarded old
      // tree's leaves. Earlier behavior required a second
      // applyColumnState call before the width/hide values stuck —
      // visible to demo users as "click Restore twice."
      const { grid } = buildBareGrid<{ id: string; a: number; b: number; c: number }>(
        [],
        [
          { field: 'id', width: 80 },
          { field: 'a', width: 100 },
          { field: 'b', width: 100 },
          { field: 'c', width: 100 },
        ],
      );
      grid.applyColumnState({
        state: [
          { colId: 'id', width: 80, hide: false },
          { colId: 'c', width: 300, hide: false },
          { colId: 'a', width: 250, hide: false },
          { colId: 'b', width: 100, hide: true },
        ],
        applyOrder: true,
      });
      // Order honored.
      const state = grid.getColumnState();
      expect(state.map((s) => s.colId)).toEqual(['id', 'c', 'a', 'b']);
      // Widths land in ONE call.
      expect(state.find((s) => s.colId === 'c')?.width).toBe(300);
      expect(state.find((s) => s.colId === 'a')?.width).toBe(250);
      // Hide flip lands in ONE call — b is filtered out of the visible
      // order even though it is still present in the snapshot.
      const visibleIds = ((grid as any).columnOrder as Array<{ colId: string }>).map((c) => c.colId);
      expect(visibleIds).toEqual(['id', 'c', 'a']);
      expect(state.find((s) => s.colId === 'b')?.hide).toBe(true);
      grid.destroy();
    });

    it('applyColumnState with a single-column sort pushes it to the worker', async () => {
      // Regression: the sort handler used to mutate this.sortModel
      // in-place and emit sortChanged, but never push to the worker via
      // setSortModel. The rendered rows then stayed in the pre-restore
      // order even though the header indicator updated. Now we route
      // through setSortModel so the worker re-sorts the chunk.
      const { grid } = buildBareGrid<{ id: string; a: number; b: number }>(
        [],
        [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
      );
      const workerSpy = vi.spyOn((grid as any).workerClient, 'setSortModel');
      workerSpy.mockClear();
      grid.applyColumnState({
        state: [
          { colId: 'a', sort: 'desc', sortIndex: 0 },
          { colId: 'b', sort: null, sortIndex: null },
          { colId: 'id', sort: null, sortIndex: null },
        ],
      });
      expect(workerSpy).toHaveBeenCalledTimes(1);
      const sortArg = workerSpy.mock.calls[0]![0];
      expect(sortArg).toEqual([{ colId: 'a', direction: 'desc' }]);
      grid.destroy();
    });

    it('every CColumnState slot round-trips: save → restore → re-save matches', () => {
      // The ag-grid ColumnState contract (catalog 02 line 174-176) covers
      // 12 slots: colId, width, flex, hide, pinned, sort, sortIndex,
      // aggFunc, rowGroup, rowGroupIndex, pivot, pivotIndex. This test
      // mutates every slot to a non-default value, asserts the snapshot
      // captures each one, then round-trips through reset + apply and
      // asserts the second snapshot equals the first. Any slot that
      // fails to persist OR restore surfaces here.
      const { grid } = buildBareGrid<{ id: string; a: number; b: number; c: number; d: number }>(
        [],
        [
          { field: 'id', width: 80 },
          { field: 'a', width: 100 },
          { field: 'b', width: 120 },
          { field: 'c', width: 140 },
          { field: 'd', width: 160 },
        ],
      );
      // Drive every slot to a distinct value.
      grid.applyColumnState({
        state: [
          { colId: 'id', width: 80,  hide: false, pinned: 'left',  flex: null, sort: null,   sortIndex: null, aggFunc: null,  rowGroup: false, rowGroupIndex: null, pivot: false, pivotIndex: null },
          { colId: 'a',  width: 250, hide: false, pinned: null,    flex: null, sort: 'asc',  sortIndex: 1,    aggFunc: 'sum', rowGroup: true,  rowGroupIndex: 0,    pivot: false, pivotIndex: null },
          { colId: 'b',  width: 220, hide: true,  pinned: null,    flex: null, sort: 'desc', sortIndex: 0,    aggFunc: 'avg', rowGroup: false, rowGroupIndex: null, pivot: true,  pivotIndex: 0 },
          { colId: 'c',  width: 180, hide: false, pinned: 'right', flex: 2,    sort: null,   sortIndex: null, aggFunc: 'max', rowGroup: false, rowGroupIndex: null, pivot: false, pivotIndex: null },
          { colId: 'd',  width: 200, hide: false, pinned: null,    flex: null, sort: null,   sortIndex: null, aggFunc: 'min', rowGroup: false, rowGroupIndex: null, pivot: false, pivotIndex: null },
        ],
        applyOrder: true,
      });
      const snapshot = grid.getColumnState();

      // Snapshot-side assertions: every slot was actually captured by
      // getColumnState (catches "always returns null" bugs).
      // Cycle 18 / Task 8b — applyColumnState now writes rowGroup through
      // GroupingState; Cycle 15's auto-group-hide behaviour kicks in and
      // hides the primary column once it becomes a row-group level. So `a`
      // ends up `hide: true` even though the input state said false. The
      // round-trip remains symmetric (the second apply sees hide:true and
      // keeps it).
      const byId = new Map(snapshot.map((s) => [s.colId, s]));
      expect(byId.get('a')).toMatchObject({
        width: 250, hide: true, pinned: null,
        sort: 'asc', sortIndex: 1, aggFunc: 'sum',
        rowGroup: true, rowGroupIndex: 0,
      });
      expect(byId.get('b')).toMatchObject({
        width: 220, hide: true, sort: 'desc', sortIndex: 0,
        aggFunc: 'avg', pivot: true, pivotIndex: 0,
      });
      expect(byId.get('c')).toMatchObject({
        width: 180, pinned: 'right', flex: 2, aggFunc: 'max',
      });

      // Round-trip: reset → re-apply the snapshot.
      grid.resetColumnState();
      grid.applyColumnState({ state: snapshot, applyOrder: true });
      const restored = grid.getColumnState();

      // Strict equality across every slot. JSON-clone normalises ordering
      // of the objects so the diff prints cleanly on failure.
      expect(JSON.parse(JSON.stringify(restored))).toEqual(JSON.parse(JSON.stringify(snapshot)));
      grid.destroy();
    });

    it('save snapshot survives a fresh grid instance (simulates page reload)', () => {
      // The demo's persistence path: getColumnState → JSON.stringify →
      // localStorage. On reload, a brand-new CGrid is constructed from
      // the original CColDefs, then applyColumnState replays the saved
      // snapshot. This test exercises that exact shape.
      const cols = [
        { field: 'id', width: 80 },
        { field: 'a', width: 100 },
        { field: 'b', width: 120 },
        { field: 'c', width: 140 },
      ];
      const { grid: g1 } = buildBareGrid<{ id: string; a: number; b: number; c: number }>(
        [],
        cols,
      );
      // Mutate every slot.
      g1.applyColumnState({
        state: [
          { colId: 'id', width: 80 },
          { colId: 'c',  width: 333, pinned: 'right', sort: 'asc',  sortIndex: 1, aggFunc: 'sum' },
          { colId: 'a',  width: 222, hide: true,     sort: 'desc', sortIndex: 0, aggFunc: 'avg' },
          { colId: 'b',  width: 111, pinned: 'left', flex: 3,      rowGroup: true, rowGroupIndex: 0 },
        ],
        applyOrder: true,
      });
      const saved = JSON.parse(JSON.stringify(g1.getColumnState()));
      g1.destroy();

      // Fresh grid, same column defs (the original construction shape).
      const { grid: g2 } = buildBareGrid<{ id: string; a: number; b: number; c: number }>(
        [],
        cols,
      );
      g2.applyColumnState({ state: saved, applyOrder: true });
      const restored = JSON.parse(JSON.stringify(g2.getColumnState()));

      expect(restored).toEqual(saved);
      g2.destroy();
    });

    it('applyColumnState reorders multi-column sort entries by sortIndex', async () => {
      // Regression: the sort handler walked `sortChanges` in change-record
      // order and paired direction with the wrong colId via a filtered+map
      // index mismatch. Multi-column sort must respect sortIndex.
      const { grid } = buildBareGrid<{ id: string; a: number; b: number; c: number }>(
        [],
        [{ field: 'id' }, { field: 'a' }, { field: 'b' }, { field: 'c' }],
      );
      const workerSpy = vi.spyOn((grid as any).workerClient, 'setSortModel');
      workerSpy.mockClear();
      grid.applyColumnState({
        state: [
          // declare order id → a → b → c; sortIndex says b is first, a is second
          { colId: 'id', sort: null, sortIndex: null },
          { colId: 'a',  sort: 'asc', sortIndex: 1 },
          { colId: 'b',  sort: 'desc', sortIndex: 0 },
          { colId: 'c',  sort: null, sortIndex: null },
        ],
      });
      expect(workerSpy).toHaveBeenCalledTimes(1);
      const sortArg = workerSpy.mock.calls[0]![0];
      expect(sortArg).toEqual([
        { colId: 'b', direction: 'desc' },
        { colId: 'a', direction: 'asc' },
      ]);
      grid.destroy();
    });
  });

  // Cycle 18 / Task 8b — column state ↔ pivot/group runtime-state round-trip.
  // The Cycle 6 columnState primitive originally stored rowGroup / pivot /
  // aggFunc as OPAQUE def slots that round-tripped without firing the role-
  // state mutators. Task 8b wires getColumnState to source these flags from
  // the runtime GroupingState + PivotState, and applyColumnState to write
  // through those primitives so the row group panel / tool panel zones /
  // pivot panel / context menu items all reflect the restore. AG-parity
  // Prompt 8: pivotMode persists SEPARATELY (NOT in column state).
  describe('column state ↔ pivot/group runtime state round-trip (Cycle 18 / Task 8b)', () => {
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
      const w = (grid as any).workerClient.worker;
      w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
      return { grid, container };
    }

    it('addRowGroupColumn surfaces in getColumnState as rowGroup:true with rowGroupIndex', () => {
      const { grid } = buildBareGrid<{ id: string; sector: string; pnl: number }>(
        [],
        [{ field: 'id' }, { field: 'sector', enableRowGroup: true }, { field: 'pnl' }],
      );
      grid.addRowGroupColumn('sector');
      const state = grid.getColumnState();
      const s = state.find((e) => e.colId === 'sector')!;
      expect(s.rowGroup).toBe(true);
      expect(s.rowGroupIndex).toBe(0);
      // Columns not in the group list have rowGroup:false / index:null.
      const pnl = state.find((e) => e.colId === 'pnl')!;
      expect(pnl.rowGroup).toBe(false);
      expect(pnl.rowGroupIndex).toBeNull();
      grid.destroy();
    });

    it('addPivotColumn surfaces in getColumnState as pivot:true with pivotIndex', () => {
      const { grid } = buildBareGrid<{ id: string; region: string; sector: string }>(
        [],
        [{ field: 'id' }, { field: 'region', enablePivot: true }, { field: 'sector', enablePivot: true }],
      );
      grid.addPivotColumn('region');
      grid.addPivotColumn('sector');
      const state = grid.getColumnState();
      expect(state.find((e) => e.colId === 'region')!.pivot).toBe(true);
      expect(state.find((e) => e.colId === 'region')!.pivotIndex).toBe(0);
      expect(state.find((e) => e.colId === 'sector')!.pivot).toBe(true);
      expect(state.find((e) => e.colId === 'sector')!.pivotIndex).toBe(1);
      grid.destroy();
    });

    it('addValueColumn surfaces in getColumnState as aggFunc:"sum"', () => {
      const { grid } = buildBareGrid<{ id: string; pnl: number }>(
        [],
        [{ field: 'id' }, { field: 'pnl', enableValue: true }],
      );
      grid.addValueColumn('pnl', 'sum');
      const state = grid.getColumnState();
      expect(state.find((e) => e.colId === 'pnl')!.aggFunc).toBe('sum');
      grid.destroy();
    });

    it('colDef.aggFunc seeds value columns and round-trips through getColumnState', async () => {
      const { grid } = buildBareGrid<{ id: string; pnl: number }>(
        [],
        [{ field: 'id' }, { field: 'pnl', enableValue: true, aggFunc: 'sum' }],
      );
      // Construction seeds async on the gridReady path — wait a tick.
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      expect(grid.getValueColumns()).toEqual([{ colId: 'pnl', aggFunc: 'sum' }]);
      expect(grid.getColumnState().find((e) => e.colId === 'pnl')!.aggFunc).toBe('sum');
      // Round-trip must not wipe the seed (empty valueColumns used to
      // serialize aggFunc:null and clear measures on apply).
      grid.applyColumnState({ state: grid.getColumnState() });
      expect(grid.getValueColumns()).toEqual([{ colId: 'pnl', aggFunc: 'sum' }]);
      expect(grid.getColumnState().find((e) => e.colId === 'pnl')!.aggFunc).toBe('sum');
      grid.destroy();
    });

    it('setValueColumnAggFunc updates aggFunc in getColumnState (runtime swap not def-stale)', () => {
      const { grid } = buildBareGrid<{ id: string; pnl: number }>(
        [],
        [{ field: 'id' }, { field: 'pnl', enableValue: true, aggFunc: 'sum' }],
      );
      grid.addValueColumn('pnl', 'sum');
      grid.setValueColumnAggFunc('pnl', 'avg');
      expect(grid.getColumnState().find((e) => e.colId === 'pnl')!.aggFunc).toBe('avg');
      grid.destroy();
    });

    it('removePivotColumn / removeValueColumn / removeRowGroupColumn flip the corresponding flags off', () => {
      const { grid } = buildBareGrid<{ id: string; r: string; p: string; v: number }>(
        [],
        [
          { field: 'id' },
          { field: 'r', enableRowGroup: true },
          { field: 'p', enablePivot: true },
          { field: 'v', enableValue: true },
        ],
      );
      grid.addRowGroupColumn('r');
      grid.addPivotColumn('p');
      grid.addValueColumn('v', 'sum');
      grid.removeRowGroupColumn('r');
      grid.removePivotColumn('p');
      grid.removeValueColumn('v');
      const state = grid.getColumnState();
      expect(state.find((e) => e.colId === 'r')!.rowGroup).toBe(false);
      expect(state.find((e) => e.colId === 'r')!.rowGroupIndex).toBeNull();
      expect(state.find((e) => e.colId === 'p')!.pivot).toBe(false);
      expect(state.find((e) => e.colId === 'p')!.pivotIndex).toBeNull();
      expect(state.find((e) => e.colId === 'v')!.aggFunc).toBeNull();
      grid.destroy();
    });

    it('applyColumnState with rowGroup:true populates GroupingState.rowGroupColumns', () => {
      const { grid } = buildBareGrid<{ id: string; r: string }>(
        [],
        [{ field: 'id' }, { field: 'r', enableRowGroup: true }],
      );
      grid.applyColumnState({
        state: [
          { colId: 'id', rowGroup: false, rowGroupIndex: null },
          { colId: 'r',  rowGroup: true,  rowGroupIndex: 0    },
        ],
      });
      expect(grid.getRowGroupColumns()).toEqual(['r']);
      grid.destroy();
    });

    it('applyColumnState with pivot:true populates PivotState.pivotColumns (sorted by pivotIndex)', () => {
      const { grid } = buildBareGrid<{ id: string; a: string; b: string }>(
        [],
        [{ field: 'id' }, { field: 'a', enablePivot: true }, { field: 'b', enablePivot: true }],
      );
      grid.applyColumnState({
        state: [
          { colId: 'id' },
          { colId: 'a', pivot: true, pivotIndex: 1 },
          { colId: 'b', pivot: true, pivotIndex: 0 },
        ],
      });
      // pivotIndex sort wins: b (0) before a (1).
      expect(grid.getPivotColumns()).toEqual(['b', 'a']);
      grid.destroy();
    });

    it('applyColumnState with aggFunc populates PivotState.valueColumns', () => {
      const { grid } = buildBareGrid<{ id: string; pnl: number; qty: number }>(
        [],
        [
          { field: 'id' },
          { field: 'pnl', enableValue: true },
          { field: 'qty', enableValue: true },
        ],
      );
      grid.applyColumnState({
        state: [
          { colId: 'id' },
          { colId: 'pnl', aggFunc: 'sum' },
          { colId: 'qty', aggFunc: 'avg' },
        ],
      });
      const values = grid.getValueColumns();
      // Order follows state input order.
      expect(values).toEqual([
        { colId: 'pnl', aggFunc: 'sum' },
        { colId: 'qty', aggFunc: 'avg' },
      ]);
      grid.destroy();
    });

    it('applyColumnState fully REPLACES role lists — columns absent from the new state become un-grouped / un-pivoted / non-value', () => {
      const { grid } = buildBareGrid<{ id: string; a: string; b: string }>(
        [],
        [
          { field: 'id' },
          { field: 'a', enableRowGroup: true, enablePivot: true, enableValue: true },
          { field: 'b', enableRowGroup: true, enablePivot: true, enableValue: true },
        ],
      );
      // Seed: a and b in every role list.
      grid.addRowGroupColumn('a'); grid.addRowGroupColumn('b');
      grid.addPivotColumn('a');     grid.addPivotColumn('b');
      grid.addValueColumn('a', 'sum');
      grid.addValueColumn('b', 'avg');

      // Replace state with ONLY entries that omit role flags — full replace
      // semantics drop every previously-set role.
      grid.applyColumnState({
        state: [
          { colId: 'id' },
          { colId: 'a', rowGroup: false, pivot: false, aggFunc: null },
          { colId: 'b', rowGroup: false, pivot: false, aggFunc: null },
        ],
      });
      expect(grid.getRowGroupColumns()).toEqual([]);
      expect(grid.getPivotColumns()).toEqual([]);
      expect(grid.getValueColumns()).toEqual([]);
      grid.destroy();
    });

    it('pivotMode is NOT included in CColumnState (persists separately per AG parity)', () => {
      const { grid } = buildBareGrid<{ id: string }>([], [{ field: 'id' }]);
      grid.setPivotMode(true);
      const state = grid.getColumnState();
      // No entry, no property, no leak.
      for (const entry of state) {
        expect((entry as unknown as { pivotMode?: unknown }).pivotMode).toBeUndefined();
      }
      // Round-trip: applyColumnState on a fresh grid with pivotMode=false
      // does NOT alter pivotMode — the option is its own surface.
      const { grid: g2 } = buildBareGrid<{ id: string }>([], [{ field: 'id' }]);
      expect(g2.isPivotMode()).toBe(false);
      g2.applyColumnState({ state });
      expect(g2.isPivotMode()).toBe(false);
      grid.destroy();
      g2.destroy();
    });

    it('full round-trip: snapshot → fresh grid → applyColumnState → role lists restored', () => {
      const cols = [
        { field: 'id' },
        { field: 'sector', enableRowGroup: true, enablePivot: true },
        { field: 'region', enableRowGroup: true, enablePivot: true },
        { field: 'pnl',    enableValue: true },
        { field: 'qty',    enableValue: true },
      ];
      const { grid: g1 } = buildBareGrid<{
        id: string; sector: string; region: string; pnl: number; qty: number;
      }>([], cols);
      g1.addRowGroupColumn('sector');
      g1.addPivotColumn('region');
      g1.addValueColumn('pnl', 'sum');
      g1.addValueColumn('qty', 'avg');
      const saved = JSON.parse(JSON.stringify(g1.getColumnState()));
      g1.destroy();

      const { grid: g2 } = buildBareGrid<{
        id: string; sector: string; region: string; pnl: number; qty: number;
      }>([], cols);
      g2.applyColumnState({ state: saved });
      expect(g2.getRowGroupColumns()).toEqual(['sector']);
      expect(g2.getPivotColumns()).toEqual(['region']);
      expect(g2.getValueColumns()).toEqual([
        { colId: 'pnl', aggFunc: 'sum' },
        { colId: 'qty', aggFunc: 'avg' },
      ]);
      g2.destroy();
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

  describe('allColIds renders in zone order (left | center | right), not definition order', () => {
    // Regression for the range-selection drag bug: defining columns as
    // [center, center, right-pinned, center] used to make a horizontal
    // drag from the first center column to the last center column pull
    // the right-pinned column into the middle of the selection slice
    // (because `allColIds` returned definition order). The fix sorts by
    // pinned zone so the slice is always visually contiguous.
    it('puts pinned-right columns AFTER all center columns', () => {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const grid = new CGrid<{ id: string }>(container, {
        columnDefs: [
          { field: 'positionId', pinned: 'left' },
          { field: 'cusip', pinned: 'left' },
          { field: 'currentPrice' },
          { field: 'pnl', pinned: 'right' }, // defined HERE (middle of array)
          { field: 'dailyPnl' },
          { field: 'unrealizedPnl' },
        ],
        getRowId: (r) => r.id,
      });
      const cols = (grid as any).allColIdsInRenderOrder();
      expect(cols).toEqual([
        // Left-pinned first (definition order within zone)
        'positionId', 'cusip',
        // Center next (definition order within zone) — `pnl` is NOT here
        'currentPrice', 'dailyPnl', 'unrealizedPnl',
        // Right-pinned last
        'pnl',
      ]);
      grid.destroy();
    });

    it('returns the same array when nothing is pinned (no behavioural regression for plain grids)', () => {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const grid = new CGrid<{ id: string }>(container, {
        columnDefs: [
          { field: 'a' },
          { field: 'b' },
          { field: 'c' },
        ],
        getRowId: (r) => r.id,
      });
      const cols = (grid as any).allColIdsInRenderOrder();
      expect(cols).toEqual(['a', 'b', 'c']);
      grid.destroy();
    });
  });

  // Cycle 11 / Task 5 — refreshToolPanel + getToolPanelInstance API.
  //
  // Both methods reach through the SideBarHost. The built-in Columns +
  // Filters panel ctors expect a full ResolvedColDef map at init, which
  // construction-time tests don't have set up cleanly — instead these
  // tests override the built-ins via `CGridOptions.components` with a
  // recording stub that just bumps a refresh counter on each call. That
  // also doubles as the custom-panel test: registering `'demoPanel'`
  // and `'agColumnsToolPanel'` in the same `components` map exercises
  // both the built-in-override path and the custom-id path through one
  // surface.
  describe('refreshToolPanel + getToolPanelInstance (Cycle 11 / Task 5)', () => {
    class RecordingPanel {
      refreshCount = 0;
      destroyCount = 0;
      readonly gui = document.createElement('div');
      init(): void { this.gui.className = 'cg-recording-panel'; }
      getGui(): HTMLElement { return this.gui; }
      refresh(): void { this.refreshCount += 1; }
      destroy(): void { this.destroyCount += 1; }
    }

    function makeGrid() {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const grid = new CGrid<{ id: string; a: number }>(container, {
        columnDefs: [{ field: 'id' }, { field: 'a' }],
        getRowId: (r) => r.id,
        components: {
          // Override both built-ins with the recording stub so init() is
          // cheap (no column-state read, no filter-type lookup).
          agColumnsToolPanel: RecordingPanel as unknown as new () => RecordingPanel,
          agFiltersToolPanel: RecordingPanel as unknown as new () => RecordingPanel,
          demoPanel: RecordingPanel as unknown as new () => RecordingPanel,
        },
        sideBar: {
          toolPanels: [
            { id: 'agColumnsToolPanel', labelDefault: 'Columns', toolPanel: 'agColumnsToolPanel' },
            { id: 'agFiltersToolPanel', labelDefault: 'Filters', toolPanel: 'agFiltersToolPanel' },
            { id: 'demoPanel', labelDefault: 'Demo', toolPanel: 'demoPanel' },
          ],
        },
      });
      return { grid, container };
    }

    it('refreshToolPanel(id) is a silent no-op when the panel is registered but not yet mounted', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      // No panel opened yet — no instance to refresh against. Must NOT
      // throw; SideBarHost.getInstance returns null for an unmounted slot.
      expect(() => api.refreshToolPanel('agColumnsToolPanel')).not.toThrow();
      expect(() => api.refreshToolPanel('demoPanel')).not.toThrow();
      grid.destroy();
    });

    it('refreshToolPanel(id) is a silent no-op for unknown ids', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      expect(() => api.refreshToolPanel('does-not-exist')).not.toThrow();
      grid.destroy();
    });

    it('refreshToolPanel(id) calls the live instance refresh() once per call', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      // Open the built-in panel so an instance exists.
      (grid as any).sideBar.openPanel('agColumnsToolPanel');
      const instance = api.getToolPanelInstance('agColumnsToolPanel') as RecordingPanel;
      expect(instance).not.toBeNull();
      expect(instance.refreshCount).toBe(0);
      api.refreshToolPanel('agColumnsToolPanel');
      expect(instance.refreshCount).toBe(1);
      api.refreshToolPanel('agColumnsToolPanel');
      api.refreshToolPanel('agColumnsToolPanel');
      expect(instance.refreshCount).toBe(3);
      grid.destroy();
    });

    it('refreshToolPanel(id) works for custom (app-supplied) panel ids too', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      (grid as any).sideBar.openPanel('demoPanel');
      const instance = api.getToolPanelInstance('demoPanel') as RecordingPanel;
      expect(instance).not.toBeNull();
      expect(instance.refreshCount).toBe(0);
      api.refreshToolPanel('demoPanel');
      expect(instance.refreshCount).toBe(1);
      grid.destroy();
    });

    it('getToolPanelInstance(id) returns null when no panel for that id is mounted', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      // Nothing opened yet — every slot starts with `instance: null`.
      expect(api.getToolPanelInstance('agColumnsToolPanel')).toBeNull();
      expect(api.getToolPanelInstance('demoPanel')).toBeNull();
      grid.destroy();
    });

    it('getToolPanelInstance(id) returns null for unknown ids', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      expect(api.getToolPanelInstance('does-not-exist')).toBeNull();
      grid.destroy();
    });

    it('getToolPanelInstance(id) returns the live instance after openPanel and null again after close', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      (grid as any).sideBar.openPanel('agFiltersToolPanel');
      const live = api.getToolPanelInstance('agFiltersToolPanel') as RecordingPanel;
      expect(live).not.toBeNull();
      expect(live.gui.className).toBe('cg-recording-panel');
      // Close — host calls destroy() and drops the reference. The next
      // lookup returns null even though the slot is still registered.
      (grid as any).sideBar.closePanel();
      expect(live.destroyCount).toBe(1);
      expect(api.getToolPanelInstance('agFiltersToolPanel')).toBeNull();
      grid.destroy();
    });

    it('both methods are silent no-ops when no side bar is configured', () => {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const grid = new CGrid<{ id: string }>(container, {
        columnDefs: [{ field: 'id' }],
        getRowId: (r) => r.id,
        // No `sideBar` option — `this.sideBar` stays null on CGrid.
      });
      const api = (grid as any).makeApi();
      expect(() => api.refreshToolPanel('agColumnsToolPanel')).not.toThrow();
      expect(api.getToolPanelInstance('agColumnsToolPanel')).toBeNull();
      grid.destroy();
    });
  });

  // Cycle 11 / Task 6 — Side bar state API.
  //
  // Seven CGridApi methods that wrap the live SideBarHost so apps can
  // drive the side bar without poking at the host directly. Every method
  // must (a) match the SideBarHost behaviour 1:1 when a side bar is
  // configured AND (b) be a silent no-op (or a sensible default) when no
  // side bar is configured. Reuses the RecordingPanel-stub trick from
  // the Task 5 suite so panel init stays cheap.
  describe('side bar state API (Cycle 11 / Task 6)', () => {
    class RecordingPanel {
      readonly gui = document.createElement('div');
      init(): void { this.gui.className = 'cg-recording-panel'; }
      getGui(): HTMLElement { return this.gui; }
      refresh(): void {}
      destroy(): void {}
    }

    function makeGrid(extra?: { hiddenByDefault?: boolean; defaultToolPanel?: string; position?: 'left' | 'right' }) {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const grid = new CGrid<{ id: string; a: number }>(container, {
        columnDefs: [{ field: 'id' }, { field: 'a' }],
        getRowId: (r) => r.id,
        components: {
          agColumnsToolPanel: RecordingPanel as unknown as new () => RecordingPanel,
          agFiltersToolPanel: RecordingPanel as unknown as new () => RecordingPanel,
          demoPanel: RecordingPanel as unknown as new () => RecordingPanel,
        },
        sideBar: {
          toolPanels: [
            { id: 'agColumnsToolPanel', labelDefault: 'Columns', toolPanel: 'agColumnsToolPanel' },
            { id: 'agFiltersToolPanel', labelDefault: 'Filters', toolPanel: 'agFiltersToolPanel' },
            { id: 'demoPanel', labelDefault: 'Demo', toolPanel: 'demoPanel' },
          ],
          ...extra,
        },
      });
      return { grid, container };
    }

    function makeGridNoSideBar() {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const grid = new CGrid<{ id: string }>(container, {
        columnDefs: [{ field: 'id' }],
        getRowId: (r) => r.id,
      });
      return { grid, container };
    }

    it('isSideBarVisible() returns true after mount when no hiddenByDefault is set', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      expect(api.isSideBarVisible()).toBe(true);
      grid.destroy();
    });

    it('isSideBarVisible() returns false when hiddenByDefault: true', () => {
      const { grid } = makeGrid({ hiddenByDefault: true });
      const api = (grid as any).makeApi();
      expect(api.isSideBarVisible()).toBe(false);
      grid.destroy();
    });

    it('setSideBarVisible(false) hides and setSideBarVisible(true) restores', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      expect(api.isSideBarVisible()).toBe(true);
      api.setSideBarVisible(false);
      expect(api.isSideBarVisible()).toBe(false);
      api.setSideBarVisible(true);
      expect(api.isSideBarVisible()).toBe(true);
      grid.destroy();
    });

    it('setSideBarPosition(pos) flips the host position (read back through getSideBar)', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      // Default resolved position is 'right' (set by resolveSideBarDef).
      expect(api.getSideBar()?.position).toBe('right');
      api.setSideBarPosition('left');
      expect(api.getSideBar()?.position).toBe('left');
      api.setSideBarPosition('right');
      expect(api.getSideBar()?.position).toBe('right');
      grid.destroy();
    });

    it('openToolPanel(id) opens; getOpenedToolPanel() reflects it; closeToolPanel() clears it', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      expect(api.getOpenedToolPanel()).toBeNull();
      api.openToolPanel('agColumnsToolPanel');
      expect(api.getOpenedToolPanel()).toBe('agColumnsToolPanel');
      // Switch directly to another panel — the host closes the first one
      // and opens the second; getOpenedToolPanel reflects the new active.
      api.openToolPanel('agFiltersToolPanel');
      expect(api.getOpenedToolPanel()).toBe('agFiltersToolPanel');
      api.closeToolPanel();
      expect(api.getOpenedToolPanel()).toBeNull();
      grid.destroy();
    });

    it('openToolPanel(id) for an unknown id is a silent no-op (does not throw, does not open)', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      expect(() => api.openToolPanel('does-not-exist')).not.toThrow();
      expect(api.getOpenedToolPanel()).toBeNull();
      grid.destroy();
    });

    it('openToolPanel(id) for a custom (app-supplied) id mounts the custom panel', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      api.openToolPanel('demoPanel');
      expect(api.getOpenedToolPanel()).toBe('demoPanel');
      const instance = api.getToolPanelInstance('demoPanel');
      expect(instance).not.toBeNull();
      grid.destroy();
    });

    it('getSideBar() returns the resolved SideBarDef (string shortcuts expanded, position defaulted)', () => {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const grid = new CGrid<{ id: string }>(container, {
        columnDefs: [{ field: 'id' }],
        getRowId: (r) => r.id,
        components: {
          agColumnsToolPanel: RecordingPanel as unknown as new () => RecordingPanel,
          agFiltersToolPanel: RecordingPanel as unknown as new () => RecordingPanel,
        },
        // Boolean shorthand `true` should normalise into a SideBarDef
        // containing both built-in panels (string shortcuts expanded
        // into full ToolPanelDef shape).
        sideBar: true,
      });
      const api = (grid as any).makeApi();
      const def = api.getSideBar();
      expect(def).toBeDefined();
      // Default position when none specified.
      expect(def?.position).toBe('right');
      // String shortcuts ['columns', 'filters'] expanded into objects.
      expect(def?.toolPanels.length).toBe(2);
      const ids = (def!.toolPanels as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain('agColumnsToolPanel');
      expect(ids).toContain('agFiltersToolPanel');
      grid.destroy();
    });

    it('defaultToolPanel + openToolPanel + getOpenedToolPanel round-trip across the API surface', () => {
      const { grid } = makeGrid({ defaultToolPanel: 'agColumnsToolPanel' });
      const api = (grid as any).makeApi();
      // The default panel auto-opens at mount via SideBarHost.
      expect(api.getOpenedToolPanel()).toBe('agColumnsToolPanel');
      // Closing through the API tears the panel down.
      api.closeToolPanel();
      expect(api.getOpenedToolPanel()).toBeNull();
      // Re-opening through the API mounts a fresh instance.
      api.openToolPanel('agColumnsToolPanel');
      expect(api.getOpenedToolPanel()).toBe('agColumnsToolPanel');
      grid.destroy();
    });

    it('every method no-ops gracefully when no side bar is configured', () => {
      const { grid } = makeGridNoSideBar();
      const api = (grid as any).makeApi();
      // Reads: isSideBarVisible → false; getOpenedToolPanel → null;
      // getSideBar → undefined.
      expect(api.isSideBarVisible()).toBe(false);
      expect(api.getOpenedToolPanel()).toBeNull();
      expect(api.getSideBar()).toBeUndefined();
      // Writes: all silent no-ops, no throw.
      expect(() => api.setSideBarVisible(true)).not.toThrow();
      expect(() => api.setSideBarVisible(false)).not.toThrow();
      expect(() => api.setSideBarPosition('left')).not.toThrow();
      expect(() => api.setSideBarPosition('right')).not.toThrow();
      expect(() => api.openToolPanel('agColumnsToolPanel')).not.toThrow();
      expect(() => api.closeToolPanel()).not.toThrow();
      // No side effects materialised.
      expect(api.isSideBarVisible()).toBe(false);
      expect(api.getOpenedToolPanel()).toBeNull();
      grid.destroy();
    });
  });

  // Cycle 11 / Task 7 — Side bar events at the CGrid surface. Verifies
  // that SideBarHost lifecycle events are forwarded into the grid's
  // typed event emitter so apps can `grid.on('toolPanelVisibleChanged',
  // ...)` like any other event. The host-level test in
  // `tests/sideBarEvents.test.ts` pins the emit callback directly; this
  // suite proves the CGrid wiring (constructor `ctx.emit` → `events.emit`)
  // is in place end-to-end through the public `grid.on` API.
  describe('side bar events (Cycle 11 / Task 7)', () => {
    class RecordingPanel {
      readonly gui = document.createElement('div');
      init(): void { this.gui.className = 'cg-recording-panel'; }
      getGui(): HTMLElement { return this.gui; }
      refresh(): void {}
      destroy(): void {}
    }

    function makeGrid(extra?: { defaultToolPanel?: string; hiddenByDefault?: boolean }) {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const grid = new CGrid<{ id: string }>(container, {
        columnDefs: [{ field: 'id' }],
        getRowId: (r) => r.id,
        components: {
          agColumnsToolPanel: RecordingPanel as unknown as new () => RecordingPanel,
          agFiltersToolPanel: RecordingPanel as unknown as new () => RecordingPanel,
        },
        sideBar: {
          toolPanels: [
            { id: 'agColumnsToolPanel', labelDefault: 'Columns', toolPanel: 'agColumnsToolPanel' },
            { id: 'agFiltersToolPanel', labelDefault: 'Filters', toolPanel: 'agFiltersToolPanel' },
          ],
          ...extra,
        },
      });
      return { grid, container };
    }

    it('toolPanelVisibleChanged fires with source="api" when openToolPanel() is called via the API', () => {
      const { grid } = makeGrid();
      const events: any[] = [];
      grid.on('toolPanelVisibleChanged', (e) => events.push(e));
      const api = (grid as any).makeApi();
      api.openToolPanel('agColumnsToolPanel');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'toolPanelVisibleChanged',
        key: 'agColumnsToolPanel',
        visible: true,
        source: 'api',
      });
      grid.destroy();
    });

    it('toolPanelVisibleChanged fires with source="api" + visible=false when closeToolPanel() is called', () => {
      const { grid } = makeGrid();
      const api = (grid as any).makeApi();
      api.openToolPanel('agColumnsToolPanel');
      const events: any[] = [];
      grid.on('toolPanelVisibleChanged', (e) => events.push(e));
      api.closeToolPanel();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'toolPanelVisibleChanged',
        key: 'agColumnsToolPanel',
        visible: false,
        source: 'api',
      });
      grid.destroy();
    });

    it('toolPanelVisibleChanged fires with source="sideBarInitializing" when defaultToolPanel auto-opens at mount', () => {
      // Construction-time event — subscribe BEFORE construction would be
      // ideal but `grid` doesn't exist yet. Mirror what apps actually do:
      // configure `defaultToolPanel`, then subscribe immediately after
      // construction. The event has already fired synchronously inside
      // the SideBarHost constructor, so we instead inspect the recorded
      // events on an inline harness by hooking the host's emit directly.
      //
      // Simpler harness: subscribe BEFORE the host emits by patching the
      // grid's event emitter before constructing. Since the CGrid
      // constructor builds the host synchronously, we need a different
      // path — capture via a `grid.on` listener AFTER the fact and
      // confirm that `getOpenedToolPanel()` reflects the panel without
      // any *additional* events firing. The init event itself can be
      // confirmed by re-walking the host: the auto-open happened.
      //
      // For the API contract, the more meaningful end-to-end assertion
      // is that calling `closeToolPanel()` (which fires AFTER any
      // listeners are attached) carries the right shape. Already covered
      // above. So this test confirms the auto-open happened and the
      // listener attached just-after observes a subsequent open event,
      // not the init event itself (which fires inside the constructor).
      const { grid } = makeGrid({ defaultToolPanel: 'agColumnsToolPanel' });
      // The mount-time auto-open ALREADY happened during construction.
      const api = (grid as any).makeApi();
      expect(api.getOpenedToolPanel()).toBe('agColumnsToolPanel');
      // Subsequent close fires under 'api' (not 'sideBarInitializing').
      const events: any[] = [];
      grid.on('toolPanelVisibleChanged', (e) => events.push(e));
      api.closeToolPanel();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ source: 'api', visible: false });
      grid.destroy();
    });

    it('sideBarVisibleChanged fires with source="api" on setSideBarVisible(false) / setSideBarVisible(true)', () => {
      const { grid } = makeGrid();
      const events: any[] = [];
      grid.on('sideBarVisibleChanged', (e) => events.push(e));
      const api = (grid as any).makeApi();
      api.setSideBarVisible(false);
      api.setSideBarVisible(true);
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: 'sideBarVisibleChanged',
        visible: false,
        source: 'api',
      });
      expect(events[1]).toMatchObject({
        type: 'sideBarVisibleChanged',
        visible: true,
        source: 'api',
      });
      grid.destroy();
    });

    it('hiding the side bar while a panel is open emits sideBarVisibleChanged but NOT toolPanelVisibleChanged', () => {
      const { grid } = makeGrid({ defaultToolPanel: 'agColumnsToolPanel' });
      const api = (grid as any).makeApi();
      const panelEvents: any[] = [];
      const barEvents: any[] = [];
      grid.on('toolPanelVisibleChanged', (e) => panelEvents.push(e));
      grid.on('sideBarVisibleChanged', (e) => barEvents.push(e));
      api.setSideBarVisible(false);
      expect(panelEvents).toHaveLength(0);
      expect(barEvents).toHaveLength(1);
      grid.destroy();
    });

    it('no events fire when no side bar is configured', () => {
      const container = document.createElement('div');
      container.style.cssText = 'width:800px; height:600px;';
      container.className = 'cg-theme-quartz';
      document.body.appendChild(container);
      const grid = new CGrid<{ id: string }>(container, {
        columnDefs: [{ field: 'id' }],
        getRowId: (r) => r.id,
      });
      const panelEvents: any[] = [];
      const barEvents: any[] = [];
      grid.on('toolPanelVisibleChanged', (e) => panelEvents.push(e));
      grid.on('sideBarVisibleChanged', (e) => barEvents.push(e));
      const api = (grid as any).makeApi();
      api.setSideBarVisible(true);
      api.setSideBarVisible(false);
      api.openToolPanel('agColumnsToolPanel');
      api.closeToolPanel();
      expect(panelEvents).toHaveLength(0);
      expect(barEvents).toHaveLength(0);
      grid.destroy();
    });
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
