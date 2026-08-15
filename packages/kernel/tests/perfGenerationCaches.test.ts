/**
 * Task 13 (VelocityGrid production hardening) — A-P1 + A-P2.
 *
 * A-P1: `getViewport` ran `AggPass.apply` (grand totals) and
 *       `AggPass.applyGroups` (per-group totals) unconditionally on EVERY
 *       viewport fetch — a full O(N) read of every visible row per
 *       aggregated column on a pure scroll with zero data change.
 * A-P2: the same handler re-materialised `computeGroupVisibleOrder` and
 *       the group-meta lookup per request, and `effectiveExpandedKeys()`
 *       walked `flatOrder` again on top.
 *
 * Both are now memoized per pipeline generation. These tests assert
 * RECOMPUTE COUNTS (via spies / result identity), never wall-clock
 * timings, and — just as importantly — that every input change still
 * forces the recompute.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AggPass, RowStore } from '../src/worker/dataPipeline';
import { AggFuncRegistry } from '../src/worker/aggFuncRegistry';
import {
  createGroupViewCaches,
  cachedEffectiveExpandedKeys,
  cachedGroupMetaLookup,
  cachedGroupVisibleOrder,
  type GroupMetaEntry,
} from '../src/worker/groupViewCache';
import type { GroupPassOutput, GroupNode } from '../src/worker/passes/groupPass';
import type { WorkerColumn } from '../src/worker/protocol';

interface Row { id: string; desk: string; notional: number }

const COLUMNS: WorkerColumn[] = [
  { colId: 'desk', field: 'desk', type: 'text' },
  { colId: 'notional', field: 'notional', type: 'number', aggFunc: 'countingSum' },
];

function fixtureRows(): Row[] {
  return [
    { id: 'a', desk: 'EQ', notional: 10 },
    { id: 'b', desk: 'EQ', notional: 20 },
    { id: 'c', desk: 'FI', notional: 30 },
    { id: 'd', desk: 'FI', notional: 40 },
  ];
}

// ─── A-P1 — AggPass per-generation memo ────────────────────────────────────

describe('A-P1 — AggPass.apply memoizes per pipeline generation', () => {
  let store: RowStore<Row>;
  let registry: AggFuncRegistry;
  let agg: AggPass<Row>;
  let sum: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new RowStore<Row>('id');
    store.setAll(fixtureRows());
    registry = new AggFuncRegistry();
    sum = vi.fn(({ values }: { values: unknown[] }) =>
      values.reduce<number>((acc, v) => acc + (typeof v === 'number' ? v : 0), 0));
    registry.register('countingSum', sum as never);
    agg = new AggPass<Row>(store, COLUMNS, registry);
  });

  it('two consecutive applies over the SAME id array recompute once', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const first = agg.apply(ids);
    const second = agg.apply(ids);
    expect(sum).toHaveBeenCalledTimes(1);
    // A memo hit returns the very object the recompute produced.
    expect(second).toBe(first);
    expect(first.totals['notional']).toBe(100);
  });

  it('a DIFFERENT id array recomputes (identity is part of the key)', () => {
    agg.apply(['a', 'b', 'c', 'd']);
    const out = agg.apply(['a', 'b']);
    expect(sum).toHaveBeenCalledTimes(2);
    expect(out.totals['notional']).toBe(30);
  });

  it('a row-data mutation recomputes even with the same id array', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(agg.apply(ids).totals['notional']).toBe(100);
    store.apply({ update: [{ id: 'a', desk: 'EQ', notional: 999 }] });
    expect(agg.apply(ids).totals['notional']).toBe(1089);
    expect(sum).toHaveBeenCalledTimes(2);
  });

  it('a full store replace recomputes even with the same id array', () => {
    const ids = ['a', 'b'];
    expect(agg.apply(ids).totals['notional']).toBe(30);
    store.setAll([
      { id: 'a', desk: 'EQ', notional: 1 },
      { id: 'b', desk: 'EQ', notional: 2 },
    ]);
    expect(agg.apply(ids).totals['notional']).toBe(3);
  });

  it('setColumns recomputes even with the same id array', () => {
    const ids = ['a', 'b', 'c', 'd'];
    agg.apply(ids);
    agg.setColumns([
      { colId: 'desk', field: 'desk', type: 'text' },
      { colId: 'notional', field: 'notional', type: 'number' }, // aggFunc dropped
    ]);
    const out = agg.apply(ids);
    expect(Object.keys(out.totals)).toEqual([]);
  });

  it('a registry change recomputes even with the same id array', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(agg.apply(ids).totals['notional']).toBe(100);
    registry.register('countingSum', (() => -1) as never);
    expect(agg.apply(ids).totals['notional']).toBe(-1);
  });

  it('replaceCustom recomputes even with the same id array', () => {
    const ids = ['a', 'b'];
    expect(agg.apply(ids).totals['notional']).toBe(30);
    registry.replaceCustom({ countingSum: (() => 7) as never });
    expect(agg.apply(ids).totals['notional']).toBe(7);
  });
});

// ─── A-P1 — the deviation's own justification: identity-stable but mutated ─

describe('A-P1 — sparse-SSRM in-place hydrate (stable array identity) still recomputes', () => {
  /**
   * This is the scenario the whole A-P1 deviation rests on, and until now
   * it existed only as prose (see `AggPass.apply`'s TSDoc and the fix-wave
   * report): `handlers/dataPipeline.ts`'s `ssrmHydrate` case aliases
   * `state.visibleCache` to `state.ssrmOrder` (:214) and, on a soft-refresh
   * hydrate (`reset` false, row count unchanged — NOT `reallocated`, :133),
   * writes new row ids into EXISTING slots of that SAME array (:168
   * `state.ssrmOrder[idx] = id`) rather than allocating a fresh one — a
   * fresh array is allocated only `if (reset || reallocated)` (:134-135).
   *
   * A memo keyed on `inputIds === cached.inputIds` ALONE would read that
   * as "nothing changed" and serve the totals computed before the hydrate.
   * `AggPass.apply` survives this only because its key also folds in
   * `RowStore.revision()` — and the hydrate handler always pairs an
   * in-place slot write with a `store.apply` for the corresponding row
   * (:197), which bumps that revision. This test pins exactly that: same
   * array object in, changed row data in, must NOT get the stale result.
   */
  it('same ssrmOrder array object, row data updated via store.apply — totals recompute, not memoized', () => {
    const store = new RowStore<Row>('id');
    store.setAll([
      { id: 'a', desk: 'EQ', notional: 10 },
      { id: 'b', desk: 'EQ', notional: 20 },
    ]);
    const registry = new AggFuncRegistry();
    const sum = vi.fn(({ values }: { values: unknown[] }) =>
      values.reduce<number>((acc, v) => acc + (typeof v === 'number' ? v : 0), 0));
    registry.register('countingSum', sum as never);
    const agg = new AggPass<Row>(store, COLUMNS, registry);

    // Stand-in for `state.ssrmOrder` — a sparse-SSRM slot array with one
    // never-hydrated slot ('' — the same sentinel `ssrmHydrate` pre-fills
    // reallocated slots with). `state.visibleCache = state.ssrmOrder`
    // (dataPipeline.ts:214) hands THIS array to `AggPass.apply` as
    // `inputIds`.
    const ssrmOrder: string[] = ['a', 'b', ''];
    const first = agg.apply(ssrmOrder);
    expect(sum).toHaveBeenCalledTimes(1);
    expect(first.totals['notional']).toBe(30);

    // A soft-refresh hydrate: NOT reset, row count unchanged (3 === 3) ⇒
    // NOT reallocated ⇒ the real handler mutates `ssrmOrder` IN PLACE
    // (dataPipeline.ts:168) and, per its own doc, always pairs that write
    // with a `store.apply` for the newly-hydrated row (dataPipeline.ts:197)
    // — same two effects, reproduced here directly against `RowStore` +
    // `AggPass` (the layer this file already unit-tests).
    const sameArrayRef = ssrmOrder;
    ssrmOrder[2] = 'c';
    store.apply({ add: [{ id: 'c', desk: 'FI', notional: 1000 }] });

    // The premise this test exists to pin: the array `AggPass.apply` sees
    // on the second call is LITERALLY the same object as the first call —
    // exactly the condition under which a plain `inputIds === cached.
    // inputIds` key (the plan's original A-P1 mechanism) would have wrongly
    // served the stale (30) memo instead of recomputing.
    expect(ssrmOrder).toBe(sameArrayRef);

    const second = agg.apply(ssrmOrder);
    expect(sum).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    expect(second.totals['notional']).toBe(1030);
  });
});

