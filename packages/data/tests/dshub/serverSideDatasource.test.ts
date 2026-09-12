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

describe('engine-computed columns', () => {
  /**
   * The DV01-weighted average spread — `SUM(spread x dv01) / SUM(dv01)`.
   *
   * This is the claim the whole engine choice rests on, so it is pinned
   * against the real wasm rather than trusted. It needs TWO computed columns
   * because an `agg` node names a column, so the product must exist as one
   * before it can be summed; the second then aggregates over the first. That
   * an agg may reference another computed column is the trick, and it is why
   * a closed set of aggregate functions cannot express this at all.
   */
  const COMPUTED = [
    { as: 'wprod', version: 1,
      expr: { k: 'bin', op: 'mul', l: { k: 'col', name: 'spread' }, r: { k: 'col', name: 'dv01' } } },
    { as: 'wSpread', version: 1,
      expr: { k: 'bin', op: 'div',
              l: { k: 'agg', fn: 'sum', col: 'wprod' },
              r: { k: 'agg', fn: 'sum', col: 'dv01' } } },
  ];
  const CFG_W = {
    keyColumn: 'id',
    columnDefinitions: [
      { field: 'id' }, { field: 'desk' },
      { field: 'spread', cellDataType: 'number' },
      { field: 'dv01', cellDataType: 'number' },
    ],
  };
  // Two positions: a small one at a wide spread, a large one at a tight
  // spread. The unweighted average is 150; the DV01-weighted average is 60.
  const W_ROWS = [
    { id: 'w1', desk: 'Credit', spread: 280, dv01: 10 },
    { id: 'w2', desk: 'Credit', spread: 20, dv01: 90 },
  ];

  async function weightedPlane(id: string) {
    const plane = new SsrmWasmPlane(realHub);
    await plane.boot(id, CFG_W);
    await plane.attachSession(`${id}s`);
    await plane.ingest(id, W_ROWS, false);
    return new DshubServerSideDatasource({
      plane: plane as DshubPlaneLike, sessionId: `${id}s`, providerId: id,
      computedColumns: COMPUTED,
    });
  }

  it('evaluates the product per row', async () => {
    const ds = await weightedPlane('wp');
    const res = await awaited<{ rowData: Array<Record<string, number>> }>(
      (p) => ds.getRows({ request: { startRow: 0, endRow: 10 }, ...p }));
    const byId = new Map(res.rowData.map((r) => [r.id as unknown as string, r]));
    expect(byId.get('w1')!.wprod).toBeCloseTo(2800, 5);
    expect(byId.get('w2')!.wprod).toBeCloseTo(1800, 5);
  });

  it('the weighted average is the ratio of sums, not the mean of the spreads', async () => {
    // The whole point. Mean(280, 20) = 150. Weighted = 4600/100 = 46.
    const ds = await weightedPlane('wa');
    const res = await awaited<{ rowData: Array<Record<string, number>> }>(
      (p) => ds.getRows({ request: { startRow: 0, endRow: 10 }, ...p }));
    expect(res.rowData[0]!.wSpread).toBeCloseTo(46, 5);
    expect(res.rowData[0]!.wSpread).not.toBeCloseTo(150, 0);
  });

  it('scopes the aggregate to the GROUP, not the whole table', async () => {
    // The discriminating case, and the one that decides what the demo can
    // honestly show. With two desks of different weighting, a whole-table
    // agg would put the SAME number under both. A per-group agg puts each
    // desk's own weighted spread on its own leaves.
    const plane = new SsrmWasmPlane(realHub);
    await plane.boot('ws', CFG_W);
    await plane.attachSession('wss');
    await plane.ingest('ws', [
      ...W_ROWS,
      // Rates: 10bp on 10 dv01, 400bp on 90 dv01 -> 3.61e4/100 = 361.
      { id: 'w3', desk: 'Rates', spread: 10, dv01: 10 },
      { id: 'w4', desk: 'Rates', spread: 400, dv01: 90 },
    ], false);
    const ds = new DshubServerSideDatasource({
      plane: plane as DshubPlaneLike, sessionId: 'wss', providerId: 'ws',
      computedColumns: COMPUTED,
    });
    const leaves = (desk: string) => awaited<{ rowData: Array<Record<string, number>> }>(
      (p) => ds.getLeafRows({
        request: { groupPath: [desk], startRow: 0, endRow: 10, rowGroupCols: ['desk'] }, ...p }));

    const credit = await leaves('Credit');
    const rates = await leaves('Rates');
    expect(credit.rowData[0]!.wSpread).toBeCloseTo(46, 5);
    expect(rates.rowData[0]!.wSpread).toBeCloseTo(361, 5);
    // Whole-table weighted average is 20900/200 = 104.5 — neither group's.
    expect(credit.rowData[0]!.wSpread).not.toBeCloseTo(104.5, 1);
  });

  it('rides the leaf rows under a group too', async () => {
    const ds = await weightedPlane('wg');
    const res = await awaited<{ rowData: Array<Record<string, unknown>> }>(
      (p) => ds.getLeafRows({
        request: { groupPath: ['Credit'], startRow: 0, endRow: 10, rowGroupCols: ['desk'] }, ...p }));
    expect(res.rowData).toHaveLength(2);
    expect(res.rowData[0]!.wSpread).toBeCloseTo(46, 5);
  });
});
