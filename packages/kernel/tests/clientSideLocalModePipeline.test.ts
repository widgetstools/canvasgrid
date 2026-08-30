import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';

/**
 * Client-side grids run the SSRM v2 controller in local mode, so `this.ssrm`
 * is non-null for EVERY grid — the two row models share one code path.
 *
 * That breaks the old `this.ssrm != null` ⇒ "is SSRM" shorthand, and several
 * call sites used exactly that shorthand to gate real behaviour. The worst is
 * the client-pipeline disable path: reached from the grouping seam and from
 * setPivotMode, it would flip the worker's `ssrmClientPipeline` off, sending
 * `buildVisibleAsync` down the sparse branch to return an `ssrmOrder` local
 * mode never populates — i.e. a client-side grid painting ZERO rows the first
 * time grouping is cleared or pivot is toggled.
 *
 * These are the regression tests for that class of bug. They deliberately
 * drive the real worker round-trip rather than asserting on internals: the
 * symptom is "rows disappear", so that is what is asserted.
 */

beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(_d?: string) {}
    };
  }
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: Record<string, unknown> = {
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
    return () => fakeCtx as CanvasRenderingContext2D;
  })() as typeof HTMLCanvasElement.prototype.getContext;
});

interface Row { id: string; desk: string; pnl: number }

const ROWS: Row[] = [
  { id: 'a', desk: 'Rates', pnl: 10 },
  { id: 'b', desk: 'Rates', pnl: 20 },
  { id: 'c', desk: 'Credit', pnl: 30 },
  { id: 'd', desk: 'Credit', pnl: 40 },
];

const COLS = [
  { field: 'desk' },
  { field: 'pnl', type: 'number', aggFunc: 'sum' },
];

function buildWiredGrid() {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const prevWorker = (globalThis as { Worker?: unknown }).Worker;
  (globalThis as { Worker?: unknown }).Worker = class {
    listeners: Array<(e: { data: unknown }) => void> = [];
    host = createWorkerHost((msg) => {
      queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
    });
    constructor(public url: URL) {}
    postMessage(msg: unknown) { this.host.handle(msg as Parameters<typeof this.host.handle>[0]); }
    addEventListener(_: string, cb: (e: { data: unknown }) => void) { this.listeners.push(cb); }
    terminate() {}
  };
  // No rowModelType — the default clientSide path, which is what mounts the
  // controller in local mode.
  const grid = new VelocityGrid<Row>(container, {
    columnDefs: COLS as Parameters<typeof VelocityGrid<Row>>[1]['columnDefs'],
    getRowId: (r) => r.id,
    rowData: ROWS,
  });
  const restore = () => {
    grid.destroy();
    (globalThis as { Worker?: unknown }).Worker = prevWorker;
    container.remove();
  };
  return { grid, restore };
}