// ─── A-P1 — applyGroups per-generation memo ────────────────────────────────

/** Minimal single-level GroupPassOutput: two groups over the 4 fixture
 *  rows, `childIndices` addressing the `inputIds` array. */
function groupOutputFixture(): GroupPassOutput {
  const eq: GroupNode = {
    key: 'desk:EQ', colId: 'desk', value: 'EQ', depth: 0,
    childIndices: new Uint32Array([0, 1]), childGroups: [], childCount: 2,
  } as unknown as GroupNode;
  const fi: GroupNode = {
    key: 'desk:FI', colId: 'desk', value: 'FI', depth: 0,
    childIndices: new Uint32Array([2, 3]), childGroups: [], childCount: 2,
  } as unknown as GroupNode;
  return {
    bypassed: false,
    roots: [eq, fi],
    flatOrder: [
      { kind: 'group', key: 'desk:EQ', depth: 0 },
      { kind: 'row', rowIndex: 0, depth: 1 },
      { kind: 'row', rowIndex: 1, depth: 1 },
      { kind: 'group', key: 'desk:FI', depth: 0 },
      { kind: 'row', rowIndex: 2, depth: 1 },
      { kind: 'row', rowIndex: 3, depth: 1 },
    ],
  } as unknown as GroupPassOutput;
}

