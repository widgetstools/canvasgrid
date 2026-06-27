// Cycle 15 / Task 1 — GroupPass on worker.
//
// The pass slots between FilterPass and SortPass in the worker pipeline.
// It consumes the post-filter rowId list and produces a hierarchical
// GroupNode tree + a depth-first `flatOrder` the slicer walks honouring
// `expandedKeys` (Task 2). When `rowGroupCols.length === 0`, the
// `bypassed: true` fast path skips every allocation.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import type { FlatOrderEntry, GroupNode } from '../src/worker/passes/groupPass';
import type { WorkerColumn } from '../src/worker/protocol';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest, WorkerResponse, WorkerPush } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'desk',   field: 'desk',   type: 'text' },
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'type',   field: 'type',   type: 'text' },
  { colId: 'price',  field: 'price',  type: 'number' },
  { colId: 'qty',    field: 'qty',    type: 'number', aggFunc: 'sum' },
];

function fixtureStore() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', desk: 'APAC', region: 'Rates',  type: 'IRS',  price: 100, qty: 5 },
    { id: '2', desk: 'APAC', region: 'Rates',  type: 'IRS',  price: 101, qty: 3 },
    { id: '3', desk: 'APAC', region: 'Rates',  type: 'Swap', price: 102, qty: 7 },
    { id: '4', desk: 'APAC', region: 'Credit', type: 'CDS',  price: 200, qty: 2 },
    { id: '5', desk: 'EMEA', region: 'Rates',  type: 'IRS',  price: 300, qty: 4 },
    { id: '6', desk: 'EMEA', region: 'Credit', type: 'CDS',  price: 301, qty: 6 },
  ]);
  return s;
}

const allIds = ['1', '2', '3', '4', '5', '6'];

// 1 — Empty model is the cheap bypass path. `apply` returns
// `bypassed: true` and zero allocations — `roots`/`flatOrder` are the
// shared empty arrays. Downstream consumers short-circuit on this flag.
describe('GroupPass — bypass', () => {
  it('empty rowGroupCols → bypassed:true, no roots, no flatOrder', () => {
    const p = new GroupPass(fixtureStore(), cols);
    const out = p.apply(allIds);
    expect(out.bypassed).toBe(true);
    expect(out.roots).toEqual([]);
    expect(out.flatOrder).toEqual([]);
  });

  // 17 — Reverting to an empty model "flushes" the tree. The next
  // apply call returns the bypass output even when the previous call
  // produced a non-trivial tree. Verifies the model swap takes effect
  // synchronously (no stale tree leaks through).
  it('removing all rowGroupCols flushes to bypass output', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['desk'] });
    expect(p.apply(allIds).bypassed).toBe(false);
    p.setModel({ rowGroupCols: [] });
    const out = p.apply(allIds);
    expect(out.bypassed).toBe(true);
    expect(out.roots.length).toBe(0);
  });
});

// 2 — One-level grouping. Two top-level buckets (APAC / EMEA), each a
// leaf node with `childIndices` pointing into the input rowId list.
describe('GroupPass — one level', () => {
  it('partitions rows into N leaf buckets by a single column', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['desk'] });
    const out = p.apply(allIds);
    expect(out.bypassed).toBe(false);
    expect(out.roots.length).toBe(2);
    const apac = out.roots.find((r) => r.value === 'APAC')!;
    const emea = out.roots.find((r) => r.value === 'EMEA')!;
    expect(apac.depth).toBe(0);
    expect(apac.key).toBe('desk:APAC');
    expect(apac.childGroups).toEqual([]);
    expect(Array.from(apac.childIndices)).toEqual([0, 1, 2, 3]);
    expect(apac.childCount).toBe(4);
    expect(emea.key).toBe('desk:EMEA');
    expect(Array.from(emea.childIndices)).toEqual([4, 5]);
    expect(emea.childCount).toBe(2);
  });
});

