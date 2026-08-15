/**
 * VelocityGrid production hardening — final whole-branch review follow-ups.
 *
 * ensureFullyHydrated-truncation: a book larger than
 *   `maxCachedLeafBlocks × blockSize` LRU-evicts its own earlier blocks
 *   during the sequential full hydrate. The row-collection loop then breaks
 *   at the first hole (often i=0, yielding an EMPTY collection) and used to
 *   report success regardless — `enableSsrmClientPipeline` would proceed
 *   over a silently truncated book. `ensureFullyHydrated` must return
 *   `false` whenever the collected row count is short of `flatRowCount`.
 *
 * flat-wakeWaiters: the grouped-path `run()`'s early bail (stale gen /
 *   destroyed) calls `wakeWaiters()` before resolving so a waiter coalesced
 *   onto that exact block doesn't sit until an unrelated `destroy()` bump.
 *   The flat-path twin lacked the call — same latent-hang shape, and Task 10
 *   made the flat path the DEFAULT for every getRows-only datasource.
 */
import { describe, it, expect } from 'vitest';
import {
  ServerSideRowModelV2Controller,
  type SsrmHostV2,
} from '../src/core/serverSideRowModelV2';
import type { FilterModel, SortModel } from '../src/types';

interface Row { id: string; v: number }

const BLOCK = 10;

function makeFlatRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, v: i }));
}

function makeFlatHost(events: unknown[][]): SsrmHostV2<Row> {
  return {
    getRowId: (r) => r.id,
    getSortModel: () => [] as unknown as SortModel,
    getFilterModel: () => ({}) as FilterModel,
    getRowGroupCols: () => [],
    getExpandedGroupKeys: () => [],
    setRowCount: (count) => events.push(['rowCount', count]),
    getRefreshRange: () => ({ rowStart: 0, rowEnd: BLOCK }),
    hydrateWindow: async (startRow, rows, rowCount) => {
      events.push(['hydrate', { startRow, count: rows.length, rowCount }]);
    },
    applyTransaction: () => {},
    requestViewport: () => {},
    isDestroyed: () => false,
  };
}

describe('ensureFullyHydrated reports truncation honestly', () => {
  it('returns true and hydrates the full book when it fits under the cache', async () => {
    const events: unknown[][] = [];
    const flat = new ServerSideRowModelV2Controller<Row>(makeFlatHost(events), {
      rowIdField: 'id',
      cacheBlockSize: BLOCK,
      maxCachedLeafBlocks: 20, // book is 5 blocks — comfortably under cap
    });
    const book = makeFlatRows(50);
    flat.setDatasource({
      getRows: ({ request, success }) => {
        success({ rowData: book.slice(request.startRow, request.endRow), rowCount: book.length });
      },
      getGroupSkeleton: ({ success }) => success({ groups: [] }),
      getLeafRows: ({ success }) => success({ rowData: [] }),
    });

    const hydrated = await flat.ensureFullyHydrated();
    expect(hydrated).toBe(true);

    const lastHydrate = events.filter((e) => e[0] === 'hydrate').at(-1) as
      | [string, { count: number; rowCount: number }]
      | undefined;
    expect(lastHydrate?.[1].count).toBe(50);
    expect(lastHydrate?.[1].rowCount).toBe(50);

    flat.destroy();
  });

  it('returns false when the sequential hydrate evicts its own earlier blocks', async () => {
    // 8 blocks (the floor `maxCachedLeafBlocks`) against a 20-block book —
    // by the time the collection loop walks block 0 the LRU has already
    // dropped it in favour of later blocks, so the loop breaks at i=0 and
    // `rows` is empty. Reporting `true` here is exactly the silent-wrong-
    // data bug ensureFullyHydrated must not reproduce.
    const events: unknown[][] = [];
    const flat = new ServerSideRowModelV2Controller<Row>(makeFlatHost(events), {
      rowIdField: 'id',
      cacheBlockSize: BLOCK,
      maxCachedLeafBlocks: 8,
    });
    const book = makeFlatRows(200);
    flat.setDatasource({
      getRows: ({ request, success }) => {
        success({ rowData: book.slice(request.startRow, request.endRow), rowCount: book.length });
      },
      getGroupSkeleton: ({ success }) => success({ groups: [] }),
      getLeafRows: ({ success }) => success({ rowData: [] }),
    });

    const hydrated = await flat.ensureFullyHydrated();
    expect(hydrated).toBe(false);

    // The truncated collection is still posted (so the mirror stays in sync
    // with whatever the store actually holds) — it just must not be
    // reported as a successful FULL hydrate.
    const lastHydrate = events.filter((e) => e[0] === 'hydrate').at(-1) as
      | [string, { count: number; rowCount: number }]
      | undefined;
    expect(lastHydrate?.[1].count).toBeLessThan(200);
    expect(lastHydrate?.[1].rowCount).toBe(200);

    flat.destroy();
  });

  it('an empty book (rowCount 0) is a legitimate hydrate, not a truncation', async () => {
    const events: unknown[][] = [];
    const flat = new ServerSideRowModelV2Controller<Row>(makeFlatHost(events), {
      rowIdField: 'id',
      cacheBlockSize: BLOCK,
    });
    flat.setDatasource({
      getRows: ({ success }) => success({ rowData: [], rowCount: 0 }),
      getGroupSkeleton: ({ success }) => success({ groups: [] }),
      getLeafRows: ({ success }) => success({ rowData: [] }),
    });

    expect(await flat.ensureFullyHydrated()).toBe(true);
    flat.destroy();
  });
});