describe('A-P1 — AggPass.applyGroups memoizes per pipeline generation', () => {
  let store: RowStore<Row>;
  let registry: AggFuncRegistry;
  let agg: AggPass<Row>;
  let sum: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new RowStore<Row>('id');
    store.setAll(fixtureRows());
    registry = new AggFuncRegistry();
    sum = vi.fn(({ values }: { values: unknown[] }) =>
      values.reduce<number>((acc, v) => acc + (typeof v === 'number' ? v : 0), 0));
    registry.register('countingSum', sum as never);
    agg = new AggPass<Row>(store, COLUMNS, registry);
  });

  it('two consecutive applyGroups over the same inputs recompute once', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const out = groupOutputFixture();
    const first = agg.applyGroups(ids, out);
    const second = agg.applyGroups(ids, out);
    expect(second).toBe(first);
    // one call per group (2), not four.
    expect(sum).toHaveBeenCalledTimes(2);
    expect(first.groupTotals['desk:EQ']?.['notional']).toBe(30);
    expect(first.groupTotals['desk:FI']?.['notional']).toBe(70);
  });

  it('a new GroupPassOutput identity recomputes', () => {
    const ids = ['a', 'b', 'c', 'd'];
    agg.applyGroups(ids, groupOutputFixture());
    agg.applyGroups(ids, groupOutputFixture());
    expect(sum).toHaveBeenCalledTimes(4);
  });

  it('a row-data mutation recomputes group totals', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const out = groupOutputFixture();
    expect(agg.applyGroups(ids, out).groupTotals['desk:EQ']?.['notional']).toBe(30);
    store.apply({ update: [{ id: 'a', desk: 'EQ', notional: 100 }] });
    expect(agg.applyGroups(ids, out).groupTotals['desk:EQ']?.['notional']).toBe(120);
  });
});

// ─── A-P2 — grouped-walk memo ──────────────────────────────────────────────

