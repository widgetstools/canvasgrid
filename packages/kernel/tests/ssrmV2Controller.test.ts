import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ServerSideRowModelV2Controller,
  type SsrmHostV2,
} from '../src/core/serverSideRowModelV2';
import type { IServerSideDatasourceV2, SkeletonGroup } from '../src/types/ssrm';
import type { FilterModel, SortModel } from '../src/types';

/**
 * Sparse SSRM v2 — client-owned group skeleton controller.
 *
 * CSRM-parity invariants under test:
 *  - expansion toggles reflow locally (rowCount updates BEFORE any fetch);
 *  - collapse needs zero datasource calls;
 *  - per-group leaf caches survive toggles (no refetch of unaffected groups);
 *  - soft refresh keeps caches for groups whose leafCount is unchanged.
 */

interface Row {
  id: string;
  g: string;
  v?: number;
}

const BLOCK = 10;

describe('SSRM v2 skeleton controller', () => {
  let skeleton: SkeletonGroup[];
  let leaves: Map<string, Row[]>;
  let expandedKeys: Set<string>;
  let events: Array<[string, ...unknown[]]>;
  let ctrl: ServerSideRowModelV2Controller<Row>;

  const leafRequests = (): Array<[string, ...unknown[]]> =>
    events.filter((e) => e[0] === 'leaves');
  const skeletonRequests = (): Array<[string, ...unknown[]]> =>
    events.filter((e) => e[0] === 'skeleton');
  const hydrates = (): Array<{ startRow: number; ids: string[] }> =>
    events.filter((e) => e[0] === 'hydrate').map((e) => e[1] as { startRow: number; ids: string[] });

  function makeLeaves(prefix: string, n: number): Row[] {
    return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, g: prefix }));
  }

  function makeController(): ServerSideRowModelV2Controller<Row> {
    const host: SsrmHostV2<Row> = {
      getRowId: (r) => r.id,
      getSortModel: () => [] as unknown as SortModel,
      getFilterModel: () => ({}) as FilterModel,
      getRowGroupCols: () => ['g'],
      getExpandedGroupKeys: () => Array.from(expandedKeys),
      setGroupKeys: (keys) => events.push(['groupKeys', keys]),
      setRowCount: (count) => events.push(['rowCount', count]),
      getRefreshRange: () => ({ rowStart: 0, rowEnd: BLOCK }),
      hydrateWindow: async (startRow, rows) => {
        events.push(['hydrate', { startRow, ids: rows.map((r) => r.id) }]);
      },
      applyTransaction: (tx) => events.push(['tx', tx]),
      requestViewport: () => {},
      isDestroyed: () => false,
    };
    const ds: IServerSideDatasourceV2<Row> = {
      getRows: ({ request, success }) => {
        events.push(['flatRows', request.startRow]);
        const all = [...(leaves.get('A') ?? []), ...(leaves.get('B') ?? [])];
        success({
          rowData: all.slice(request.startRow, request.endRow),
          rowCount: all.length,
        });
      },
      getGroupSkeleton: ({ success }) => {
        events.push(['skeleton']);
        success({ groups: skeleton.map((g) => ({ ...g, path: [...g.path] })) });
      },
      getLeafRows: ({ request, success }) => {
        events.push(['leaves', request.groupPath.join('/'), request.startRow]);
        const rows = leaves.get(request.groupPath[0]!) ?? [];
        success({ rowData: rows.slice(request.startRow, request.endRow) });
      },
    };
    const controller = new ServerSideRowModelV2Controller<Row>(host, {
      rowIdField: 'id',
      cacheBlockSize: BLOCK,
    });
    controller.setDatasource(ds);
    return controller;
  }

  beforeEach(() => {
    skeleton = [
      { path: ['A'], leafCount: 100, aggregates: { v: 1000 } },
      { path: ['B'], leafCount: 100, aggregates: { v: 2000 } },
    ];
    leaves = new Map([
      ['A', makeLeaves('a', 100)],
      ['B', makeLeaves('b', 100)],
    ]);
    expandedKeys = new Set();
    events = [];
    ctrl = makeController();
  });

  it('collapsed initial load: one skeleton fetch, zero leaf fetches, group rows hydrated', async () => {
    await ctrl.ensureRange(0, BLOCK);
    expect(skeletonRequests().length).toBe(1);
    expect(leafRequests().length).toBe(0);
    expect(hydrates().at(-1)!.ids).toEqual(['__grp__g:A', '__grp__g:B']);
    expect(ctrl.getRowCount()).toBe(2);
  });

  it('expand reflows locally before any leaf fetch, then fills leaves', async () => {
    await ctrl.ensureRange(0, BLOCK);
    events = [];

    expandedKeys.add('g:A');
    await ctrl.refreshExpansion();

    // The new rowCount (102) lands before the first leaf request — the
    // reflow is local, not a datasource round trip.
    const rowCountAt = events.findIndex((e) => e[0] === 'rowCount' && e[1] === 102);
    const firstLeafAt = events.findIndex((e) => e[0] === 'leaves');
    expect(rowCountAt).toBeGreaterThanOrEqual(0);
    expect(firstLeafAt).toBeGreaterThan(rowCountAt);
    // No skeleton refetch either — expansion is client business.
    expect(skeletonRequests().length).toBe(0);
    // Final band paint: group row + first 9 leaves.
    expect(hydrates().at(-1)!).toEqual({
      startRow: 0,
      ids: ['__grp__g:A', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'],
    });
  });

  it('collapse needs zero datasource calls', async () => {
    expandedKeys.add('g:A');
    await ctrl.ensureRange(0, BLOCK);
    events = [];

    expandedKeys.delete('g:A');
    await ctrl.refreshExpansion();

    expect(skeletonRequests().length).toBe(0);
    expect(leafRequests().length).toBe(0);
    expect(hydrates().at(-1)!.ids).toEqual(['__grp__g:A', '__grp__g:B']);
    expect(ctrl.getRowCount()).toBe(2);
  });

  it('leaf caches survive collapse/re-expand — no refetch', async () => {
    expandedKeys.add('g:A');
    await ctrl.ensureRange(0, BLOCK);
    expect(leafRequests()).toEqual([['leaves', 'A', 0]]);

    expandedKeys.delete('g:A');
    await ctrl.refreshExpansion();
    expandedKeys.add('g:A');
    await ctrl.refreshExpansion();

    // Still exactly one leaf fetch for A block 0.
    expect(leafRequests()).toEqual([['leaves', 'A', 0]]);
    expect(hydrates().at(-1)!.ids.slice(0, 3)).toEqual(['__grp__g:A', 'a1', 'a2']);
  });

  it("toggling one group never refetches another group's cached leaves", async () => {
    expandedKeys.add('g:A').add('g:B');
    await ctrl.ensureRange(0, BLOCK);
    // Scroll to B's territory: A@0, a1..a100@1-100, B@101, b1..b10@102-111.
    await ctrl.ensureRange(100, 112);
    const bFetches = leafRequests().filter((e) => e[1] === 'B');
    expect(bFetches).toEqual([['leaves', 'B', 0]]);

    // Collapse A — B's flattened indices shift by 100 (the v1 stale-cache
    // scenario). B's cache must be reused at the new indices.
    events = [];
    expandedKeys.delete('g:A');
    await ctrl.refreshExpansion();
    await ctrl.ensureRange(0, 12);

    expect(leafRequests().filter((e) => e[1] === 'B')).toEqual([]);
    const last = hydrates().at(-1)!;
    expect(last.ids.slice(0, 4)).toEqual(['__grp__g:A', '__grp__g:B', 'b1', 'b2']);
  });

  it('soft refresh with unchanged structure keeps far caches, refetches band', async () => {
    expandedKeys.add('g:A').add('g:B');
    await ctrl.ensureRange(0, BLOCK);
    await ctrl.ensureRange(100, 112); // B block 0 cached
    events = [];

    skeleton[0]!.aggregates = { v: 1111 }; // aggregate tick, same leafCounts
    await ctrl.refresh({ purge: false });

    expect(skeletonRequests().length).toBe(1);
    // Band (rows 0-9 = A group + a1..a9) refetched A block 0; B untouched.
    expect(leafRequests()).toEqual([['leaves', 'A', 0]]);
    // Structure unchanged — every reported count stays 202 (the real host
    // ignores same-count reports; the mock records them all).
    await ctrl.ensureRange(0, 2);
    expect(events.filter((e) => e[0] === 'rowCount').every((e) => e[1] === 202)).toBe(true);
  });

  it('soft refresh with a changed leafCount drops only that group\'s cache', async () => {
    expandedKeys.add('g:A').add('g:B');
    await ctrl.ensureRange(0, BLOCK);
    await ctrl.ensureRange(100, 112); // caches: A block 0, A block 9, B block 0
    events = [];

    skeleton[0] = { path: ['A'], leafCount: 50, aggregates: { v: 1000 } };
    leaves.set('A', makeLeaves('a', 50));
    await ctrl.refresh({ purge: false });

    // New flattening: A@0, a1..a50@1-50, B@51, b1..b100@52-151.
    expect(ctrl.getRowCount()).toBe(152);
    events = [];
    await ctrl.ensureRange(50, 62); // a50, B, b1..b10
    // A's cache was dropped (leafCount changed) → refetch; B's kept.
    expect(leafRequests()).toEqual([['leaves', 'A', 40]]);
    // (The final hydrate is the sticky ancestor at index 0 — assert the
    // range hydrate itself.)
    const rangeHydrate = hydrates().find((h) => h.startRow === 50);
    expect(rangeHydrate?.ids.slice(0, 3)).toEqual(['a50', '__grp__g:B', 'b1']);
  });

  it('short/empty leaf results stay retryable — no permanent blank leaves', async () => {
    expandedKeys.add('g:A');
    // Server not settled: the leaf query returns nothing while the
    // skeleton already reports 100 leaves. Regression: this was cached as
    // 'loaded' and never refetched — permanently blank leaf rows.
    leaves.set('A', []);
    await ctrl.ensureRange(0, BLOCK);
    expect(leafRequests().filter((e) => e[1] === 'A').length).toBe(1);

    // Server settles; the next range request must RETRY the block.
    leaves.set('A', makeLeaves('a', 100));
    await ctrl.ensureRange(0, BLOCK);
    expect(leafRequests().filter((e) => e[1] === 'A').length).toBe(2);
    expect(hydrates().at(-1)!).toEqual({
      startRow: 0,
      ids: ['__grp__g:A', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'],
    });
  });

  it('window-identity suppression: an unchanged window skips the hydrate entirely', async () => {
    expandedKeys.add('g:A');
    await ctrl.ensureRange(0, BLOCK);
    const before = hydrates().length;
    // Same window, same expansion, same caches — zero worker traffic.
    await ctrl.ensureRange(0, BLOCK);
    expect(hydrates().length).toBe(before);
    // A cache mutation (live tick patch) invalidates the signature.
    ctrl.applyServerSideTransaction({ update: [{ id: 'a1', g: 'A', v: 9 }] });
    await ctrl.ensureRange(0, BLOCK);
    expect(hydrates().length).toBeGreaterThan(before);
  });

  it('adaptive pacing delays a soft refresh by the recent average cost', async () => {
    await ctrl.ensureRange(0, BLOCK);
    const internals = ctrl as unknown as {
      softRefreshDurations: number[];
      lastSoftRefreshEnd: number;
    };
    internals.softRefreshDurations.push(150, 150, 150);
    internals.lastSoftRefreshEnd = Date.now();
    const before = skeletonRequests().length;
    const paced = ctrl.refresh({ purge: false });
    // Well inside the ~150ms pacing window — nothing fetched yet.
    await new Promise((r) => setTimeout(r, 40));
    expect(skeletonRequests().length).toBe(before);
    await paced;
    expect(skeletonRequests().length).toBe(before + 1);
  });

  it('hydrates sticky ancestor group rows above the window', async () => {
    expandedKeys.add('g:A');
    await ctrl.ensureRange(50, 60); // deep inside A's leaves
    // Some hydrate must have placed A's group row at its own index (0).
    expect(hydrates().some((h) => h.startRow === 0 && h.ids[0] === '__grp__g:A')).toBe(true);
  });

  it('flat fallback uses getRows windowing', async () => {
    const flatHost: SsrmHostV2<Row> = {
      getRowId: (r) => r.id,
      getSortModel: () => [] as unknown as SortModel,
      getFilterModel: () => ({}) as FilterModel,
      getRowGroupCols: () => [],
      getExpandedGroupKeys: () => [],
      setRowCount: (count) => events.push(['rowCount', count]),
      getRefreshRange: () => ({ rowStart: 0, rowEnd: BLOCK }),
      hydrateWindow: async (startRow, rows) => {
        events.push(['hydrate', { startRow, ids: rows.map((r) => r.id) }]);
      },
      applyTransaction: () => {},
      requestViewport: () => {},
      isDestroyed: () => false,
    };
    const flat = new ServerSideRowModelV2Controller<Row>(flatHost, {
      rowIdField: 'id',
      cacheBlockSize: BLOCK,
    });
    flat.setDatasource({
      getRows: ({ request, success }) => {
        events.push(['flatRows', request.startRow]);
        const all = makeLeaves('r', 55);
        success({ rowData: all.slice(request.startRow, request.endRow), rowCount: 55 });
      },
      getGroupSkeleton: ({ success }) => success({ groups: [] }),
      getLeafRows: ({ success }) => success({ rowData: [] }),
    });
    events = [];
    await flat.ensureRange(0, BLOCK);
    expect(flat.getRowCount()).toBe(55);
    expect(hydrates().at(-1)!.ids.slice(0, 2)).toEqual(['r1', 'r2']);
    flat.destroy();
  });

  it('B-C4: a flat-range flush after the host is destroyed mid-hydrate does not post again', async () => {
    // `ensureFlatRange` checks staleness ONCE before its multi-post flush
    // loop, not once per `flush()` — the gap `postHydrate` (B-C4) closes.
    // Block 1 fails (empty), which splits the [0,30) window into two
    // contiguous runs (block 0, block 2) and therefore two `flush()` calls.
    // Flipping `isDestroyed()` true from inside the FIRST post must stop
    // the second — only `postHydrate`'s send-time gate can see that,
    // because it re-checks `isDestroyed()` immediately before each send.
    let destroyed = false;
    // `setDatasource` itself enqueues an implicit `refresh({ purge: true })`
    // (its own reset post, plus a band refill of block 0 via
    // `getRefreshRange`) — that unrelated hydrate must not arm the
    // destroy-flip below, or it fires before our own `ensureRange` call
    // even starts. Gate recording/flipping until after that settles.
    let armed = false;
    const hydrateCalls: Array<{ startRow: number; ids: string[] }> = [];
    const flatHost: SsrmHostV2<Row> = {
      getRowId: (r) => r.id,
      getSortModel: () => [] as unknown as SortModel,
      getFilterModel: () => ({}) as FilterModel,
      getRowGroupCols: () => [],
      getExpandedGroupKeys: () => [],
      setRowCount: () => {},
      getRefreshRange: () => ({ rowStart: 0, rowEnd: BLOCK }),
      hydrateWindow: async (startRow, rows) => {
        if (!armed) return;
        hydrateCalls.push({ startRow, ids: rows.map((r) => r.id) });
        destroyed = true;
      },
      applyTransaction: () => {},
      requestViewport: () => {},
      isDestroyed: () => destroyed,
    };
    const flat = new ServerSideRowModelV2Controller<Row>(flatHost, {
      rowIdField: 'id',
      cacheBlockSize: BLOCK,
    });
    const all = makeLeaves('r', 100);
    flat.setDatasource({
      getRows: ({ request, success, fail }) => {
        const blockIdx = Math.floor(request.startRow / BLOCK);
        if (blockIdx === 1) {
          fail();
          return;
        }
        success({ rowData: all.slice(request.startRow, request.endRow), rowCount: 100 });
      },
      getGroupSkeleton: ({ success }) => success({ groups: [] }),
      getLeafRows: ({ success }) => success({ rowData: [] }),
    });
    // Drain the implicit purge (chain-serialized ahead of anything below).
    await flat.ensureRange(0, BLOCK);

    armed = true;
    await flat.ensureRange(0, 3 * BLOCK);

    expect(hydrateCalls.length).toBe(1);
    expect(hydrateCalls[0]?.startRow).toBe(0);
    expect(hydrateCalls[0]?.ids.slice(0, 2)).toEqual(['r1', 'r2']);
  });

  it('B-C6: a leaf reply that lands after dropGroupCache still reaches the LIVE map', async () => {
    // dropGroupCache deletes the per-group Map from `leafCaches` (a soft
    // refresh whose skeleton found this group's leafCount changed). A leaf
    // fetch already in flight for that group must not write its reply into
    // the now-detached Map object — that reply would be invisible to every
    // future `ensureRange` (silent data loss + a redundant re-fetch).
    let holdLeafSuccess: (() => void) | null = null;
    const local = new ServerSideRowModelV2Controller<Row>(
      {
        getRowId: (r) => r.id,
        getSortModel: () => [] as unknown as SortModel,
        getFilterModel: () => ({}) as FilterModel,
        getRowGroupCols: () => ['g'],
        getExpandedGroupKeys: () => ['g:A'],
        setRowCount: () => {},
        getRefreshRange: () => ({ rowStart: 0, rowEnd: BLOCK }),
        hydrateWindow: async () => {},
        applyTransaction: () => {},
        requestViewport: () => {},
        isDestroyed: () => false,
      },
      { rowIdField: 'id', cacheBlockSize: BLOCK },
    );
    local.setDatasource({
      getRows: ({ success }) => success({ rowData: [], rowCount: 0 }),
      getGroupSkeleton: ({ success }) => success({ groups: [{ path: ['A'], leafCount: 100, aggregates: {} }] }),
      getLeafRows: ({ request, success }) => {
        // Hold the reply instead of answering synchronously — this is the
        // "leaf fetch in flight" window the finding describes.
        const rows = makeLeaves('a', 100).slice(request.startRow, request.endRow);
        holdLeafSuccess = () => success({ rowData: rows });
      },
    });

    interface Internals {
      leafCaches: Map<string, Map<number, { rows: Row[]; state: string; touch: number }>>;
      skeleton: Array<{ key: string; path: string[]; leafCount: number }> | null;
      dropGroupCache: (key: string) => void;
    }
    const internals = local as unknown as Internals;

    const ensureP = local.ensureRange(0, BLOCK);
    // Let the (synchronously-answered) skeleton fetch and the enqueue/await
    // plumbing drain so the leaf fetch actually starts and parks on
    // `holdLeafSuccess` before we inspect state.
    await new Promise((r) => setTimeout(r, 0));
    expect(holdLeafSuccess).not.toBeNull();
    expect(internals.leafCaches.get('g:A')?.get(0)?.state).toBe('loading');

    // Simulate the race: the group's cache gets dropped WHILE its leaf
    // fetch is still outstanding.
    internals.dropGroupCache('g:A');
    expect(internals.leafCaches.has('g:A')).toBe(false);

    // Now let the outstanding fetch resolve.
    holdLeafSuccess!();
    await ensureP;

    const liveBlock = internals.leafCaches.get('g:A')?.get(0);
    expect(liveBlock?.state).toBe('loaded');
    expect(liveBlock?.rows.map((r) => r.id).slice(0, 3)).toEqual(['a1', 'a2', 'a3']);

    local.destroy();
  });

  it('B-C8: failed blocks retry with exponential backoff (1s/4s/15s), not on every ensureRange', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const local = new ServerSideRowModelV2Controller<Row>(
        {
          getRowId: (r) => r.id,
          getSortModel: () => [] as unknown as SortModel,
          getFilterModel: () => ({}) as FilterModel,
          getRowGroupCols: () => ['g'],
          getExpandedGroupKeys: () => ['g:A'],
          setRowCount: () => {},
          getRefreshRange: () => ({ rowStart: 0, rowEnd: BLOCK }),
          hydrateWindow: async () => {},
          applyTransaction: () => {},
          requestViewport: () => {},
          isDestroyed: () => false,
        },
        { rowIdField: 'id', cacheBlockSize: BLOCK },
      );
      local.setDatasource({
        getRows: ({ success }) => success({ rowData: [], rowCount: 0 }),
        getGroupSkeleton: ({ success }) => success({ groups: [{ path: ['A'], leafCount: 100, aggregates: {} }] }),
        getLeafRows: ({ fail, success }) => {
          calls++;
          // First two attempts fail; the third succeeds.
          if (calls < 3) fail();
          else success({ rowData: makeLeaves('a', 100).slice(0, BLOCK) });
        },
      });

      await local.ensureRange(0, BLOCK);
      expect(calls).toBe(1);

      // Immediately re-requesting the SAME window must NOT retry — still
      // inside the 1s backoff window from the first failure.
      await local.ensureRange(0, BLOCK);
      expect(calls).toBe(1);

      // Just under the 1s mark — still gated.
      await vi.advanceTimersByTimeAsync(999);
      await local.ensureRange(0, BLOCK);
      expect(calls).toBe(1);

      // Cross the 1s mark — retry #2 fires (fails again, schedules a 4s
      // backoff this time).
      await vi.advanceTimersByTimeAsync(2);
      await local.ensureRange(0, BLOCK);
      expect(calls).toBe(2);

      // Immediately after — still inside the 4s window from failure #2.
      await local.ensureRange(0, BLOCK);
      expect(calls).toBe(2);
      await vi.advanceTimersByTimeAsync(3000);
      await local.ensureRange(0, BLOCK);
      expect(calls).toBe(2);

      // Cross the 4s mark — retry #3 fires and succeeds.
      await vi.advanceTimersByTimeAsync(1001);
      await local.ensureRange(0, BLOCK);
      expect(calls).toBe(3);

      const internals = local as unknown as {
        leafCaches: Map<string, Map<number, { state: string; failCount: number; nextRetryAt: number }>>;
      };
      const block = internals.leafCaches.get('g:A')?.get(0);
      expect(block?.state).toBe('loaded');
      expect(block?.failCount).toBe(0);
      expect(block?.nextRetryAt).toBe(0);

      // A further ensureRange must NOT re-fetch a now-loaded block.
      await local.ensureRange(0, BLOCK);
      expect(calls).toBe(3);

      local.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('B-P5: waitUntil wakes on the triggering event, not by polling — resolves with fake timers frozen', async () => {
    vi.useFakeTimers();
    try {
      const held: Array<() => void> = [];
      let leafCalls = 0;
      const local = new ServerSideRowModelV2Controller<Row>(
        {
          getRowId: (r) => r.id,
          getSortModel: () => [] as unknown as SortModel,
          getFilterModel: () => ({}) as FilterModel,
          getRowGroupCols: () => ['g'],
          getExpandedGroupKeys: () => ['g:A'],
          setRowCount: () => {},
          getRefreshRange: () => ({ rowStart: 0, rowEnd: 30 }),
          hydrateWindow: async () => {},
          applyTransaction: () => {},
          requestViewport: () => {},
          isDestroyed: () => false,
        },
        { rowIdField: 'id', cacheBlockSize: 10, maxConcurrentDatasourceRequests: 1 },
      );
      local.setDatasource({
        getRows: ({ success }) => success({ rowData: [], rowCount: 0 }),
        getGroupSkeleton: ({ success }) => success({ groups: [{ path: ['A'], leafCount: 30, aggregates: {} }] }),
        getLeafRows: ({ request, success }) => {
          leafCalls++;
          // Hold every reply — nothing here ever resolves on its own.
          held.push(() => success({
            rowData: makeLeaves('a', 30).slice(request.startRow, request.endRow),
          }));
        },
      });

      // Flush pending microtasks without ever advancing the (frozen) fake
      // clock — the only way anything here can progress is `wakeWaiters()`.
      const settle = async (): Promise<void> => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      };

      const ensureP = local.ensureRange(0, 30); // 3 blocks needed (0,10,20)
      await settle();
      // maxConcurrentDatasourceRequests: 1 — only block 0's fetch has
      // started; blocks 1 and 2 are queued on the concurrency-slot waiter.
      expect(leafCalls).toBe(1);

      held[0]!();
      await settle();
      expect(leafCalls).toBe(2);

      held[1]!();
      await settle();
      expect(leafCalls).toBe(3);

      held[2]!();
      await ensureP;
      expect(leafCalls).toBe(3);

      local.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('B-P5: destroy drains every queued slot waiter — no leaked waiters', async () => {
    const held: Array<() => void> = [];
    const local = new ServerSideRowModelV2Controller<Row>(
      {
        getRowId: (r) => r.id,
        getSortModel: () => [] as unknown as SortModel,
        getFilterModel: () => ({}) as FilterModel,
        getRowGroupCols: () => ['g'],
        getExpandedGroupKeys: () => ['g:A'],
        setRowCount: () => {},
        getRefreshRange: () => ({ rowStart: 0, rowEnd: 30 }),
        hydrateWindow: async () => {},
        applyTransaction: () => {},
        requestViewport: () => {},
        isDestroyed: () => false,
      },
      { rowIdField: 'id', cacheBlockSize: 10, maxConcurrentDatasourceRequests: 1 },
    );
    local.setDatasource({
      getRows: ({ success }) => success({ rowData: [], rowCount: 0 }),
      getGroupSkeleton: ({ success }) => success({ groups: [{ path: ['A'], leafCount: 30, aggregates: {} }] }),
      getLeafRows: ({ request, success }) => {
        held.push(() => success({
          rowData: makeLeaves('a', 30).slice(request.startRow, request.endRow),
        }));
      },
    });

    // Deliberately not awaited (or even attached with .catch — a plain
    // pending promise never triggers Node's unhandled-rejection warning):
    // block 0's fetch is held forever by design, so the OUTER
    // `ensureRangeInner`'s `Promise.all([block0, block1, block2])` can
    // never settle either way — that's an external datasource that never
    // calls back, not something any client-side fix can force to
    // complete. What THIS controller owns and must not leak is the
    // internal slot-waiter queue for blocks 1 and 2, queued behind block
    // 0 on the concurrency cap (`maxConcurrentDatasourceRequests: 1`).
    void local.ensureRange(0, 30);
    await new Promise((r) => setTimeout(r, 0));

    const internals = local as unknown as { waiters: Set<unknown>; slotWaiters: unknown[] };
    expect(internals.slotWaiters.length).toBe(2);

    local.destroy();
    // Slot waiters are drained SYNCHRONOUSLY inside destroy() — no await
    // needed, and no dependency on block 0's fetch ever calling back.
    expect(internals.waiters.size).toBe(0);
    expect(internals.slotWaiters.length).toBe(0);
  });
});
