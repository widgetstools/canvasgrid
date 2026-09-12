/**
 * The v2 datasource, driven against the REAL engine.
 *
 * This is the seam the whole Rust-hub integration turns on, so it is tested
 * end to end rather than against a fake: plane -> engine -> groupDelta ->
 * fold -> `SkeletonGroup[]`. A fake would have happily accepted the
 * type-tagged `path` that the real engine actually sends.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { DshubServerSideDatasource, type DshubPlaneLike } from '../../src/dshub/serverSideDatasource';

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
    { field: 'id' }, { field: 'desk' }, { field: 'region' },
    { field: 'mv', cellDataType: 'number' },
  ],
};
const ROWS = [
  { id: 'r1', desk: 'Rates', region: 'US', mv: 10 },
  { id: 'r2', desk: 'Rates', region: 'EU', mv: 20 },
  { id: 'r3', desk: 'Credit', region: 'US', mv: 30 },
  { id: 'r4', desk: 'Credit', region: 'EU', mv: 40 },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SsrmWasmPlane: any;
beforeAll(async () => {
  ({ SsrmWasmPlane } = await import('dshub-hub/plane/SsrmWasmPlane.js') as never);
});

async function bootDatasource(id: string, opts: { aggregates?: Record<string, string> } = {}) {
  const plane = new SsrmWasmPlane(realHub);
  await plane.boot(id, CFG);
  await plane.attachSession(`${id}s`);
  await plane.ingest(id, ROWS, false);
  plane.pollAllTicks();
  return new DshubServerSideDatasource({
    plane: plane as DshubPlaneLike,
    sessionId: `${id}s`,
    providerId: id,
    aggregates: opts.aggregates,
  });
}

/** Promisified `success`/`fail` — v2's callback shape is not thenable. */
function awaited<T>(run: (p: { success(r: T): void; fail(): void }) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    run({ success: resolve, fail: () => reject(new Error('datasource fail()')) });
  });
}

describe('getGroupSkeleton', () => {
  it('returns every group at every depth, with raw values and leaf counts', async () => {
    const ds = await bootDatasource('sk', { aggregates: { mv: 'sum' } });
    const res = await awaited<{ groups: Array<{ path: string[]; leafCount: number; aggregates?: Record<string, unknown> }>; unfilteredRowCount?: number }>(
      (p) => ds.getGroupSkeleton({ request: { rowGroupCols: ['desk', 'region'] }, ...p }),
    );

    const byPath = new Map(res.groups.map((g) => [g.path.join('/'), g]));
    // Both depths, and the captions are RAW — not the engine's `sRates` tag.
    expect([...byPath.keys()].sort()).toEqual([
      'Credit', 'Credit/EU', 'Credit/US', 'Rates', 'Rates/EU', 'Rates/US',
    ]);
    expect(byPath.get('Rates')).toMatchObject({ leafCount: 2, aggregates: { mv: 30 } });
    expect(byPath.get('Credit/EU')).toMatchObject({ leafCount: 1, aggregates: { mv: 40 } });
  });

  it('counts the top level only, so unfilteredRowCount is the filtered set', async () => {
    // Summing every depth would count each leaf once per level — six groups
    // over four rows would report twelve.
    const ds = await bootDatasource('cnt', { aggregates: { mv: 'sum' } });
    const res = await awaited<{ unfilteredRowCount?: number }>(
      (p) => ds.getGroupSkeleton({ request: { rowGroupCols: ['desk', 'region'] }, ...p }),
    );
    expect(res.unfilteredRowCount).toBe(4);
  });

  it('a second call for the same generation does not re-watch, and still answers', async () => {
    const ds = await bootDatasource('gen', { aggregates: { mv: 'sum' } });
    const req = { rowGroupCols: ['desk'] };
    const first = await awaited<{ groups: unknown[] }>((p) => ds.getGroupSkeleton({ request: req, ...p }));
    const second = await awaited<{ groups: unknown[] }>((p) => ds.getGroupSkeleton({ request: req, ...p }));
    expect(second.groups).toEqual(first.groups);
  });

  it('a changed groupBy starts a new tree rather than merging into the old one', async () => {
    // The generation rule. Without it, the previous grouping's paths linger
    // as groups the new query does not have.
    const ds = await bootDatasource('regen', { aggregates: { mv: 'sum' } });
    await awaited((p) => ds.getGroupSkeleton({ request: { rowGroupCols: ['desk'] }, ...p }));
    const next = await awaited<{ groups: Array<{ path: string[] }> }>(
      (p) => ds.getGroupSkeleton({ request: { rowGroupCols: ['region'] }, ...p }),
    );
    expect(next.groups.map((g) => g.path.join('/')).sort()).toEqual(['EU', 'US']);
  });
});

describe('getLeafRows', () => {
  it('pages the leaves under one group', async () => {
    const ds = await bootDatasource('leaf');
    const res = await awaited<{ rowData: Array<{ id: string }> }>(
      (p) => ds.getLeafRows({
        request: { groupPath: ['Rates'], startRow: 0, endRow: 10, rowGroupCols: ['desk'] },
        ...p,
      }),
    );
    expect(res.rowData.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
  });

  it('addresses a deeper group by its full path', async () => {
    const ds = await bootDatasource('leaf2');
    const res = await awaited<{ rowData: Array<{ id: string }> }>(
      (p) => ds.getLeafRows({
        request: { groupPath: ['Credit', 'EU'], startRow: 0, endRow: 10, rowGroupCols: ['desk', 'region'] },
        ...p,
      }),
    );
    expect(res.rowData.map((r) => r.id)).toEqual(['r4']);
  });
});

describe('getRows (ungrouped fallback)', () => {
  it('serves a flat window with the total count', async () => {
    const ds = await bootDatasource('flat');
    const res = await awaited<{ rowData: unknown[]; rowCount?: number }>(
      (p) => ds.getRows({ request: { startRow: 0, endRow: 2 }, ...p }),
    );
    expect(res.rowCount).toBe(4);
    expect(res.rowData).toHaveLength(2);
  });

  it('honours a sort', async () => {
    const ds = await bootDatasource('sorted');
    const res = await awaited<{ rowData: Array<{ id: string }> }>(
      (p) => ds.getRows({
        request: { startRow: 0, endRow: 10, sortModel: [{ colId: 'mv', sort: 'desc' }] },
        ...p,
      }),
    );
    expect(res.rowData.map((r) => r.id)).toEqual(['r4', 'r3', 'r2', 'r1']);
  });
});

describe('staying live between skeleton requests', () => {
  it('a tick updates the tree in place', async () => {
    // A feed keeps moving while the grid sits still. The host drains and
    // repaints rather than waiting for the grid to ask again.
    const plane = new SsrmWasmPlane(realHub);
    await plane.boot('live', CFG);
    await plane.attachSession('lives');
    await plane.ingest('live', ROWS, false);
    plane.pollAllTicks();
    const ds = new DshubServerSideDatasource({
      plane: plane as DshubPlaneLike, sessionId: 'lives', providerId: 'live',
      aggregates: { mv: 'sum' },
    });
    await awaited((p) => ds.getGroupSkeleton({ request: { rowGroupCols: ['desk'] }, ...p }));

    await plane.ingest('live', [{ id: 'r1', desk: 'Rates', region: 'US', mv: 100 }], false);
    expect(ds.drainTicks()).toBe(true);

    const rates = ds.currentSkeleton().find((g) => g.path[0] === 'Rates');
    expect(rates?.aggregates).toMatchObject({ mv: 120 });   // 100 + 20
  });
});