// 3 — Three-level grouping: desk → region → type. Each non-leaf node
// has empty `childIndices` and populated `childGroups`; only leaves
// hold actual indices. `childCount` rolls up recursively.
describe('GroupPass — multi-level', () => {
  it('builds a depth-3 tree with proper childCount rollup', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['desk', 'region', 'type'] });
    const out = p.apply(allIds);
    expect(out.roots.length).toBe(2);
    const apac = out.roots.find((r) => r.value === 'APAC')!;
    expect(apac.depth).toBe(0);
    expect(apac.childIndices.length).toBe(0);   // non-leaf
    expect(apac.childCount).toBe(4);            // 1,2,3,4 sit under APAC
    expect(apac.childGroups.length).toBe(2);    // Credit + Rates
    const apacRates = apac.childGroups.find((g) => g.value === 'Rates')!;
    expect(apacRates.depth).toBe(1);
    expect(apacRates.childCount).toBe(3);       // IRS×2 + Swap×1
    expect(apacRates.childGroups.length).toBe(2);
    const apacRatesIrs = apacRates.childGroups.find((g) => g.value === 'IRS')!;
    expect(apacRatesIrs.depth).toBe(2);
    expect(apacRatesIrs.childCount).toBe(2);
    expect(Array.from(apacRatesIrs.childIndices)).toEqual([0, 1]);
    expect(apacRatesIrs.key).toBe('desk:APAC::region:Rates::type:IRS');
  });
});

// 4 — Group ordering at every level is deterministic (sorted by
// composite key). Reverses the row insertion order to prove the output
// doesn't depend on insertion order — the slicer + autoGroupColumn UI
// need a stable order across runs and across data mutations.
describe('GroupPass — deterministic ordering', () => {
  it('sorts child groups by composite key, independent of row insertion order', () => {
    const s = new RowStore('id');
    s.setAll([
      // Insert EMEA before APAC; "z" before "a" within region — output
      // must still come back APAC,EMEA and a,z within each region.
      { id: 'r1', desk: 'EMEA', region: 'z' },
      { id: 'r2', desk: 'EMEA', region: 'a' },
      { id: 'r3', desk: 'APAC', region: 'z' },
      { id: 'r4', desk: 'APAC', region: 'a' },
    ]);
    const p = new GroupPass(s, [
      { colId: 'desk',   field: 'desk',   type: 'text' },
      { colId: 'region', field: 'region', type: 'text' },
    ]);
    p.setModel({ rowGroupCols: ['desk', 'region'] });
    const out = p.apply(['r1', 'r2', 'r3', 'r4']);
    expect(out.roots.map((r) => r.value)).toEqual(['APAC', 'EMEA']);
    expect(out.roots[0]!.childGroups.map((g) => g.value)).toEqual(['a', 'z']);
    expect(out.roots[1]!.childGroups.map((g) => g.value)).toEqual(['a', 'z']);
  });
});

// 5 — Null + undefined cells land in a single "" bucket. The composite
// key falls back to '' so the slicer's expandedKeys mechanism can
// still address the bucket; the raw `value` round-trips as the FIRST
// null/undefined the bucket saw (insertion order via Map).
describe('GroupPass — null group values', () => {
  it('null and undefined coalesce into one bucket keyed by ""', () => {
    const s = new RowStore('id');
    s.setAll([
      { id: '1', desk: null },
      { id: '2', desk: undefined },
      { id: '3', desk: 'APAC' },
    ]);
    const p = new GroupPass(s, [{ colId: 'desk', field: 'desk', type: 'text' }]);
    p.setModel({ rowGroupCols: ['desk'] });
    const out = p.apply(['1', '2', '3']);
    expect(out.roots.length).toBe(2);  // ['', 'APAC'] sorted by key
    const blank = out.roots[0]!;
    expect(blank.key).toBe('desk:');
    expect(blank.value).toBeNull();      // first null seen
    expect(Array.from(blank.childIndices)).toEqual([0, 1]);
  });
});

// 6 — Numeric group values stringify (`String(42) === '42'`). Bucket
// key is the stringified form; `value` stays a number so a renderer
// can call a number-aware formatter.
describe('GroupPass — numeric group values', () => {
  it('stringifies for the key + preserves the typed value', () => {
    const s = new RowStore('id');
    s.setAll([
      { id: '1', bucket: 10 },
      { id: '2', bucket: 2 },
      { id: '3', bucket: 10 },
    ]);
    const p = new GroupPass(s, [{ colId: 'bucket', field: 'bucket', type: 'number' }]);
    p.setModel({ rowGroupCols: ['bucket'] });
    const out = p.apply(['1', '2', '3']);
    // Lexicographic sort by string key, NOT numeric — "10" < "2".
    expect(out.roots.map((r) => r.value)).toEqual([10, 2]);
    expect(out.roots[0]!.key).toBe('bucket:10');
    expect(typeof out.roots[0]!.value).toBe('number');
  });
});

