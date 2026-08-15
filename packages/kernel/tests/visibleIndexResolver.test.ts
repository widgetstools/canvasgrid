// Task 2 (production-hardening / A-C1) — shared grouped-index resolver.
//
// When grouping is active, the main thread speaks GROUP-VISIBLE indices
// (group-header rows occupy a slot; collapsed leaves are excluded — see
// `computeGroupVisibleOrder`, `worker/viewportSlicer.ts`). Before this
// fix, only `getRowIndicesForIds` translated correctly; `getRowIndexForId`,
// `getRowByIndex`, `clipboardSerialize`, and autosize `textOf` all indexed
// the FLAT leaf array instead, targeting the wrong row under grouping.
//
// `buildVisibleIndexResolver(ctx)` is the one shared translation every
// worker endpoint should route through. These are unit tests of the
// resolver in isolation (a fake `HandlerCtx`) — the four endpoints get
// integration coverage in `workerClient.test.ts` / `clipboardSerialize.test.ts`.

import { describe, it, expect } from 'vitest';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import { buildVisibleIndexResolver } from '../src/worker/visibleIndexResolver';
import { createGroupViewCaches } from '../src/worker/groupViewCache';
import type { HandlerCtx } from '../src/worker/dispatch';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'desk', field: 'desk', type: 'text' },
  { colId: 'qty', field: 'qty', type: 'number' },
];

/** 5 rows, 2 desks: APAC (3 rows) then EMEA (2 rows). Grouping by `desk`
 *  with APAC collapsed and EMEA expanded — the classic "collapsed group
 *  ahead of the target row" shape that exposes an offset bug: the flat
 *  leaf index of `id4` is 3 (0-based among all 5 rows), but its
 *  GROUP-VISIBLE index is 2 (group-header APAC, group-header EMEA, then
 *  id4). Any endpoint still reading the flat array lands on the wrong
 *  row. */
function buildGroupedFixture() {
  const store = new RowStore('id');
  store.setAll([
    { id: 'id1', desk: 'APAC', qty: 1 },
    { id: 'id2', desk: 'APAC', qty: 2 },
    { id: 'id3', desk: 'APAC', qty: 3 },
    { id: 'id4', desk: 'EMEA', qty: 4 },
    { id: 'id5', desk: 'EMEA', qty: 5 },
  ]);
  const allIds = ['id1', 'id2', 'id3', 'id4', 'id5'];
  const group = new GroupPass(store, cols);
  group.setModel({ rowGroupCols: ['desk'] });
  const groupOutput = group.apply(allIds);
  return { store, allIds, groupOutput };
}

/** Minimal fake `HandlerCtx` — only the `state` fields and `helpers`
 *  methods `buildVisibleIndexResolver` actually reads. Cast through
 *  `unknown` so the fixture doesn't have to populate the full `State` /
 *  `WorkerHelpers` shape (mirrors the narrow-fixture style
 *  `viewportSlicer.group.test.ts` uses for `GroupPass` + `RowStore`). */
function fakeGroupedCtx(expandedKeys: Set<string>): HandlerCtx {
  const { allIds, groupOutput } = buildGroupedFixture();
  const state = {
    groupOutput,
    groupInputIds: allIds,
    groupHideOpenParents: false,
    // Task 13 (A-P2) — the resolver now materialises the grouped visible
    // order through the per-generation memo, which lives on `State`. Each
    // fixture gets its OWN cache object, so a memo can never leak across
    // cases here. `expandedKeys` is part of the memo key.
    expandedKeys,
    groupViewCache: createGroupViewCaches(),
  };
  const helpers = {
    isGroupingActive: () => true,
    effectiveExpandedKeys: () => expandedKeys,
    visibleAsync: async () => allIds,
  };
  return { state, post: () => {}, helpers } as unknown as HandlerCtx;
}

function fakeFlatCtx(ids: string[]): HandlerCtx {
  const state = {
    groupOutput: null, groupInputIds: null, groupHideOpenParents: false,
    expandedKeys: null, groupViewCache: createGroupViewCaches(),
  };
  const helpers = {
    isGroupingActive: () => false,
    effectiveExpandedKeys: () => new Set<string>(),
    visibleAsync: async () => ids,
  };
  return { state, post: () => {}, helpers } as unknown as HandlerCtx;
}

