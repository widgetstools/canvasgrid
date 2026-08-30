import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';

/**
 * `setPivotMode` gating on SSRM, plus the grouping combination that used to
 * produce wrong numbers.
 *
 * Pivot on SSRM has two legitimate sources: PivotPass over a fully hydrated
 * book (client pipeline), or a datasource that pivots natively and pushes a
 * cross-tab. Everywhere neither is available it must refuse LOUDLY and leave
 * the UI truthful — the columns tool panel flips its toggle optimistically
 * and only a `pivotStateChanged` event can correct it.
 */

beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class { constructor(_d?: string) {} };
  }
  HTMLCanvasElement.prototype.getContext = (() => {
    const ctx: Record<string, unknown> = {
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
    return () => ctx as CanvasRenderingContext2D;
  })() as typeof HTMLCanvasElement.prototype.getContext;
});

interface Row { id: string; desk: string; region: string; pnl: number }

const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Skeleton-capable datasource — grouping is served natively (sparse). */
function skeletonDatasource() {
  return {
    getRows: vi.fn(),
    getGroupSkeleton: vi.fn((params: { success: (r: unknown) => void }) => {
      params.success({ groups: [{ path: ['Rates'], leafCount: 1, aggregates: { pnl: 10 } }] });
    }),
    getLeafRows: vi.fn((params: { success: (r: unknown) => void }) => {
      params.success({ rowData: [{ id: 'a', desk: 'Rates', region: 'EMEA', pnl: 10 }] });
    }),
  };
}

/** Flat datasource — no skeleton, so grouping goes through a full hydrate. */
function flatDatasource() {
  return {
    getRows: vi.fn((params: { success: (r: unknown) => void }) => {
      params.success({
        rowData: [{ id: 'a', desk: 'Rates', region: 'EMEA', pnl: 10 }],
        rowCount: 1,
      });
    }),
  };
}

function buildGrid(opts: Record<string, unknown>) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  document.body.appendChild(container);
  const prev = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = class {
    listeners: Array<(e: { data: unknown }) => void> = [];
    host = createWorkerHost((msg) => {
      queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
    });
    constructor(public url: URL) {}
    postMessage(m: unknown) { this.host.handle(m as Parameters<typeof this.host.handle>[0]); }
    addEventListener(_: string, cb: (e: { data: unknown }) => void) { this.listeners.push(cb); }
    terminate() {}
  };
  const grid = new VelocityGrid<Row>(container, {
    rowModelType: 'serverSide',
    columnDefs: [
      { field: 'desk' }, { field: 'region' },
      { field: 'pnl', type: 'number', aggFunc: 'sum' },
    ] as never,
    getRowId: (r) => r.id,
    ...opts,
  } as never);
  return {
    grid,
    restore: () => {
      grid.destroy();
      container.remove();
      (globalThis as { Worker?: unknown }).Worker = prev;
    },
  };
}

describe('SSRM pivot gating', () => {
  it('honours serverSideEnableClientSidePipeline:false instead of downloading the book', async () => {
    // The opt-out means "never hydrate the whole book". Pivot used to ignore
    // it and full-hydrate anyway for any non-Perspective datasource.
    const ds = flatDatasource();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { grid, restore } = buildGrid({
      serverSideDatasource: ds,
      serverSideEnableClientSidePipeline: false,
    });
    await grid.whenReady();
    await settle();
    ds.getRows.mockClear();

    grid.setPivotMode(true);
    await settle(200);

    expect(grid.isPivotMode()).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('refusing to hydrate the full book'));
    warn.mockRestore();
    restore();
  });

  it('emits pivotStateChanged on refusal so an optimistic toggle snaps back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { grid, restore } = buildGrid({
      serverSideDatasource: flatDatasource(),
      serverSideEnableClientSidePipeline: false,
    });
    await grid.whenReady();
    await settle();

    const events: Array<{ pivotMode: boolean }> = [];
    grid.on('pivotStateChanged', (e) => events.push(e as { pivotMode: boolean }));

    grid.setPivotMode(true);
    await settle(200);

    // Without this event the columns panel's optimistic `aria-pressed=true`
    // is never corrected and the toggle reads ON over an unpivoted grid.
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]!.pivotMode).toBe(false);
    warn.mockRestore();
    restore();
  });

  it('accepts pivot without hydrating once the host declares a cross-tab', async () => {
    const ds = skeletonDatasource();
    const { grid, restore } = buildGrid({
      serverSideDatasource: ds,
      serverSideEnableClientSidePipeline: false,
    });
    await grid.whenReady();
    await settle();

    // The datasource announces it can pivot natively.
    grid.setServerSidePivotResult({
      keyTree: [{ value: 'EMEA', path: ['EMEA'], children: [] }],
      leafPaths: [['EMEA']],
      values: new Map(),
    });
    await settle();

    grid.setPivotMode(true);
    await settle(200);

    // Accepted — and crucially without a full hydrate.
    expect(grid.isPivotMode()).toBe(true);
    expect((grid as unknown as { ssrmClientPipeline: boolean }).ssrmClientPipeline).toBe(false);
    restore();
  });

  it('refuses grouping while the client pipeline is on with a skeleton datasource', async () => {
    // Both would write to the same worker store: the hydrated book AND the
    // sparse skeleton's meta rows / partial leaves. Aggregates would silently
    // count meta rows and miss unfetched leaves.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { grid, restore } = buildGrid({
      serverSideDatasource: skeletonDatasource(),
      serverSideEnableClientSidePipeline: true,
    });
    await grid.whenReady();
    await settle();

    const internal = grid as unknown as { ssrmClientPipeline: boolean; ssrmV2: boolean };
    expect(internal.ssrmV2).toBe(true);
    internal.ssrmClientPipeline = true;

    grid.setRowGroupColumns(['desk']);
    await settle(200);

    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('row grouping is not supported while the client pipeline is'),
    );
    err.mockRestore();
    restore();
  });

  it('rejects setServerSidePivotResult on a clientSide grid', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const prev = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = class {
      listeners: Array<(e: { data: unknown }) => void> = [];
      host = createWorkerHost((msg) => {
        queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
      });
      constructor(public url: URL) {}
      postMessage(m: unknown) { this.host.handle(m as Parameters<typeof this.host.handle>[0]); }
      addEventListener(_: string, cb: (e: { data: unknown }) => void) { this.listeners.push(cb); }
      terminate() {}
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grid = new VelocityGrid<Row>(container, {
      columnDefs: [{ field: 'desk' }] as never,
      getRowId: (r) => r.id,
    } as never);
    await grid.whenReady();

    grid.setServerSidePivotResult({ keyTree: [], leafPaths: [], values: new Map() });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('requires rowModelType'));

    warn.mockRestore();
    grid.destroy();
    container.remove();
    (globalThis as { Worker?: unknown }).Worker = prev;
  });
});