const settle = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('clientSide local mode — pipeline stays on', () => {
  it('mounts the SSRM controller in local mode for a default (clientSide) grid', async () => {
    const { grid, restore } = buildWiredGrid();
    await grid.whenReady();
    const internal = grid as unknown as {
      ssrm: { isLocalMode(): boolean } | null;
      ssrmClientPipeline: boolean;
    };
    expect(internal.ssrm).not.toBeNull();
    expect(internal.ssrm!.isLocalMode()).toBe(true);
    // Main-thread mirror must be seeded at mount, not after a round trip.
    expect(internal.ssrmClientPipeline).toBe(true);
    restore();
  });

  it('setRowData still populates a clientSide grid (gate is rowModelType, not this.ssrm)', async () => {
    const { grid, restore } = buildWiredGrid();
    await grid.whenReady();
    await settle();
    expect(grid.getDisplayedRowCount()).toBe(ROWS.length);

    grid.setRowData([...ROWS, { id: 'e', desk: 'FX', pnl: 50 }]);
    await settle();
    expect(grid.getDisplayedRowCount()).toBe(5);
    restore();
  });

  it('rows survive setting row groups and then CLEARING them (the showstopper)', async () => {
    const { grid, restore } = buildWiredGrid();
    await grid.whenReady();
    await settle();
    const flatCount = grid.getDisplayedRowCount();
    expect(flatCount).toBe(ROWS.length);

    grid.setRowGroupColumns(['desk']);
    await settle();
    // 2 group rows + 4 leaves when expanded; the exact number depends on
    // default expansion — all that matters is the grid is not empty.
    expect(grid.getDisplayedRowCount()).toBeGreaterThan(0);

    // The regression: clearing groups routes through
    // disableSsrmClientPipelineIfIdle → disableSsrmClientPipeline, which
    // without its rowModelType guard would turn the worker pipeline off and
    // leave the grid painting zero rows.
    grid.setRowGroupColumns([]);
    await settle();
    expect(grid.getDisplayedRowCount()).toBe(flatCount);

    // The pipeline mirror must still read "on". If it flipped off, every
    // main-side `this.ssrm && !this.ssrmClientPipeline` gate would classify
    // this clientSide grid as sparse SSRM.
    expect((grid as unknown as { ssrmClientPipeline: boolean }).ssrmClientPipeline).toBe(true);
    restore();
  });

  it('sort and filter still reach the worker after a grouping round-trip', async () => {
    // Second failure mode of the same bug: with the pipeline mirror flipped
    // off, setSortModel / setFilterModel take the sparse-SSRM branch — they
    // return after a refresh() that local mode no-ops, so sorting and
    // filtering silently stop working instead of blanking the grid.
    const { grid, restore } = buildWiredGrid();
    await grid.whenReady();
    await settle();

    grid.setRowGroupColumns(['desk']);
    await settle();
    grid.setRowGroupColumns([]);
    await settle();

    grid.setSortModel([{ colId: 'pnl', direction: 'desc' }]);
    await settle();
    expect(grid.getDisplayedRowCount()).toBe(ROWS.length);

    grid.setFilterModel({
      pnl: { filterType: 'number', type: 'greaterThan', filter: 15 },
    } as never);
    await settle();
    expect(grid.getDisplayedRowCount()).toBe(3);
    restore();
  });

  it('rows survive toggling pivot mode on and back off', async () => {
    const { grid, restore } = buildWiredGrid();
    await grid.whenReady();
    await settle();
    const flatCount = grid.getDisplayedRowCount();

    grid.setPivotMode(true);
    await settle();
    grid.setPivotMode(false);
    await settle();

    expect(grid.getDisplayedRowCount()).toBe(flatCount);
    restore();
  });

  it('getTotalRowCount stays the UNFILTERED total under an active filter', async () => {
    const { grid, restore } = buildWiredGrid();
    await grid.whenReady();
    await settle();
    expect(grid.getTotalRowCount()).toBe(ROWS.length);

    grid.setFilterModel({ desk: { type: 'equals', filter: 'Rates' } } as never);
    await settle();
    // Displayed shrinks; the pre-filter total must not follow it (gating this
    // on `this.ssrm` would have started returning the filtered count).
    expect(grid.getDisplayedRowCount()).toBeLessThan(ROWS.length);
    expect(grid.getTotalRowCount()).toBe(ROWS.length);
    restore();
  });

  it('SSRM-only entry points stay inert on a clientSide grid', async () => {
    const { grid, restore } = buildWiredGrid();
    await grid.whenReady();
    await settle();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = grid.getDisplayedRowCount();

    // Must not reach the local-mode controller, and must not disturb rows.
    grid.refreshServerSide({ purge: true });
    grid.setServerSideDatasource({ getRows: vi.fn() } as never);
    grid.applyServerSideTransaction({ update: [{ id: 'a', desk: 'Rates', pnl: 99 }] } as never);
    await settle();

    expect(grid.getDisplayedRowCount()).toBe(before);
    warn.mockRestore();
    restore();
  });
});
