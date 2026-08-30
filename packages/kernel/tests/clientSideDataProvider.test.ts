import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import type {
  IClientSideDataProvider,
  IClientSideDataProviderDelta,
} from '../src/types/clientSideDataProvider';

/**
 * `clientSideDataProvider` — the CSRM counterpart to `serverSideDatasource`.
 *
 * The grid owns the subscription for its lifetime, so the contract worth
 * pinning is lifecycle: install before/after ready, replace, and above all
 * teardown — the grid must unsubscribe WITHOUT destroying the provider,
 * because one provider commonly feeds several grids.
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

interface Row { id: string; v: number }

const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Multi-subscriber fake. Set-backed on purpose: the shared-provider test
 * needs two grids subscribed at once, which a single-slot fake cannot express.
 * Deliberately has NO `destroy` — if the grid ever reached for one, it would
 * throw rather than silently pass.
 */
function makeProvider(initial: Row[] = []) {
  const snapshotHandlers = new Set<(rows: readonly Row[]) => void>();
  const deltaHandlers = new Set<(d: IClientSideDataProviderDelta<Row>) => void>();
  let rows: Row[] = [...initial];
  return {
    provider: {
      getSnapshot: () => rows,
      onSnapshot(h) { snapshotHandlers.add(h); return () => snapshotHandlers.delete(h); },
      onDelta(h) { deltaHandlers.add(h); return () => deltaHandlers.delete(h); },
    } satisfies IClientSideDataProvider<Row>,
    emitSnapshot(next: Row[]) {
      rows = [...next];
      for (const h of snapshotHandlers) h(rows);
    },
    emitDelta(d: IClientSideDataProviderDelta<Row>) {
      for (const h of deltaHandlers) h(d);
    },
    subscriberCount: () => snapshotHandlers.size + deltaHandlers.size,
  };
}

/** Snapshot-only provider — exercises the optional-`onDelta` branch. */
function makeSnapshotOnlyProvider(initial: Row[] = []) {
  const handlers = new Set<(rows: readonly Row[]) => void>();
  let rows: Row[] = [...initial];
  return {
    provider: {
      getSnapshot: () => rows,
      onSnapshot(h) { handlers.add(h); return () => handlers.delete(h); },
    } satisfies IClientSideDataProvider<Row>,
    emitSnapshot(next: Row[]) {
      rows = [...next];
      for (const h of handlers) h(rows);
    },
  };
}

function installFakeWorker() {
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
  return () => { (globalThis as { Worker?: unknown }).Worker = prevWorker; };
}

function buildGrid(opts: Record<string, unknown> = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const grid = new VelocityGrid<Row>(container, {
    columnDefs: [{ field: 'id' }, { field: 'v', type: 'number' }] as never,
    getRowId: (r) => r.id,
    ...opts,
  } as never);
  return { grid, container };
}

