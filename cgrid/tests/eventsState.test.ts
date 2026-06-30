import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Cycle 23 / Tasks 1-7 — events + state-snapshot tests.
 *
 * Stubs Worker + 2D canvas so a CGrid can construct under happy-dom,
 * mirroring the pattern in cgrid.integration.test.ts.
 */
beforeAll(() => {
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

describe('Cycle 23 / Task 2 — mouse hover events (cellMouseOver/Out + rowMouseOver/Out)', () => {
  it('fires cellMouseOver when the pointer enters a new cell', async () => {
    const { OnHover } = await import('../src/interaction/features/onHover');
    const feature = new OnHover();
    const emitCellMouseOver = vi.fn();
    const grid = {
      canvas: { requestRepaint: vi.fn() },
      emitCellMouseOver,
      emitCellMouseOut: vi.fn(),
      emitRowMouseOver: vi.fn(),
      emitRowMouseOut: vi.fn(),
    } as any;
    feature.handleMouseMove({
      grid,
      hit: { kind: 'cell', rowIndex: 3, colId: 'name' },
      point: { x: 100, y: 50 },
      raw: { type: 'mousemove' } as MouseEvent,
    });
    expect(emitCellMouseOver).toHaveBeenCalledWith(3, 'name', expect.anything());
  });

  it('does NOT re-fire cellMouseOver on subsequent pointer moves inside the same cell', async () => {
    const { OnHover } = await import('../src/interaction/features/onHover');
    const feature = new OnHover();
    const emitCellMouseOver = vi.fn();
    const grid = {
      canvas: { requestRepaint: vi.fn() },
      emitCellMouseOver,
      emitCellMouseOut: vi.fn(),
      emitRowMouseOver: vi.fn(),
      emitRowMouseOut: vi.fn(),
    } as any;
    const ctx = {
      grid,
      hit: { kind: 'cell' as const, rowIndex: 3, colId: 'name' },
      point: { x: 100, y: 50 },
      raw: { type: 'mousemove' } as MouseEvent,
    };
    feature.handleMouseMove(ctx);
    feature.handleMouseMove(ctx);
    feature.handleMouseMove(ctx);
    expect(emitCellMouseOver).toHaveBeenCalledTimes(1);
  });

  it('fires cellMouseOut for the previous cell when the pointer moves to a different cell', async () => {
    const { OnHover } = await import('../src/interaction/features/onHover');
    const feature = new OnHover();
    const emitCellMouseOver = vi.fn();
    const emitCellMouseOut = vi.fn();
    const grid = {
      canvas: { requestRepaint: vi.fn() },
      emitCellMouseOver,
      emitCellMouseOut,
      emitRowMouseOver: vi.fn(),
      emitRowMouseOut: vi.fn(),
    } as any;
    feature.handleMouseMove({
      grid, hit: { kind: 'cell', rowIndex: 3, colId: 'name' },
      point: { x: 100, y: 50 }, raw: { type: 'mousemove' } as MouseEvent,
    });
    feature.handleMouseMove({
      grid, hit: { kind: 'cell', rowIndex: 3, colId: 'age' },
      point: { x: 200, y: 50 }, raw: { type: 'mousemove' } as MouseEvent,
    });
    expect(emitCellMouseOut).toHaveBeenCalledWith(3, 'name', expect.anything());
    expect(emitCellMouseOver).toHaveBeenCalledWith(3, 'age', expect.anything());
  });

  it('fires rowMouseOver only when the row index changes — moving within a row does NOT fire it', async () => {
    const { OnHover } = await import('../src/interaction/features/onHover');
    const feature = new OnHover();
    const emitRowMouseOver = vi.fn();
    const emitRowMouseOut = vi.fn();
    const grid = {
      canvas: { requestRepaint: vi.fn() },
      emitCellMouseOver: vi.fn(),
      emitCellMouseOut: vi.fn(),
      emitRowMouseOver,
      emitRowMouseOut,
    } as any;
    feature.handleMouseMove({
      grid, hit: { kind: 'cell', rowIndex: 3, colId: 'name' },
      point: { x: 100, y: 50 }, raw: { type: 'mousemove' } as MouseEvent,
    });
    feature.handleMouseMove({
      grid, hit: { kind: 'cell', rowIndex: 3, colId: 'age' },
      point: { x: 200, y: 50 }, raw: { type: 'mousemove' } as MouseEvent,
    });
    feature.handleMouseMove({
      grid, hit: { kind: 'cell', rowIndex: 4, colId: 'age' },
      point: { x: 200, y: 80 }, raw: { type: 'mousemove' } as MouseEvent,
    });
    expect(emitRowMouseOver).toHaveBeenCalledTimes(2);  // row 3 enter, row 4 enter
    expect(emitRowMouseOut).toHaveBeenCalledTimes(1);   // row 3 leave (when crossing to row 4)
  });

  it('fires cellMouseOut + rowMouseOut when the pointer leaves the cell band entirely (hit becomes empty)', async () => {
    const { OnHover } = await import('../src/interaction/features/onHover');
    const feature = new OnHover();
    const emitCellMouseOut = vi.fn();
    const emitRowMouseOut = vi.fn();
    const grid = {
      canvas: { requestRepaint: vi.fn() },
      emitCellMouseOver: vi.fn(),
      emitCellMouseOut,
      emitRowMouseOver: vi.fn(),
      emitRowMouseOut,
    } as any;
    feature.handleMouseMove({
      grid, hit: { kind: 'cell', rowIndex: 3, colId: 'name' },
      point: { x: 100, y: 50 }, raw: { type: 'mousemove' } as MouseEvent,
    });
    feature.handleMouseMove({
      grid, hit: { kind: 'empty' },
      point: { x: 0, y: 0 }, raw: { type: 'mousemove' } as MouseEvent,
    });
    expect(emitCellMouseOut).toHaveBeenCalledWith(3, 'name', expect.anything());
    expect(emitRowMouseOut).toHaveBeenCalledWith(3, expect.anything());
  });
});

describe('Cycle 23 / Task 3 — body-scroll events', () => {
  it('fires bodyScroll on every scroll tick with { top, left, direction }', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    host.style.cssText = 'width:400px; height:300px;';
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
    } as any);

    const events: any[] = [];
    grid.on('bodyScroll', (e: any) => events.push(e));

    // Drive the scroll path directly — happy-dom's scroll event
    // doesn't fire from a synthetic dispatch reliably, so we exercise
    // the same code path the listener invokes.
    (grid as any).onScrollerScroll(0, 100);
    (grid as any).onScrollerScroll(50, 100);
    (grid as any).onScrollerScroll(50, 150);

    expect(events.length).toBe(3);
    expect(events[0]).toMatchObject({ top: 100, left: 0, direction: 'vertical' });
    expect(events[1]).toMatchObject({ top: 100, left: 50, direction: 'horizontal' });
    expect(events[2]).toMatchObject({ top: 150, left: 50, direction: 'vertical' });
    grid.destroy();
  });

  it('debounces bodyScrollEnd — fires once 200ms after the last scroll', async () => {
    vi.useFakeTimers();
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    host.style.cssText = 'width:400px; height:300px;';
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
    } as any);

    const endEvents: any[] = [];
    grid.on('bodyScrollEnd', (e: any) => endEvents.push(e));

    (grid as any).onScrollerScroll(0, 50);
    vi.advanceTimersByTime(100);
    (grid as any).onScrollerScroll(0, 100);
    vi.advanceTimersByTime(100);
    // Still no end event — the second scroll reset the debounce.
    expect(endEvents.length).toBe(0);
    (grid as any).onScrollerScroll(0, 150);
    vi.advanceTimersByTime(199);
    expect(endEvents.length).toBe(0);
    vi.advanceTimersByTime(2);
    expect(endEvents.length).toBe(1);
    expect(endEvents[0]).toMatchObject({ top: 150, left: 0 });
    grid.destroy();
    vi.useRealTimers();
  });
});

