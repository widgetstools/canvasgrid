/**
 * The vendored plane, driven against the vendored engine, from canvasgrid.
 *
 * `dshub-hub` ships two halves that have to agree: `plane/` (TypeScript
 * source, tracked, traceable to a rangrez commit) and `runtime/dshub_bg.wasm`
 * (the engine it was probed against). This proves the pair works HERE --
 * in-process, no SharedWorker, no dev server -- before anything is built on
 * top of it.
 *
 * It is deliberately thin. The plane's own behaviour is pinned by its 92
 * tests in rangrez, beside the engine, which is the whole point of it living
 * there. What canvasgrid needs to know is narrower: that the tarball's two
 * halves are a matched set, and that `watchGroups` emits the `groupDelta`
 * shape `HubGroupSkeleton` folds.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { HubGroupSkeleton, type HubGroupDelta } from '../../src/dshub/groupSkeleton';

const require_ = createRequire(import.meta.url);
const PKG_DIR = dirname(require_.resolve('dshub-hub/package.json'));

/** The engine, instantiated in-process from the vendored wasm. */
async function realHub(): Promise<unknown> {
  const mod = await import(pathToFileURL(join(PKG_DIR, 'runtime', 'dshub.js')).href) as {
    initSync: (opts: { module: Buffer }) => void;
    // `RustHub.new()` is a STATIC factory (the wasm-bindgen class has a
    // private constructor), not `new RustHub()`.
    RustHub: { new: () => unknown };
  };
  mod.initSync({ module: readFileSync(join(PKG_DIR, 'runtime', 'dshub_bg.wasm')) });
  return mod.RustHub.new();
}

const CFG = {
  keyColumn: 'id',
  columnDefinitions: [
    { field: 'id' },
    { field: 'desk' },
    { field: 'region' },
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
type AnyPlane = any;

let SsrmWasmPlane: new (f: () => unknown) => AnyPlane;

beforeAll(async () => {
  ({ SsrmWasmPlane } = await import('dshub-hub/plane/SsrmWasmPlane.js') as never);
});

describe('the vendored plane runs the vendored engine', () => {
  it('serves a window of ingested rows', async () => {
    const plane = new SsrmWasmPlane(realHub);
    await plane.boot('p', CFG);
    await plane.attachSession('s');
    await plane.ingest('p', ROWS, false);
    const page = await plane.getRows('s', 'p', { startRow: 0, endRow: 10 });
    expect(page.rowCount).toBe(4);
    expect(page.rowData.map((r: { id: string }) => r.id).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('the statistical aggregates that closed the Perspective gap are live', async () => {
    // median / stdev / variance / distinct_count arrived in 3b1d0fe. If the
    // tarball's wasm ever slips back behind its plane, this is where it shows.
    const plane = new SsrmWasmPlane(realHub);
    await plane.boot('agg', CFG);
    await plane.attachSession('aggs');
    await plane.ingest('agg', ROWS, false);
    const page = await plane.getRows('aggs', 'agg', {
      startRow: 0, endRow: 10,
      rowGroupCols: [{ id: 'desk' }],
      valueCols: [{ id: 'mv', aggFunc: 'median' }],
    });
    expect(page.rowCount).toBeGreaterThan(0);
  });
});

describe('watchGroups feeds HubGroupSkeleton', () => {
  it('the engine emits the shape the fold expects, end to end', async () => {
    // The seam canvasgrid's SSRM v2 adapter turns on: the hub computes
    // "aggregates for every group node at every level", v2 asks for "all
    // group rows". The fold is a rename -- this proves the wire really does
    // carry path / count / aggregates, rather than trusting the Rust source.
    const plane = new SsrmWasmPlane(realHub);
    await plane.boot('g', CFG);
    await plane.attachSession('gs');
    // Ingest first, THEN watch — a grid grouping an open blotter has its rows
    // before it asks for groups. That order used to yield nothing (the plane
    // dropped the engine's initial snapshot); fixed upstream in plane
    // a1dc53ae, and this is canvasgrid's end of that contract.
    await plane.ingest('g', ROWS, false);
    await plane.watchGroups('gs', 'g', {
      groupBy: ['desk'],
      aggregates: { mv: 'sum' },
    });

    const ticks = plane.pollAllTicks().get('g') ?? [];
    const deltas = ticks.filter((t: { kind?: string }) => t.kind === 'groupDelta');
    expect(deltas.length).toBeGreaterThan(0);

    const skeleton = new HubGroupSkeleton();
    for (const d of deltas) skeleton.apply(d as HubGroupDelta);

    const byPath = new Map(skeleton.skeleton().map((g) => [g.path.join('/'), g]));
    expect(byPath.get('Rates')).toMatchObject({ leafCount: 2, aggregates: { mv: 30 } });
    expect(byPath.get('Credit')).toMatchObject({ leafCount: 2, aggregates: { mv: 70 } });
    // Two top-level groups covering four leaves — what unfilteredRowCount wants.
    expect(skeleton.topLevelLeafCount()).toBe(4);
  });
});

describe('the initial snapshot reaches the skeleton', () => {
  it('a watch over an already-populated table delivers the whole tree', async () => {
    // The case that matters for getGroupSkeleton: v2 asks for the tree AS IT
    // STANDS, not for the next diff. The engine pushes a full snapshot when
    // the watch registers, but only on the control reply's outbox — the
    // plane used to keep just the matching reply and drop it, so this
    // returned nothing until a row moved.
    const plane = new SsrmWasmPlane(realHub);
    await plane.boot('gap', CFG);
    await plane.attachSession('gaps');
    await plane.ingest('gap', ROWS, false);
    plane.pollAllTicks();                       // drain the ingest delta

    await plane.watchGroups('gaps', 'gap', { groupBy: ['desk'], aggregates: { mv: 'sum' } });

    const skeleton = new HubGroupSkeleton();
    for (const t of plane.pollAllTicks().get('gap') ?? []) {
      if ((t as { kind?: string }).kind === 'groupDelta') skeleton.apply(t as HubGroupDelta);
    }
    expect(skeleton.skeleton().map((g) => g.path[0]).sort()).toEqual(['Credit', 'Rates']);
    expect(skeleton.topLevelLeafCount()).toBe(4);
  });
});