// 7 — Comparison is case-sensitive (`'Apple' !== 'apple'`). Apps that
// want case-insensitive grouping route the column through a value
// getter that lower-cases — the worker stays string-equality strict.
describe('GroupPass — case sensitivity', () => {
  it('treats different-case values as distinct buckets', () => {
    const s = new RowStore('id');
    s.setAll([
      { id: '1', desk: 'apple' },
      { id: '2', desk: 'Apple' },
      { id: '3', desk: 'APPLE' },
    ]);
    const p = new GroupPass(s, [{ colId: 'desk', field: 'desk', type: 'text' }]);
    p.setModel({ rowGroupCols: ['desk'] });
    const out = p.apply(['1', '2', '3']);
    expect(out.roots.length).toBe(3);
  });
});

// 8 — The `flatOrder` is structured so a slicer can use depth
// comparisons to skip a collapsed group's descendants. Verifies group
// entries precede their descendant rows AND rows ride at
// `cols.length` depth (one deeper than the deepest group node).
describe('GroupPass — flatOrder shape', () => {
  it('emits group nodes followed by their descendant rows, rows at rowDepth', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['desk', 'region'] });
    const out = p.apply(allIds);

    // Helper assertions: every row entry sits at depth=2 (one deeper
    // than the deepest group at depth=1), every group entry sits at
    // depth 0 or 1, and a group at depth d is followed (eventually) by
    // either a group at depth > d (its child) or row entries.
    for (const e of out.flatOrder) {
      if (e.kind === 'row') {
        expect(e.depth).toBe(2);
        expect(typeof e.rowIndex).toBe('number');
      } else {
        expect(e.depth === 0 || e.depth === 1).toBe(true);
        expect(typeof e.key).toBe('string');
      }
    }

    // First entry must be the APAC group at depth 0 (sorted before EMEA).
    expect(out.flatOrder[0]).toEqual<FlatOrderEntry>({ kind: 'group', key: 'desk:APAC', depth: 0 });

    // The slicer's contract: to skip a collapsed group at depth d,
    // walk forward until the next entry at depth ≤ d. Verify this
    // contract by counting: APAC's slice (group + its Credit subtree
    // + its Rates subtree) must terminate at the EMEA root group.
    const emeaIdx = out.flatOrder.findIndex((e) => e.kind === 'group' && e.key === 'desk:EMEA');
    expect(emeaIdx).toBeGreaterThan(0);
    expect(out.flatOrder[emeaIdx]!.depth).toBe(0);
    // Every entry strictly between the APAC root and the EMEA root
    // must be at depth > 0 (APAC's descendants).
    for (let i = 1; i < emeaIdx; i++) {
      expect(out.flatOrder[i]!.depth).toBeGreaterThan(0);
    }
  });
});

// 9 — 100-group fixture. The pass scales — synthesises 100 distinct
// top-level buckets and asserts the tree has 100 roots with the right
// childCount distribution. Smoke test for the build algorithm beyond
// the curated 6-row fixture.
describe('GroupPass — 100-group fixture', () => {
  it('builds 100 distinct top-level buckets correctly', () => {
    const s = new RowStore('id');
    const rows: Array<{ id: string; bucket: string }> = [];
    for (let i = 0; i < 1000; i++) {
      rows.push({ id: `r${i}`, bucket: `b${i % 100}` });
    }
    s.setAll(rows);
    const p = new GroupPass(s, [{ colId: 'bucket', field: 'bucket', type: 'text' }]);
    p.setModel({ rowGroupCols: ['bucket'] });
    const out = p.apply(rows.map((r) => r.id));
    expect(out.roots.length).toBe(100);
    for (const root of out.roots) {
      expect(root.childCount).toBe(10);
    }
    // Total flatOrder length = 100 groups + 1000 rows.
    expect(out.flatOrder.length).toBe(1100);
  });
});