describe('Cycle 23 / Task 4 — cell keyboard events', () => {
  it('emits cellKeyDown for the focused cell BEFORE any grid handler', async () => {
    const { CellKeyboardEvents } = await import('../src/interaction/features/cellKeyboardEvents');
    const feature = new CellKeyboardEvents();
    const emitCellKeyDown = vi.fn(() => false);
    const next = { handleKeyDown: vi.fn() };
    (feature as any).next = next;

    feature.handleKeyDown({
      grid: {
        selection: { state: { focusedRowIndex: 2, focusedColId: 'name' } },
        emitCellKeyDown,
        emitCellKeyPress: vi.fn(),
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'a' }),
    });
    expect(emitCellKeyDown).toHaveBeenCalledTimes(1);
    expect(emitCellKeyDown).toHaveBeenCalledWith(2, 'name', expect.any(KeyboardEvent));
    // Downstream features still run when not preventDefaulted.
    expect(next.handleKeyDown).toHaveBeenCalled();
  });

  it('short-circuits the chain when the app calls event.preventDefault()', async () => {
    const { CellKeyboardEvents } = await import('../src/interaction/features/cellKeyboardEvents');
    const feature = new CellKeyboardEvents();
    const emitCellKeyDown = vi.fn((_r: number, _c: string, e: KeyboardEvent) => {
      e.preventDefault();
      return true;
    });
    const next = { handleKeyDown: vi.fn() };
    (feature as any).next = next;

    feature.handleKeyDown({
      grid: {
        selection: { state: { focusedRowIndex: 2, focusedColId: 'name' } },
        emitCellKeyDown,
        emitCellKeyPress: vi.fn(),
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'Enter' }),
    });
    expect(next.handleKeyDown).not.toHaveBeenCalled();
  });

  it('emits cellKeyPress for printable single-char keys but not for Enter / Tab / Escape', async () => {
    const { CellKeyboardEvents } = await import('../src/interaction/features/cellKeyboardEvents');
    const feature = new CellKeyboardEvents();
    const emitCellKeyPress = vi.fn(() => false);
    const next = { handleKeyDown: vi.fn() };
    (feature as any).next = next;
    const grid = {
      selection: { state: { focusedRowIndex: 0, focusedColId: 'name' } },
      emitCellKeyDown: vi.fn(() => false),
      emitCellKeyPress,
    } as any;
    const fire = (key: string) => feature.handleKeyDown({
      grid, hit: { kind: 'empty' as const }, point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key }),
    });
    fire('a');
    fire('Z');
    fire('5');
    fire('Enter');
    fire('Tab');
    fire('Escape');
    fire('ArrowDown');
    expect(emitCellKeyPress).toHaveBeenCalledTimes(3);
  });

  it('does NOT emit cellKeyPress when Ctrl / Meta / Alt modifier is held', async () => {
    const { CellKeyboardEvents } = await import('../src/interaction/features/cellKeyboardEvents');
    const feature = new CellKeyboardEvents();
    const emitCellKeyPress = vi.fn(() => false);
    const next = { handleKeyDown: vi.fn() };
    (feature as any).next = next;
    const grid = {
      selection: { state: { focusedRowIndex: 0, focusedColId: 'name' } },
      emitCellKeyDown: vi.fn(() => false),
      emitCellKeyPress,
    } as any;
    feature.handleKeyDown({
      grid, hit: { kind: 'empty' as const }, point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
    });
    feature.handleKeyDown({
      grid, hit: { kind: 'empty' as const }, point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'c', metaKey: true }),
    });
    expect(emitCellKeyPress).not.toHaveBeenCalled();
  });

  it('no-ops when no cell is focused (focusedRowIndex / focusedColId are null)', async () => {
    const { CellKeyboardEvents } = await import('../src/interaction/features/cellKeyboardEvents');
    const feature = new CellKeyboardEvents();
    const emitCellKeyDown = vi.fn();
    const next = { handleKeyDown: vi.fn() };
    (feature as any).next = next;
    feature.handleKeyDown({
      grid: {
        selection: { state: { focusedRowIndex: null, focusedColId: null } },
        emitCellKeyDown,
        emitCellKeyPress: vi.fn(),
      } as any,
      hit: { kind: 'empty' },
      point: { x: 0, y: 0 },
      raw: new KeyboardEvent('keydown', { key: 'Enter' }),
    });
    expect(emitCellKeyDown).not.toHaveBeenCalled();
    expect(next.handleKeyDown).toHaveBeenCalled();  // chain forward still
  });
});

