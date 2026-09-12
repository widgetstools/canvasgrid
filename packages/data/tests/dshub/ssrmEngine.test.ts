/**
 * The engine wrapper, against the real wasm and a fake grid.
 *
 * What is worth pinning here is the wiring the plane deliberately leaves to a
 * host: that a grid gets the datasource, that ticks reach it as refreshes,
 * that a QUIET engine produces no refreshes at all, and that detaching stops
 * the pump. The datasource's own behaviour is covered next door.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { DshubSsrmEngine } from '../../src/dshub/ssrmEngine';

const require_ = createRequire(import.meta.url);
const PKG_DIR = dirname(require_.resolve('dshub-hub/package.json'));

async function realHub(): Promise<unknown> {
  const mod = await import(pathToFileURL(join(PKG_DIR, 'runtime', 'dshub.js')).href) as {
    initSync: (opts: { module: Buffer }) => void;
    RustHub: { new: () => unknown };
  };
  mod.initSync({ module: readFileSync(join(PKG_DIR, 'runtime', 'dshub_bg.wasm')) });
  return mod.RustHub.new();
}

const CFG = {
  keyColumn: 'id',
  columnDefinitions: [
    { field: 'id' }, { field: 'desk' }, { field: 'mv', cellDataType: 'number' },
  ],
};
const ROWS = [
  { id: 'r1', desk: 'Rates', mv: 10 },
  { id: 'r2', desk: 'Rates', mv: 20 },
  { id: 'r3', desk: 'Credit', mv: 30 },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SsrmWasmPlane: any;
beforeAll(async () => {
  ({ SsrmWasmPlane } = await import('dshub-hub/plane/SsrmWasmPlane.js') as never);
});

function fakeGrid() {
  const refreshes: Array<{ purge?: boolean } | undefined> = [];
  let datasource: unknown = undefined;
  return {
    refreshes,
    get datasource() { return datasource; },
    refreshServerSide: (p?: { purge?: boolean }) => { refreshes.push(p); },
    setServerSideDatasource: (ds: unknown) => { datasource = ds; },
  };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function engineFor(id: string, tickMs = 20) {
  const engine = new DshubSsrmEngine({
    plane: new SsrmWasmPlane(realHub),
    providerId: id,
    config: CFG,
    aggregates: { mv: 'sum' },
    tickMs,
  });
  await engine.start();
  return engine;
}

describe('starting and attaching', () => {
  it('hands the grid a datasource', async () => {
    const engine = await engineFor('a');
    const grid = fakeGrid();
    engine.attach(grid);
    expect(grid.datasource).toBe(engine.datasource);
    await engine.destroy();
  });

  it('serves rows through it once fed', async () => {
    const engine = await engineFor('b');
    await engine.ingest(ROWS);
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      engine.datasource!.getRows({
        request: { startRow: 0, endRow: 10 },
        success: (r) => resolve(r.rowData), fail: () => reject(new Error('fail')),
      });
    });
    expect(rows).toHaveLength(3);
    await engine.destroy();
  });

  it('refuses to attach before start', () => {
    const engine = new DshubSsrmEngine({
      plane: new SsrmWasmPlane(realHub), providerId: 'c', config: CFG,
    });
    expect(() => engine.attach(fakeGrid())).toThrow(/attach before start/);
  });
});

describe('the tick pump', () => {
  it('refreshes the grid when the engine reports movement', async () => {
    const engine = await engineFor('pump');
    const grid = fakeGrid();
    await engine.ingest(ROWS);
    // A skeleton request registers the watch the pump then folds.
    await new Promise<void>((res, rej) => engine.datasource!.getGroupSkeleton({
      request: { rowGroupCols: ['desk'] }, success: () => res(), fail: () => rej(new Error('fail')),
    }));
    engine.attach(grid);

    await engine.ingest([{ id: 'r1', desk: 'Rates', mv: 999 }]);
    await tick(120);
    expect(grid.refreshes.length).toBeGreaterThan(0);
    expect(grid.refreshes[0]).toEqual({ purge: false });
    await engine.destroy();
  });

  it('a QUIET engine produces no refreshes at all', async () => {
    // The property that keeps a still grid still. The engine answers "nothing
    // changed" by pushing nothing, and that answer is passed straight
    // through — a refresh every tick would repaint ten times a second for no
    // reason.
    const engine = await engineFor('quiet');
    const grid = fakeGrid();
    await engine.ingest(ROWS);
    await new Promise<void>((res, rej) => engine.datasource!.getGroupSkeleton({
      request: { rowGroupCols: ['desk'] }, success: () => res(), fail: () => rej(new Error('fail')),
    }));
    engine.attach(grid);
    await tick(150);
    expect(grid.refreshes).toEqual([]);
    await engine.destroy();
  });

  it('detaching stops the pump and clears the grid', async () => {
    const engine = await engineFor('detach');
    const grid = fakeGrid();
    await engine.ingest(ROWS);
    await new Promise<void>((res, rej) => engine.datasource!.getGroupSkeleton({
      request: { rowGroupCols: ['desk'] }, success: () => res(), fail: () => rej(new Error('fail')),
    }));
    const stop = engine.attach(grid);
    stop();
    expect(grid.datasource).toBeNull();

    await engine.ingest([{ id: 'r2', desk: 'Rates', mv: 555 }]);
    await tick(120);
    expect(grid.refreshes).toEqual([]);
    await engine.destroy();
  });

  it('a grid that throws on refresh does not kill the pump', async () => {
    // A grid tearing down mid-tick is ordinary, not exceptional.
    const engine = await engineFor('throwy');
    const grid = fakeGrid();
    const boom = vi.spyOn(grid, 'refreshServerSide').mockImplementation(() => { throw new Error('tearing down'); });
    await engine.ingest(ROWS);
    await new Promise<void>((res, rej) => engine.datasource!.getGroupSkeleton({
      request: { rowGroupCols: ['desk'] }, success: () => res(), fail: () => rej(new Error('fail')),
    }));
    engine.attach(grid);
    await engine.ingest([{ id: 'r3', desk: 'Credit', mv: 1 }]);
    await tick(120);
    expect(boom).toHaveBeenCalled();      // it threw, and we survived to assert
    await engine.destroy();
  });
});

describe('restart semantics', () => {
  it('a shrinking snapshot does not leave stale keys rendering', async () => {
    const engine = await engineFor('restart');
    await engine.ingest(ROWS);
    await engine.ingest([{ id: 'r1', desk: 'Rates', mv: 11 }], true);   // replace
    const rows = await new Promise<Array<{ id: string }>>((resolve, reject) => {
      engine.datasource!.getRows({
        request: { startRow: 0, endRow: 10 },
        success: (r) => resolve(r.rowData as Array<{ id: string }>), fail: () => reject(new Error('fail')),
      });
    });
    expect(rows.map((r) => r.id)).toEqual(['r1']);
    await engine.destroy();
  });
});