// 10 — 1000-group fixture (a wider fan-out). Confirms the build stays
// linear in input size and produces a sorted, complete output.
describe('GroupPass — 1000-group fixture', () => {
  it('builds 1000 distinct top-level buckets correctly', () => {
    const s = new RowStore('id');
    const rows: Array<{ id: string; bucket: string }> = [];
    for (let i = 0; i < 5000; i++) {
      // Zero-pad so lexicographic sort matches numeric order for the
      // assertions below.
      rows.push({ id: `r${i}`, bucket: `b${String(i % 1000).padStart(4, '0')}` });
    }
    s.setAll(rows);
    const p = new GroupPass(s, [{ colId: 'bucket', field: 'bucket', type: 'text' }]);
    p.setModel({ rowGroupCols: ['bucket'] });
    const out = p.apply(rows.map((r) => r.id));
    expect(out.roots.length).toBe(1000);
    // Roots arrive sorted — `b0000` first, `b0999` last.
    expect(out.roots[0]!.value).toBe('b0000');
    expect(out.roots[999]!.value).toBe('b0999');
  });
});

// 11 — `setModel` rejects unknown colIds. Surfaced as a thrown Error
// so the worker can convert into a structured `error` envelope at the
// set-site (catalog spec — "GroupPass: unknown column id").
describe('GroupPass — validation', () => {
  it('rejects unknown column id in rowGroupCols', () => {
    const p = new GroupPass(fixtureStore(), cols);
    expect(() => p.setModel({ rowGroupCols: ['notAColumn'] }))
      .toThrowError(/unknown column id/);
  });

  // 12 — Duplicate colIds in rowGroupCols are the closest analogue to
  // ag-grid's "circular groupOrder" — grouping by the same column
  // twice produces a degenerate single-bucket-per-level tree. Reject
  // up-front so apps don't ship a silently-broken hierarchy.
  it('rejects duplicate column id in rowGroupCols (circular order)', () => {
    const p = new GroupPass(fixtureStore(), cols);
    expect(() => p.setModel({ rowGroupCols: ['desk', 'desk'] }))
      .toThrowError(/circular group order/);
  });
});

// 13 — A column declared with `aggFunc` (Cycle 14) is a legitimate
// group column too — aggregation lives on the column metadata, group
// orientation lives on the model. Verifies the two roles compose
// (downstream Task 11 will use this to compute per-group totals via
// the same column's aggFunc).
describe('GroupPass — group-by-aggFunc column', () => {
  it('groups by a column that also has aggFunc set', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['qty'] });   // qty has aggFunc:'sum'
    const out = p.apply(allIds);
    expect(out.bypassed).toBe(false);
    // qty values in the fixture: 5,3,7,2,4,6 → 6 distinct → 6 roots.
    expect(out.roots.length).toBe(6);
  });
});

// 14 — `apply` receives the post-filter rowId set. Verifies the pass
// honours the subset — feeding only 3 of 6 rows produces a tree with
// only those 3 rows accounted for. (Integration with the actual
// FilterPass round-trip is covered downstream; this is the boundary
// contract.)
describe('GroupPass — group-then-filter ordering', () => {
  it('processes only the post-filter inputIds (subset of the store)', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['desk'] });
    // Simulate FilterPass having dropped rows 4, 5, 6 — only APAC rows.
    const out = p.apply(['1', '2', '3']);
    expect(out.roots.length).toBe(1);
    expect(out.roots[0]!.value).toBe('APAC');
    expect(out.roots[0]!.childCount).toBe(3);
    // Indices reference the INPUT list, not the store's full row set —
    // so index 0 is rowId '1', index 2 is rowId '3'.
    expect(Array.from(out.roots[0]!.childIndices)).toEqual([0, 1, 2]);
  });
});

// 15 — Mutating the model and re-applying reflects the new model.
// Verifies the instance is not frozen after the first apply.
describe('GroupPass — model swap re-emits', () => {
  it('setModel then apply uses the new model', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['desk'] });
    const a = p.apply(allIds);
    expect(a.roots.length).toBe(2);
    p.setModel({ rowGroupCols: ['region'] });
    const b = p.apply(allIds);
    // Two regions in the fixture: Credit + Rates.
    expect(b.roots.map((r) => r.value).sort()).toEqual(['Credit', 'Rates']);
  });

  // 16 — Changing the depth (single col → multi col) re-emits with
  // proper child group construction; not just root reshuffling.
  it('changing rowGroupCols depth re-emits a deeper tree', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['desk'] });
    const a = p.apply(allIds);
    expect(a.roots[0]!.childGroups).toEqual([]);
    p.setModel({ rowGroupCols: ['desk', 'region'] });
    const b = p.apply(allIds);
    expect(b.roots[0]!.childGroups.length).toBeGreaterThan(0);
    expect(b.roots[0]!.childIndices.length).toBe(0);
  });

  // 18 — Re-grouping by a different col produces the correct tree
  // shape (no stale state leakage from the prior group column's
  // bucket layout — the closest thing to a "bucket cache reuse" test
  // we can write without exposing internals).
  it('re-grouping by a different single column produces a fresh correct tree', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['desk'] });
    p.apply(allIds);
    p.setModel({ rowGroupCols: ['type'] });
    const out = p.apply(allIds);
    // Distinct types in the fixture: IRS, Swap, CDS.
    expect(out.roots.map((r) => r.value).sort()).toEqual(['CDS', 'IRS', 'Swap']);
    const cds = out.roots.find((r) => r.value === 'CDS')!;
    expect(cds.childCount).toBe(2);  // rows 4, 6
    expect(Array.from(cds.childIndices)).toEqual([3, 5]);
  });
});