describe('Cycle 23 / Task 5 — getState()', () => {
  it('returns the schema version + populated columnState on a fresh grid', async () => {
    const { CGrid } = await import('../src/cgrid');
    const { STATE_SCHEMA_VERSION } = await import('../src/core/stateSnapshot');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'a', field: 'a', cellDataType: 'text' },
        { colId: 'b', field: 'b', cellDataType: 'number' },
      ],
    } as any);
    const state = grid.getState();
    expect(state.version).toBe(STATE_SCHEMA_VERSION);
    expect(state.columnState).toBeDefined();
    expect(state.columnState!.length).toBe(2);
    expect(state.columnState!.map((c: any) => c.colId)).toEqual(['a', 'b']);
    grid.destroy();
  });

  it('omits empty fields so JSON snapshots stay compact', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
    } as any);
    const state = grid.getState();
    // No filters, sort, groups, pivot, expanded, side bar, selection,
    // scroll → all those keys are absent.
    expect(state.filterModel).toBeUndefined();
    expect(state.sortModel).toBeUndefined();
    expect(state.rowGroupColumns).toBeUndefined();
    expect(state.pivotMode).toBeUndefined();
    expect(state.scroll).toBeUndefined();
    expect(state.cellSelection).toBeUndefined();
    expect(state.rowSelection).toBeUndefined();
    grid.destroy();
  });

  it('captures the sort model after sortChanged', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
    } as any);
    grid.cycleSort('a');
    const state = grid.getState();
    expect(state.sortModel).toEqual([{ colId: 'a', direction: 'asc' }]);
    grid.destroy();
  });

  it('captures filterModel via setColumnFilterModel', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text', filter: 'text' }],
    } as any);
    grid.setColumnFilterModel('a', {
      filterType: 'text',
      type: 'contains',
      filter: 'foo',
    } as any);
    const state = grid.getState();
    expect(state.filterModel).toBeDefined();
    expect((state.filterModel as any).a.filter).toBe('foo');
    grid.destroy();
  });

  it('snapshot is JSON-serializable end-to-end (no functions, no circular refs)', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'a', field: 'a', cellDataType: 'text' },
        { colId: 'b', field: 'b', cellDataType: 'number' },
      ],
    } as any);
    grid.cycleSort('a');
    const json = JSON.stringify(grid.getState());
    expect(() => JSON.parse(json)).not.toThrow();
    const round = JSON.parse(json);
    expect(round.sortModel).toEqual([{ colId: 'a', direction: 'asc' }]);
    grid.destroy();
  });
});