describe('buildVisibleIndexResolver — grouping active', () => {
  it('leafIdAt returns null for group-header slots, the leaf id otherwise', async () => {
    // APAC collapsed, EMEA expanded.
    const ctx = fakeGroupedCtx(new Set(['desk:EMEA']));
    const resolver = await buildVisibleIndexResolver(ctx);
    // Visible order: [group APAC (collapsed), group EMEA, id4, id5].
    expect(resolver.length).toBe(4);
    expect(resolver.leafIdAt(0)).toBeNull(); // group header (APAC)
    expect(resolver.leafIdAt(1)).toBeNull(); // group header (EMEA)
    expect(resolver.leafIdAt(2)).toBe('id4');
    expect(resolver.leafIdAt(3)).toBe('id5');
  });

  it('leafIdAt returns null out of range (negative or >= length)', async () => {
    const ctx = fakeGroupedCtx(new Set(['desk:EMEA']));
    const resolver = await buildVisibleIndexResolver(ctx);
    expect(resolver.leafIdAt(-1)).toBeNull();
    expect(resolver.leafIdAt(999)).toBeNull();
  });

  it('indexOfLeafId resolves the GROUP-VISIBLE position, not the flat leaf position', async () => {
    const ctx = fakeGroupedCtx(new Set(['desk:EMEA']));
    const resolver = await buildVisibleIndexResolver(ctx);
    // id4's flat leaf index is 3; its group-visible index (behind 2
    // group headers, with 3 collapsed APAC leaves excluded) is 2.
    expect(resolver.indexOfLeafId('id4')).toBe(2);
    expect(resolver.indexOfLeafId('id5')).toBe(3);
  });

  it('indexOfLeafId returns -1 for a leaf hidden inside a collapsed group', async () => {
    const ctx = fakeGroupedCtx(new Set(['desk:EMEA']));
    const resolver = await buildVisibleIndexResolver(ctx);
    expect(resolver.indexOfLeafId('id1')).toBe(-1);
    expect(resolver.indexOfLeafId('id2')).toBe(-1);
    expect(resolver.indexOfLeafId('id3')).toBe(-1);
  });

  it('indexOfLeafId returns -1 for an unknown rowId', async () => {
    const ctx = fakeGroupedCtx(new Set(['desk:EMEA']));
    const resolver = await buildVisibleIndexResolver(ctx);
    expect(resolver.indexOfLeafId('does-not-exist')).toBe(-1);
  });

  it('all groups expanded: every leaf resolves at its group-visible slot, headers included', async () => {
    const ctx = fakeGroupedCtx(new Set(['desk:APAC', 'desk:EMEA']));
    const resolver = await buildVisibleIndexResolver(ctx);
    // Visible order: [group APAC, id1, id2, id3, group EMEA, id4, id5].
    expect(resolver.length).toBe(7);
    expect(resolver.leafIdAt(0)).toBeNull();
    expect(resolver.leafIdAt(1)).toBe('id1');
    expect(resolver.leafIdAt(4)).toBeNull();
    expect(resolver.leafIdAt(5)).toBe('id4');
    expect(resolver.indexOfLeafId('id1')).toBe(1);
    expect(resolver.indexOfLeafId('id4')).toBe(5);
  });
});

describe('buildVisibleIndexResolver — flat (no grouping) passthrough', () => {
  it('leafIdAt / indexOfLeafId mirror the flat visible-order array 1:1', async () => {
    const ids = ['a', 'b', 'c'];
    const ctx = fakeFlatCtx(ids);
    const resolver = await buildVisibleIndexResolver(ctx);
    expect(resolver.length).toBe(3);
    expect(resolver.leafIdAt(0)).toBe('a');
    expect(resolver.leafIdAt(1)).toBe('b');
    expect(resolver.leafIdAt(2)).toBe('c');
    expect(resolver.indexOfLeafId('a')).toBe(0);
    expect(resolver.indexOfLeafId('c')).toBe(2);
    expect(resolver.indexOfLeafId('missing')).toBe(-1);
    expect(resolver.leafIdAt(-1)).toBeNull();
    expect(resolver.leafIdAt(3)).toBeNull();
  });
});