describe('clientSideDataProvider', () => {
  it('paints the provider\'s existing rows on install (warm attach)', async () => {
    const restoreWorker = installFakeWorker();
    const { provider } = makeProvider([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
    const { grid, container } = buildGrid({ clientSideDataProvider: provider });
    await grid.whenReady();
    await settle();

    expect(grid.getDisplayedRowCount()).toBe(2);
    grid.destroy(); container.remove(); restoreWorker();
  });

  it('full-replaces on snapshot and applies add / update / removeIds deltas', async () => {
    const restoreWorker = installFakeWorker();
    const p = makeProvider();
    const { grid, container } = buildGrid({ clientSideDataProvider: p.provider });
    await grid.whenReady();
    await settle();

    p.emitSnapshot([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
    await settle();
    expect(grid.getDisplayedRowCount()).toBe(2);

    // Deltas go through applyTransactionAsync, so each one is subject to the
    // grid's own debounce + 200ms inter-flush throttle — that reuse is the
    // point of the design, so wait it out rather than disabling it.
    const settleDelta = (): Promise<void> => settle(320);

    p.emitDelta({ add: [{ id: 'c', v: 3 }] });
    await settleDelta();
    expect(grid.getDisplayedRowCount()).toBe(3);

    p.emitDelta({ update: [{ id: 'a', v: 99 }] });
    await settleDelta();
    expect(grid.getDisplayedRowCount()).toBe(3);

    // removeIds is the ID domain, resolved against the grid's own mirror.
    p.emitDelta({ removeIds: ['b'] });
    await settleDelta();
    expect(grid.getDisplayedRowCount()).toBe(2);

    // A snapshot after deltas replaces wholesale, it does not merge.
    p.emitSnapshot([{ id: 'z', v: 0 }]);
    await settle();
    expect(grid.getDisplayedRowCount()).toBe(1);

    grid.destroy(); container.remove(); restoreWorker();
  });

  it('ignores unknown removeIds instead of throwing', async () => {
    const restoreWorker = installFakeWorker();
    const p = makeProvider([{ id: 'a', v: 1 }]);
    const { grid, container } = buildGrid({ clientSideDataProvider: p.provider });
    await grid.whenReady();
    await settle();

    p.emitDelta({ removeIds: ['never-seen', 'a'] });
    await settle(320);
    expect(grid.getDisplayedRowCount()).toBe(0);

    grid.destroy(); container.remove(); restoreWorker();
  });

  it('works with a snapshot-only provider (no onDelta)', async () => {
    const restoreWorker = installFakeWorker();
    const p = makeSnapshotOnlyProvider([{ id: 'a', v: 1 }]);
    const { grid, container } = buildGrid({ clientSideDataProvider: p.provider });
    await grid.whenReady();
    await settle();
    expect(grid.getDisplayedRowCount()).toBe(1);

    p.emitSnapshot([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
    await settle();
    expect(grid.getDisplayedRowCount()).toBe(2);

    grid.destroy(); container.remove(); restoreWorker();
  });

  it('a provider set before ready is deferred, then installed', async () => {
    const restoreWorker = installFakeWorker();
    const p = makeProvider([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
    const { grid, container } = buildGrid();

    // Synchronously after construction — async init has not run yet.
    grid.setClientSideDataProvider(p.provider);
    const internal = grid as unknown as { pendingClientSideDataProvider: unknown };
    expect(internal.pendingClientSideDataProvider).toBe(p.provider);

    await grid.whenReady();
    await settle();
    expect(internal.pendingClientSideDataProvider).toBeUndefined();
    expect(grid.getDisplayedRowCount()).toBe(2);

    grid.destroy(); container.remove(); restoreWorker();
  });

  it('a live provider supersedes a static rowData option', async () => {
    const restoreWorker = installFakeWorker();
    const p = makeProvider([{ id: 'p1', v: 1 }, { id: 'p2', v: 2 }, { id: 'p3', v: 3 }]);
    const { grid, container } = buildGrid({
      rowData: [{ id: 'static', v: 0 }],
      clientSideDataProvider: p.provider,
    });
    await grid.whenReady();
    await settle();

    // Install runs after the rowData seed, so the live source wins.
    expect(grid.getDisplayedRowCount()).toBe(3);
    grid.destroy(); container.remove(); restoreWorker();
  });

  it('replacing a provider detaches the old one; null detaches entirely', async () => {
    const restoreWorker = installFakeWorker();
    const first = makeProvider([{ id: 'a', v: 1 }]);
    const second = makeProvider([{ id: 'x', v: 1 }, { id: 'y', v: 2 }]);
    const { grid, container } = buildGrid({ clientSideDataProvider: first.provider });
    await grid.whenReady();
    await settle();
    expect(first.subscriberCount()).toBeGreaterThan(0);

    grid.setClientSideDataProvider(second.provider);
    await settle();
    expect(first.subscriberCount()).toBe(0);
    expect(grid.getDisplayedRowCount()).toBe(2);

    // The detached provider must no longer reach the grid.
    first.emitSnapshot([{ id: 'ghost', v: 9 }]);
    await settle();
    expect(grid.getDisplayedRowCount()).toBe(2);

    grid.setClientSideDataProvider(null);
    await settle();
    expect(second.subscriberCount()).toBe(0);

    grid.destroy(); container.remove(); restoreWorker();
  });

  it('destroy() unsubscribes but never destroys the provider', async () => {
    const restoreWorker = installFakeWorker();
    const p = makeProvider([{ id: 'a', v: 1 }]);
    const { grid, container } = buildGrid({ clientSideDataProvider: p.provider });
    await grid.whenReady();
    await settle();
    expect(p.subscriberCount()).toBeGreaterThan(0);

    // The fake defines no `destroy`, so any attempt to call one would throw.
    grid.destroy();
    expect(p.subscriberCount()).toBe(0);
    // Still usable afterwards — the provider outlives the grid.
    expect(() => p.emitSnapshot([{ id: 'b', v: 2 }])).not.toThrow();

    container.remove(); restoreWorker();
  });

  it('one provider feeds two grids; destroying one leaves the other live', async () => {
    const restoreWorker = installFakeWorker();
    const p = makeProvider([{ id: 'a', v: 1 }]);
    const a = buildGrid({ clientSideDataProvider: p.provider });
    const b = buildGrid({ clientSideDataProvider: p.provider });
    await a.grid.whenReady();
    await b.grid.whenReady();
    await settle();
    expect(a.grid.getDisplayedRowCount()).toBe(1);
    expect(b.grid.getDisplayedRowCount()).toBe(1);

    a.grid.destroy();
    a.container.remove();

    // Grid B must keep receiving — this is why destroy() must not tear the
    // provider down.
    p.emitSnapshot([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }]);
    await settle();
    expect(b.grid.getDisplayedRowCount()).toBe(3);

    b.grid.destroy(); b.container.remove(); restoreWorker();
  });

  it('is rejected on a serverSide grid', async () => {
    const restoreWorker = installFakeWorker();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = makeProvider([{ id: 'a', v: 1 }]);
    const { grid, container } = buildGrid({ rowModelType: 'serverSide' });

    grid.setClientSideDataProvider(p.provider);
    expect(p.subscriberCount()).toBe(0);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
    grid.destroy(); container.remove(); restoreWorker();
  });
});