describe('A-P2 — grouped visible order / meta lookup memo', () => {
  it('effectiveExpandedKeys derivation runs once per (groupOutput, explicit) pair', () => {
    const caches = createGroupViewCaches();
    const out = groupOutputFixture();
    const first = cachedEffectiveExpandedKeys(caches, out, null);
    const second = cachedEffectiveExpandedKeys(caches, out, null);
    expect(second).toBe(first);
    expect([...first].sort()).toEqual(['desk:EQ', 'desk:FI']);
    // A new pipeline generation (fresh groupOutput) re-derives.
    const third = cachedEffectiveExpandedKeys(caches, groupOutputFixture(), null);
    expect(third).not.toBe(first);
    expect([...third].sort()).toEqual(['desk:EQ', 'desk:FI']);
  });

  it('an explicit expandedKeys set is returned verbatim (identity), never cached over', () => {
    const caches = createGroupViewCaches();
    const out = groupOutputFixture();
    const explicit = new Set(['desk:EQ']);
    expect(cachedEffectiveExpandedKeys(caches, out, explicit)).toBe(explicit);
    // Switching back to the sentinel must NOT serve the explicit set.
    expect(cachedEffectiveExpandedKeys(caches, out, null)).not.toBe(explicit);
  });

  it('the visible order is computed once and reused for identical inputs', () => {
    const caches = createGroupViewCaches();
    const out = groupOutputFixture();
    const expanded = new Set(['desk:EQ', 'desk:FI']);
    const first = cachedGroupVisibleOrder(caches, out, null, expanded, false, false);
    const second = cachedGroupVisibleOrder(caches, out, null, expanded, false, false);
    expect(second).toBe(first);
    expect(first.length).toBe(6);
  });

  it('a different suppressLeafRows flag can never be served the other entry', () => {
    const caches = createGroupViewCaches();
    const out = groupOutputFixture();
    const expanded = new Set(['desk:EQ', 'desk:FI']);
    const full = cachedGroupVisibleOrder(caches, out, null, expanded, false, false);
    const pivoted = cachedGroupVisibleOrder(caches, out, null, expanded, false, true);
    expect(full.length).toBe(6);      // groups + leaves
    expect(pivoted.length).toBe(2);   // groups only
    // …and going back re-derives rather than returning the pivot entry.
    const backToFull = cachedGroupVisibleOrder(caches, out, null, expanded, false, false);
    expect(backToFull.length).toBe(6);
  });

  it('an expandedKeys change invalidates the order memo', () => {
    const caches = createGroupViewCaches();
    const out = groupOutputFixture();
    const bothOpen = new Set(['desk:EQ', 'desk:FI']);
    expect(cachedGroupVisibleOrder(caches, out, bothOpen, bothOpen, false, false).length).toBe(6);
    const oneOpen = new Set(['desk:EQ']);
    expect(cachedGroupVisibleOrder(caches, out, oneOpen, oneOpen, false, false).length).toBe(4);
  });

  it('an expandedKeys change invalidates the order memo even at the same SIZE', () => {
    const caches = createGroupViewCaches();
    const out = groupOutputFixture();
    const eqOpen = new Set(['desk:EQ']);
    const fiOpen = new Set(['desk:FI']);
    const a = cachedGroupVisibleOrder(caches, out, eqOpen, eqOpen, false, false);
    const b = cachedGroupVisibleOrder(caches, out, fiOpen, fiOpen, false, false);
    expect(a).not.toBe(b);
    expect(a.map((e) => e.kind)).toEqual(['group', 'row', 'row', 'group']);
    expect(b.map((e) => e.kind)).toEqual(['group', 'group', 'row', 'row']);
  });

  it('the meta lookup builds once and reuses for identical inputs', () => {
    const caches = createGroupViewCaches();
    const out = groupOutputFixture();
    const expanded = new Set(['desk:EQ']);
    const build = vi.fn((roots: readonly GroupNode[]) => {
      const m = new Map<string, GroupMetaEntry>();
      for (const r of roots) {
        m.set(r.key, { value: String(r.value), childCount: r.childCount, isExpanded: expanded.has(r.key), colId: r.colId });
      }
      return m;
    });
    const first = cachedGroupMetaLookup(caches, out, COLUMNS, expanded, expanded, build);
    const second = cachedGroupMetaLookup(caches, out, COLUMNS, expanded, expanded, build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.get('desk:EQ')?.isExpanded).toBe(true);
  });

  it('the meta lookup rebuilds when columns, groupOutput or expandedKeys change', () => {
    const caches = createGroupViewCaches();
    const out = groupOutputFixture();
    const expanded = new Set(['desk:EQ']);
    const build = vi.fn(() => new Map<string, GroupMetaEntry>());
    cachedGroupMetaLookup(caches, out, COLUMNS, expanded, expanded, build);
    // new columns array identity
    cachedGroupMetaLookup(caches, out, [...COLUMNS], expanded, expanded, build);
    expect(build).toHaveBeenCalledTimes(2);
    // new expandedKeys identity
    const other = new Set(['desk:FI']);
    cachedGroupMetaLookup(caches, out, COLUMNS, other, other, build);
    expect(build).toHaveBeenCalledTimes(3);
    // new groupOutput identity
    cachedGroupMetaLookup(caches, groupOutputFixture(), COLUMNS, other, other, build);
    expect(build).toHaveBeenCalledTimes(4);
  });
});
