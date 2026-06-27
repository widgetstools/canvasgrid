// Cycle 15 / Task 12 — group footer rows (per-group + grand-total).
//
// Three surfaces compose to produce footer rows:
//   1. GroupPass appends `kind: 'footer'` entries to flatOrder when
//      `includeFooter` is on (and optionally a final `kind: 'footer'`
//      with empty key for the grand total when `includeTotalFooter`).
//   2. AggPass.applyGroups walks the tree and computes per-group totals
//      indexed by composite group key. Reuses the per-column aggFunc
//      resolution from the grand-total `apply()`.
//   3. viewportSlicer translates footer entries into chunk slots with
//      `rowKinds[i] === 3` so main can resolve them via
//      `chunk.groupTotals[groupKey]`.
//
// The tests below pin each layer + the worker round-trip end-to-end.
// Skipping any layer's contract means a footer row paints incorrect
// chrome or carries stale totals; the suite is the regression guard.

import { describe, it, expect } from 'vitest';
import { GroupPass, RowStore, AggPass } from '../src/worker/dataPipeline';
import { AggFuncRegistry } from '../src/worker/aggFuncRegistry';
import { computeGroupVisibleOrder, sliceGroupedViewport } from '../src/worker/viewportSlicer';
import type { WorkerColumn, ViewportRequest } from '../src/worker/protocol';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest, WorkerResponse, WorkerPush } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'desk',   field: 'desk',   type: 'text' },
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'qty',    field: 'qty',    type: 'number', aggFunc: 'sum' },
  { colId: 'price',  field: 'price',  type: 'number', aggFunc: 'avg' },
];

function fixtureStore() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', desk: 'APAC', region: 'Rates',  qty: 5, price: 100 },
    { id: '2', desk: 'APAC', region: 'Rates',  qty: 3, price: 110 },
    { id: '3', desk: 'APAC', region: 'Credit', qty: 7, price: 200 },
    { id: '4', desk: 'EMEA', region: 'Rates',  qty: 4, price: 300 },
    { id: '5', desk: 'EMEA', region: 'Credit', qty: 6, price: 400 },
  ]);
  return s;
}

const allIds = ['1', '2', '3', '4', '5'];

// 1 — Default behaviour: GroupPass does NOT emit footer entries unless
// the includeFooter flag is flipped. Preserves the pre-Task-12 flatOrder
// shape so existing slicer tests stay valid.
describe('GroupPass — footer emission default off', () => {
  it('emits no footer entries when includeFooter is off', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setModel({ rowGroupCols: ['desk'] });
    const out = p.apply(allIds);
    expect(out.flatOrder.find((e) => e.kind === 'footer')).toBeUndefined();
  });
});

// 2 — `includeFooter: true` appends one footer entry at the END of each
// non-elided group's child traversal. The footer carries the parent
// group's composite key + depth one greater than the parent so the
// slicer's skip-depth logic drops it on collapse.
describe('GroupPass — per-group footer emission', () => {
  it('appends one footer entry per leaf group at depth = parent.depth + 1', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setIncludeFooter(true, false);
    p.setModel({ rowGroupCols: ['desk'] });
    const out = p.apply(allIds);
    const footers = out.flatOrder.filter((e) => e.kind === 'footer');
    expect(footers.length).toBe(2);
    expect(footers.map((f) => f.key).sort()).toEqual(['desk:APAC', 'desk:EMEA']);
    for (const f of footers) {
      expect(f.depth).toBe(1); // parent depth 0 + 1
    }
  });

  it('nested groups emit a footer per node in depth-first post-order', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setIncludeFooter(true, false);
    p.setModel({ rowGroupCols: ['desk', 'region'] });
    const out = p.apply(allIds);
    // Expected flatOrder shape (APAC sorts before EMEA, Credit < Rates):
    //   group APAC (0)
    //     group APAC::Credit (1) → row → footer (depth 2)
    //     group APAC::Rates  (1) → row × 2 → footer (depth 2)
    //   footer APAC (depth 1)
    //   group EMEA (0)
    //     group EMEA::Credit (1) → row → footer (depth 2)
    //     group EMEA::Rates  (1) → row → footer (depth 2)
    //   footer EMEA (depth 1)
    const footers = out.flatOrder.filter((e) => e.kind === 'footer');
    expect(footers.length).toBe(6); // 4 leaf + 2 parent
    // Last entry per top-level group is the parent footer at depth 1.
    const apacFooterIdx = out.flatOrder.findIndex((e) => e.kind === 'footer' && e.key === 'desk:APAC');
    const emeaFooterIdx = out.flatOrder.findIndex((e) => e.kind === 'footer' && e.key === 'desk:EMEA');
    expect(apacFooterIdx).toBeGreaterThan(-1);
    expect(emeaFooterIdx).toBeGreaterThan(-1);
    expect(out.flatOrder[apacFooterIdx]!.depth).toBe(1);
    expect(out.flatOrder[emeaFooterIdx]!.depth).toBe(1);
  });
});

