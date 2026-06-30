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