// ---------- Worker round-trip smoke ----------
//
// Verifies the protocol surface (`setGroupModel` → worker dispatches to
// GroupPass → re-runs pipeline) hangs together. The setGroupModel reply
// shape is `rowCount`; on a malformed model the reply is `error`.

interface MockWorker {
  postMessage: (msg: WorkerRequest) => void;
  addEventListener: (type: 'message', cb: (e: { data: WorkerResponse | WorkerPush }) => void) => void;
  send: (req: WorkerRequest) => Promise<WorkerResponse>;
}

function makeMockWorker(): MockWorker {
  const listeners: Array<(e: { data: WorkerResponse | WorkerPush }) => void> = [];
  const host = createWorkerHost((msg) => {
    queueMicrotask(() => listeners.forEach((cb) => cb({ data: msg })));
  });
  let nextId = 1;
  const pending = new Map<number, (msg: WorkerResponse) => void>();
  listeners.push((e) => {
    const data = e.data;
    if ('id' in data) {
      const resolve = pending.get(data.id);
      if (resolve) {
        pending.delete(data.id);
        resolve(data);
      }
    }
  });
  return {
    postMessage: (msg) => host.handle(msg),
    addEventListener: (_, cb) => listeners.push(cb),
    send: (req) => new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      host.handle({ ...req, id } as WorkerRequest);
    }),
  };
}

beforeAll(() => {
  // Silence the worker host's failure path noise in case anything
  // unrelated trips an internal warn; tests still observe `error`
  // envelopes via the message stream.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GroupPass — worker round-trip', () => {
  it('setGroupModel runs through the worker and re-issues rowCount', async () => {
    const w = makeMockWorker();
    await w.send({ id: 0, type: 'init', payload: { columns: cols, rowIdField: 'id' } });
    await w.send({
      id: 0, type: 'setRowData',
      payload: { rows: [
        { id: '1', desk: 'APAC' },
        { id: '2', desk: 'EMEA' },
        { id: '3', desk: 'APAC' },
      ] },
    });
    const reply = await w.send({ id: 0, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] } });
    expect(reply.type).toBe('rowCount');
    if (reply.type === 'rowCount') {
      expect(reply.count).toBe(3);
      expect(reply.visibleCount).toBe(3);
    }
  });

  it('setGroupModel surfaces unknown colId as an error envelope', async () => {
    const w = makeMockWorker();
    await w.send({ id: 0, type: 'init', payload: { columns: cols, rowIdField: 'id' } });
    const reply = await w.send({
      id: 0, type: 'setGroupModel', payload: { rowGroupCols: ['notAColumn'] },
    });
    expect(reply.type).toBe('error');
    if (reply.type === 'error') {
      expect(reply.error).toMatch(/unknown column id/);
    }
  });
});

// Defensive: the GroupNode interface is part of the public worker
// surface (Task 2 slicer imports it). Pin the shape so an accidental
// rename of a field breaks the test before it reaches the slicer.
describe('GroupPass — GroupNode interface', () => {
  it('leaf node has all required fields', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['desk'] });
    const node: GroupNode = p.apply(allIds).roots[0]!;
    expect(node).toHaveProperty('key');
    expect(node).toHaveProperty('value');
    expect(node).toHaveProperty('depth');
    expect(node).toHaveProperty('colId');
    expect(node.childIndices).toBeInstanceOf(Uint32Array);
    expect(Array.isArray(node.childGroups)).toBe(true);
    expect(typeof node.childCount).toBe('number');
  });
});