// 3 — `includeTotalFooter: true` (paired with includeFooter) appends one
// grand-total footer at the very END of flatOrder. Empty key + depth 0
// so it sits outside any group's collapsible scope.
describe('GroupPass — grand-total footer emission', () => {
  it('appends one grand-total footer (empty key, depth 0) at the very end of flatOrder', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setIncludeFooter(true, true);
    p.setModel({ rowGroupCols: ['desk'] });
    const out = p.apply(allIds);
    const last = out.flatOrder[out.flatOrder.length - 1]!;
    expect(last.kind).toBe('footer');
    expect(last.key).toBe('');
    expect(last.depth).toBe(0);
  });

  it('includeTotalFooter alone (without includeFooter) emits NO footer entries', () => {
    const p = new GroupPass(fixtureStore(), cols);
    p.setIncludeFooter(false, true);
    p.setModel({ rowGroupCols: ['desk'] });
    const out = p.apply(allIds);
    expect(out.flatOrder.find((e) => e.kind === 'footer')).toBeUndefined();
  });
});

// 4 — Elided groups (childCount === 1 under `groupRemoveSingleChildren`)
// skip BOTH the group AND the footer entry — a single-child funnel
// shouldn't carry a redundant "Total" row.
describe('GroupPass — elision skips footer too', () => {
  it('groupRemoveSingleChildren elides both the group entry AND its footer', () => {
    // Single-row store so every "group" is a single-child funnel.
    const s = new RowStore('id');
    s.setAll([
      { id: '1', desk: 'APAC', region: 'Rates', qty: 5, price: 100 },
      { id: '2', desk: 'EMEA', region: 'Credit', qty: 7, price: 200 },
    ]);
    const p = new GroupPass(s, cols);
    p.setIncludeFooter(true, false);
    p.setRemoveSingleChildren(true);
    p.setModel({ rowGroupCols: ['desk', 'region'] });
    const out = p.apply(['1', '2']);
    // Every group has childCount === 1 → every group + footer elides.
    // Only the two leaf rows remain.
    const rows = out.flatOrder.filter((e) => e.kind === 'row');
    const footers = out.flatOrder.filter((e) => e.kind === 'footer');
    expect(rows.length).toBe(2);
    expect(footers.length).toBe(0);
  });
});

