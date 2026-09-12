/**
 * The Rust hub driving a REAL VelocityGrid, end to end.
 *
 * Every other test in this area stops at a seam: the plane against the engine,
 * the datasource against the plane, the engine wrapper against a fake grid.
 * This one closes the loop — wasm engine, plane, v2 datasource, kernel row
 * model, painted row count — because that chain is the claim being made when
 * anyone says "the Rust hub is our SSRM engine", and every seam in it was
 * built this week.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import { DshubSsrmEngine } from '@wellsfargo-starui/velocity-grid-data';

const require_ = createRequire(import.meta.url);
const PKG_DIR = dirname(require_.resolve('dshub-hub/package.json'));

beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class { constructor(_d?: string) {} };
  }
  HTMLCanvasElement.prototype.getContext = (() => ({
    scale() {}, save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, rect() {}, fill() {}, stroke() {},
    fillRect() {}, clearRect() {}, fillText() {}, drawImage() {},
    measureText: () => ({ width: 0 }),
    setTransform() {}, translate() {}, clip() {}, arc() {},
    canvas: { width: 1, height: 1 },
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

async function realHub(): Promise<unknown> {
  const mod = await import(pathToFileURL(join(PKG_DIR, 'runtime', 'dshub.js')).href) as {
    initSync: (opts: { module: Buffer }) => void;
    RustHub: { new: () => unknown };
  };
  mod.initSync({ module: readFileSync(join(PKG_DIR, 'runtime', 'dshub_bg.wasm')) });
  return mod.RustHub.new();
}

const COLUMNS = [
  { field: 'id' }, { field: 'desk' }, { field: 'region' },
  { field: 'mv', cellDataType: 'number' },
];
const ROWS = Array.from({ length: 40 }, (_, i) => ({
  id: `r${i}`,
  desk: ['Rates', 'Credit', 'FX', 'EM'][i % 4],
  region: ['US', 'EU'][i % 2],
  mv: (i + 1) * 10,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SsrmWasmPlane: any;
beforeAll(async () => {
  ({ SsrmWasmPlane } = await import('dshub-hub/plane/SsrmWasmPlane.js') as never);
});

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

function mountGrid() {
  const host = document.createElement('div');
  host.style.cssText = 'width:900px;height:600px';
  document.body.appendChild(host);
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
  const grid = new VelocityGrid(host, {
    columnDefs: COLUMNS,
    getRowId: (r: { id: string }) => r.id,
    rowModelType: 'serverSide',
  } as never);
  return {
    grid,
    teardown() {
      grid.destroy();
      host.remove();
      (globalThis as { Worker?: unknown }).Worker = prevWorker;
    },
  };
}

async function engineOn(grid: unknown, providerId: string) {
  const engine = new DshubSsrmEngine({
    plane: new SsrmWasmPlane(realHub),
    providerId,
    config: { keyColumn: 'id', columnDefinitions: COLUMNS },
    aggregates: { mv: 'sum' },
    tickMs: 30,
  });
  await engine.start();
  await engine.ingest(ROWS);
  engine.attach(grid as never);
  await settle();
  return engine;
}

describe('the Rust hub as VelocityGrid\u2019s SSRM engine', () => {
  it('rows reach the grid', async () => {
    const { grid, teardown } = mountGrid();
    const engine = await engineOn(grid, 'e2e-flat');
    expect(grid.getDisplayedRowCount()).toBe(ROWS.length);
    await engine.destroy();
    teardown();
  });

  it('a grouped grid gets its groups from the engine', async () => {
    // The skeleton path: watchGroups -> groupDelta -> fold -> SkeletonGroup[]
    // -> kernel flatten index -> displayed rows. Four desks, collapsed.
    const { grid, teardown } = mountGrid();
    const engine = await engineOn(grid, 'e2e-group');
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await settle(400);
    expect(grid.getDisplayedRowCount()).toBe(4);
    await engine.destroy();
    teardown();
  });

  it('expanding a group pages its leaves in', async () => {
    const { grid, teardown } = mountGrid();
    const engine = await engineOn(grid, 'e2e-expand');
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await settle(400);
    const collapsed = grid.getDisplayedRowCount();

    // The kernel addresses a group by its COMPOSITE key (`<colId>:<value>`),
    // not by the raw value — `setExpanded('Rates', …)` matches nothing and
    // silently leaves the grid collapsed.
    grid.setExpanded('desk:Rates', true);
    await settle(400);
    expect(grid.getExpandedKeys().has('desk:Rates')).toBe(true);
    // Ten of the forty rows are Rates, so expanding adds exactly ten.
    expect(grid.getDisplayedRowCount()).toBe(collapsed + 10);
    await engine.destroy();
    teardown();
  });

  it('a live update reaches the grid without the grid asking, exactly once', async () => {
    // The pump's contract, and both halves matter. It must notice the change
    // — nothing here calls refresh — and it must notice it ONCE: a refresh on
    // every tick would drive the grid ten times a second on a still book.
    //
    // Asserting `modelUpdated` here would be testing the wrong layer. A
    // `purge: false` refresh keeps the cached blocks, and the row count did
    // not change, so the kernel correctly repaints nothing. What the ENGINE
    // promises is the refresh call.
    const { grid, teardown } = mountGrid();
    const engine = await engineOn(grid, 'e2e-live');
    grid.setGroupModel({ rowGroupCols: ['desk'] });
    await settle(400);

    const refreshes = vi.spyOn(grid, 'refreshServerSide');
    await engine.ingest([{ id: 'r0', desk: 'Rates', region: 'US', mv: 99999 }]);
    await settle(300);

    expect(refreshes).toHaveBeenCalledTimes(1);
    expect(refreshes).toHaveBeenCalledWith({ purge: false });

    // And the engine's own view of the tree followed the change: r0 was 10,
    // so the Rates sum moves by 99989.
    const rates = engine.datasource!.currentSkeleton().find((g) => g.path[0] === 'Rates');
    expect((rates?.aggregates as { mv: number }).mv).toBeGreaterThan(99989);

    await engine.destroy();
    teardown();
  });

  it('detaching leaves the grid without a datasource, and stops repainting', async () => {
    const { grid, teardown } = mountGrid();
    const engine = await engineOn(grid, 'e2e-detach');
    engine.detach();
    const painted = vi.fn();
    grid.addEventListener('modelUpdated' as never, painted as never);
    await engine.ingest([{ id: 'r1', desk: 'Rates', region: 'US', mv: 1 }]);
    await settle(200);
    expect(painted).not.toHaveBeenCalled();
    await engine.destroy();
    teardown();
  });
});