describe('flat-path loadFlatBlock wakes waiters on its stale/destroyed early bail', () => {
  it('a coalesced waiter is woken when the queued fetch it is waiting on bails on isDestroyed()', async () => {
    // `ensureRange` (the public API) chain-serializes every call through
    // `enqueue()`, so two top-level calls never overlap — this scenario is
    // reached from a SINGLE range spanning multiple blocks, where
    // `maxConcurrentDatasourceRequests: 1` forces block 1's fetch through
    // `acquireSlot(gen).then(run)` — genuinely queued, `run()` not invoked
    // until block 0's slot frees. That gap is real async time in which
    // `isDestroyed()` can flip WITHOUT a `dataGen` bump (a `gen` bump
    // already gets swept by `wakeOnGenChange`'s own broadcast — this is
    // specifically the "destroyed, gen unchanged" case the fix targets).
    // Reaching the coalesced-waiter half of the scenario needs a SECOND,
    // independent request for the same block while it's still 'loading' —
    // exercised here by calling the private `loadFlatBlock` directly
    // (mirroring the existing B-C6 internals-access pattern above), since
    // the public API's serialization can't produce two concurrent callers
    // on the same block.
    const events: unknown[][] = [];
    let releaseBlock0: (() => void) | null = null;
    let destroyed = false;
    const host: SsrmHostV2<Row> = {
      ...makeFlatHost(events),
      isDestroyed: () => destroyed,
    };
    const flat = new ServerSideRowModelV2Controller<Row>(host, {
      rowIdField: 'id',
      cacheBlockSize: BLOCK,
      maxConcurrentDatasourceRequests: 1,
    });
    const book = makeFlatRows(30);
    flat.setDatasource({
      getRows: ({ request, success }) => {
        if (request.startRow === 0) {
          // Hold block 0 open so block 1's fetch is forced into the slot
          // queue rather than dispatching `run()` synchronously.
          releaseBlock0 = () => success({ rowData: book.slice(0, BLOCK), rowCount: book.length });
          return;
        }
        // Block 1's real fetch must never actually run in this scenario —
        // it is meant to bail on isDestroyed() before getRows is reached.
        success({ rowData: book.slice(request.startRow, request.endRow), rowCount: book.length });
      },
      getGroupSkeleton: ({ success }) => success({ groups: [] }),
      getLeafRows: ({ success }) => success({ rowData: [] }),
    });

    interface Internals {
      dataGen: number;
      loadFlatBlock: (blockIdx: number, gen: number, force?: boolean) => Promise<void>;
    }
    const internals = flat as unknown as Internals;
    const gen = internals.dataGen;

    // Occupy the single concurrency slot with block 0 (held open) — direct
    // internals call, bypassing the `enqueue` chain entirely.
    const p0 = internals.loadFlatBlock(0, gen);

    // Block 1: sets cache to 'loading' immediately, then queues `run()`
    // behind the occupied slot (does NOT invoke getRows yet).
    void internals.loadFlatBlock(1, gen);

    // A SEPARATE caller for the SAME block 1 now coalesces onto the
    // 'loading' entry via `waitUntil` — this is the waiter under test.
    const coalesced = internals.loadFlatBlock(1, gen);

    // Flip destroyed WITHOUT bumping dataGen — the specific case that has
    // no other wake path.
    destroyed = true;

    // Free the slot: block 0 resolves, `releaseSlot()` hands the slot to
    // block 1's queued `run()`, which fires on the next microtask tick and
    // must take the destroyed-bail branch.
    releaseBlock0!();
    await p0;

    // The coalesced waiter must settle. Pre-fix, the flat-path bail did not
    // call `wakeWaiters()`, so this would hang until the suite's own
    // timeout — bound it explicitly so a regression fails loudly with a
    // clear message instead of a generic test-runner timeout.
    await Promise.race([
      coalesced,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('coalesced waiter was never woken — flat-path run() bail did not call wakeWaiters()')),
        1500,
      )),
    ]);

    flat.destroy();
  });
});