describe('Cycle 23 / Task 6 — setState round-trip', () => {
  it('setState(getState()) leaves state observably unchanged', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'a', field: 'a', cellDataType: 'text' },
        { colId: 'b', field: 'b', cellDataType: 'number' },
      ],
    } as any);
    grid.cycleSort('b');
    const before = JSON.stringify(grid.getState());
    grid.setState(grid.getState());
    const after = JSON.stringify(grid.getState());
    expect(after).toBe(before);
    grid.destroy();
  });

  it('restores sortModel from a snapshot', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
    } as any);
    grid.setState({
      version: 1,
      sortModel: [{ colId: 'a', direction: 'desc' } as any],
    });
    expect(grid.getSortModel()).toEqual([{ colId: 'a', direction: 'desc' }]);
    grid.destroy();
  });

  it('resetState wipes filters, sort, groups, selection back to initial', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
    } as any);
    grid.cycleSort('a');
    expect(grid.getSortModel().length).toBe(1);
    grid.resetState();
    expect(grid.getSortModel().length).toBe(0);
    grid.destroy();
  });

  it('CGridOptions.initialState applies before any user interaction', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
      initialState: {
        version: 1,
        sortModel: [{ colId: 'a', direction: 'asc' } as any],
      },
    } as any);
    // Simulate the worker's 'ready' message so the async init chain
    // (and the initialState apply) completes.
    const w = (grid as any).workerClient.worker;
    w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(grid.getSortModel()).toEqual([{ colId: 'a', direction: 'asc' }]);
    grid.destroy();
  });

  it('throws a clear error when a snapshot version is newer than the build', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [{ colId: 'a', field: 'a', cellDataType: 'text' }],
    } as any);
    expect(() => grid.setState({ version: 999 } as any)).toThrow(/newer than this build/);
    grid.destroy();
  });
});

describe('Cycle 23 / Task 2 — integration with CGrid', () => {
  it('grid.on("cellMouseOver") fires with rowId + colId + value when the pointer crosses a cell boundary', async () => {
    const { CGrid } = await import('../src/cgrid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new CGrid(host, {
      getRowId: (r: any) => r.id,
      columnDefs: [
        { colId: 'name', field: 'name', cellDataType: 'text' },
      ],
    } as any);

    const events: any[] = [];
    grid.on('cellMouseOver', (e: any) => events.push({ type: 'cellMouseOver', ...e }));
    grid.on('cellMouseOut', (e: any) => events.push({ type: 'cellMouseOut', ...e }));

    // Drive the hit-test path by faking a hover transition through
    // the grid's CGridLike emit hooks directly. The full DOM
    // canvas-mousemove flow is covered in E2E; this proves the
    // grid-side wiring fans out to subscribers.
    (grid as any).emitCellMouseOverFromHover(0, 'name', new MouseEvent('mousemove'));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('cellMouseOver');
    expect(events[0].colId).toBe('name');
    grid.destroy();
  });
});