// 5 — Slicer translates footer entries into chunk slots. Verifies
// `rowKinds[i] === 3`, `groupKey[i]` carries the parent's composite key,
// and `groupDepth[i] = parent.depth` so the renderer paints the label
// at the parent's indent column.
describe('viewportSlicer — footer chunk slots', () => {
  it('packs footer entries with rowKind=3, parent groupKey, and parent-depth indent', () => {
    const store = fixtureStore();
    const p = new GroupPass(store, cols);
    p.setIncludeFooter(true, false);
    p.setModel({ rowGroupCols: ['desk'] });
    const out = p.apply(allIds);
    const expanded = new Set(out.flatOrder.filter((e) => e.kind === 'group').map((e) => (e as { key: string }).key));
    const order = computeGroupVisibleOrder(out.flatOrder, expanded);
    const colIndex = new Map<string, WorkerColumn>();
    for (const c of cols) colIndex.set(c.colId, c);
    const req: ViewportRequest = { rowStart: 0, rowEnd: order.length, columns: ['qty'] };
    const groupMeta = new Map<string, { value: string; childCount: number; isExpanded: boolean }>();
    for (const node of out.roots) {
      groupMeta.set(node.key, { value: String(node.value), childCount: node.childCount, isExpanded: true });
    }
    const chunk = sliceGroupedViewport(
      store, colIndex, allIds, order, req, undefined,
      (key) => groupMeta.get(key),
    );
    // Find each footer slot in the chunk and verify its metadata.
    const footerSlots: Array<{ idx: number; groupKey: string; depth: number; valueFormatted: string }> = [];
    for (let i = 0; i < chunk.rowCount; i++) {
      if (chunk.rowKinds[i] !== 3) continue;
      footerSlots.push({
        idx: i,
        groupKey: chunk.groupKey?.[i] ?? '',
        depth: chunk.groupDepth[i] ?? 0,
        valueFormatted: chunk.groupValue?.[i] ?? '',
      });
    }
    expect(footerSlots.length).toBe(2);
    for (const f of footerSlots) {
      // Per-group footer entry depth was 1 (parent.depth+1); slicer
      // sets groupDepth[i] = entry.depth - 1 = 0 so the renderer paints
      // the label at the parent group's indent.
      expect(f.depth).toBe(0);
      expect(['desk:APAC', 'desk:EMEA']).toContain(f.groupKey);
      expect(f.valueFormatted).toBe(f.groupKey === 'desk:APAC' ? 'APAC' : 'EMEA');
    }
  });
});

// 6 — AggPass.applyGroups walks the group tree and produces a per-group
// totals record per composite key. Reuses the same aggFunc resolution
// path the grand-total `apply()` uses — single source of truth.
describe('AggPass — per-group totals', () => {
  it('computes per-group totals for a single-level tree', () => {
    const store = fixtureStore();
    const registry = new AggFuncRegistry();
    const agg = new AggPass(store, cols, registry);
    const gp = new GroupPass(store, cols);
    gp.setModel({ rowGroupCols: ['desk'] });
    const groupOutput = gp.apply(allIds);
    const { groupTotals } = agg.applyGroups(allIds, groupOutput);
    // APAC qty = 5 + 3 + 7 = 15; EMEA qty = 4 + 6 = 10.
    expect(groupTotals['desk:APAC']!.qty).toBe(15);
    expect(groupTotals['desk:EMEA']!.qty).toBe(10);
    // APAC price avg = (100+110+200) / 3; EMEA price avg = (300+400)/2.
    expect(groupTotals['desk:APAC']!.price).toBeCloseTo((100 + 110 + 200) / 3, 6);
    expect(groupTotals['desk:EMEA']!.price).toBeCloseTo((300 + 400) / 2, 6);
  });

  it('computes per-group totals for every node in a nested tree', () => {
    const store = fixtureStore();
    const registry = new AggFuncRegistry();
    const agg = new AggPass(store, cols, registry);
    const gp = new GroupPass(store, cols);
    gp.setModel({ rowGroupCols: ['desk', 'region'] });
    const groupOutput = gp.apply(allIds);
    const { groupTotals } = agg.applyGroups(allIds, groupOutput);
    // Top-level groups + leaf-level nested groups all populate.
    expect(groupTotals['desk:APAC']!.qty).toBe(15);
    expect(groupTotals['desk:APAC::region:Rates']!.qty).toBe(8);
    expect(groupTotals['desk:APAC::region:Credit']!.qty).toBe(7);
    expect(groupTotals['desk:EMEA']!.qty).toBe(10);
    expect(groupTotals['desk:EMEA::region:Rates']!.qty).toBe(4);
    expect(groupTotals['desk:EMEA::region:Credit']!.qty).toBe(6);
  });

  it('returns empty groupTotals when grouping is bypassed', () => {
    const store = fixtureStore();
    const registry = new AggFuncRegistry();
    const agg = new AggPass(store, cols, registry);
    const gp = new GroupPass(store, cols);
    // No model set → bypass.
    const groupOutput = gp.apply(allIds);
    const { groupTotals } = agg.applyGroups(allIds, groupOutput);
    expect(groupTotals).toEqual({});
  });

  it('returns empty groupTotals when no resolved agg columns', () => {
    const store = fixtureStore();
    const registry = new AggFuncRegistry();
    // Drop the agg-bearing columns from the worker column list.
    const noAggCols: WorkerColumn[] = cols.map((c) => ({ ...c, aggFunc: undefined }));
    const agg = new AggPass(store, noAggCols, registry);
    const gp = new GroupPass(store, noAggCols);
    gp.setModel({ rowGroupCols: ['desk'] });
    const groupOutput = gp.apply(allIds);
    const { groupTotals } = agg.applyGroups(allIds, groupOutput);
    expect(groupTotals).toEqual({});
  });
});

// 7 — End-to-end through createWorkerHost: setGroupModel + getViewport
// reply ships a chunk with `groupTotals` AND footer rows interleaved in
// the data subgrid's chunk window.
describe('Worker round-trip — chunk carries groupTotals and footer rows', () => {
  it('chunk includes footer rowKinds and per-group totals when groupIncludeFooter is on', async () => {
    const replies: WorkerResponse[] = [];
    const host = createWorkerHost((msg: WorkerResponse | WorkerPush) => {
      if ('id' in msg) replies.push(msg);
    });
    function send(req: WorkerRequest): void { host.handle(req); }
    function wait(ms = 100): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
    function take(id: number): WorkerResponse | undefined {
      const idx = replies.findIndex((r) => 'id' in r && r.id === id);
      if (idx === -1) return undefined;
      return replies.splice(idx, 1)[0];
    }
    send({
      id: 1, type: 'init',
      payload: {
        columns: cols,
        rowIdField: 'id',
        groupIncludeFooter: true,
      },
    });
    await wait();
    take(1);
    send({ id: 2, type: 'setRowData', payload: { rows: [
      { id: '1', desk: 'APAC', region: 'Rates',  qty: 5, price: 100 },
      { id: '2', desk: 'APAC', region: 'Credit', qty: 3, price: 110 },
      { id: '3', desk: 'EMEA', region: 'Rates',  qty: 7, price: 200 },
    ] } });
    await wait();
    take(2);
    send({ id: 3, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] } });
    await wait();
    take(3);
    send({ id: 4, type: 'getViewport', payload: { rowStart: 0, rowEnd: 20, columns: ['qty', 'price'] } });
    await wait();
    const vp = take(4);
    expect(vp).toBeDefined();
    expect(vp!.type).toBe('viewport');
    const reply = vp as { type: 'viewport'; chunk: { rowCount: number; rowKinds: Uint8Array; groupKey?: string[]; groupTotals?: Record<string, Record<string, unknown>> } };
    const chunk = reply.chunk;
    // Two top-level groups → 2 footer slots.
    let footerCount = 0;
    for (let i = 0; i < chunk.rowCount; i++) {
      if (chunk.rowKinds[i] === 3) footerCount++;
    }
    expect(footerCount).toBe(2);
    // Per-group totals payload populated.
    expect(chunk.groupTotals).toBeDefined();
    expect(chunk.groupTotals!['desk:APAC']!.qty).toBe(8);
    expect(chunk.groupTotals!['desk:EMEA']!.qty).toBe(7);
  });
});
