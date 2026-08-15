import { describe, it, expect, vi } from 'vitest';
import {
  ServerSideRowModelV2Controller,
  type SsrmDatasource,
  type SsrmHostV2,
} from '../src/core/serverSideRowModelV2';
import type { FilterModel, SortModel } from '../src/types';

/**
 * SSRM v2 flat path — infinite scroll against a datasource that never
 * declares `rowCount` (B-C3), plus the `serverSideMaxCachedLeafBlocks` cap.
 *
 * Before the fix the inferred count was exactly `startRow + rowData.length`,
 * i.e. the loaded edge — the viewport could never scroll into unloaded
 * territory, so the next block was never requested and the grid dead-ended
 * at the first block. The controller now over-allocates ONE block past the
 * loaded edge while the total is unknown, and clamps to the exact count when
 * a short window pins the end of the book.
 */

interface Row {
  id: string;
}

const BLOCK = 10;

interface Harness {
  ctrl: ServerSideRowModelV2Controller<Row>;
  requests: number[];
  counts: number[];
}

function makeHarness(opts: {
  total: number;
  declareRowCount: boolean;
  maxCachedLeafBlocks?: number;
}): Harness {
  const requests: number[] = [];
  const counts: number[] = [];
  const book: Row[] = Array.from({ length: opts.total }, (_, i) => ({ id: `r${i}` }));

  const host: SsrmHostV2<Row> = {
    getRowId: (r) => r.id,
    getSortModel: () => [] as unknown as SortModel,
    getFilterModel: () => ({}) as FilterModel,
    getRowGroupCols: () => [],
    getExpandedGroupKeys: () => [],
    setRowCount: (count) => { counts.push(count); },
    getRefreshRange: () => ({ rowStart: 0, rowEnd: BLOCK }),
    hydrateWindow: async () => {},
    applyTransaction: () => {},
    requestViewport: () => {},
    isDestroyed: () => false,
  };

  const ds: SsrmDatasource<Row> = {
    getRows: ({ request, success }) => {
      requests.push(request.startRow);
      const rowData = book.slice(request.startRow, request.endRow);
      success(opts.declareRowCount ? { rowData, rowCount: book.length } : { rowData });
    },
  };

  const ctrl = new ServerSideRowModelV2Controller<Row>(host, {
    rowIdField: 'id',
    cacheBlockSize: BLOCK,
    ...(opts.maxCachedLeafBlocks !== undefined
      ? { maxCachedLeafBlocks: opts.maxCachedLeafBlocks }
      : {}),
  });
  ctrl.setDatasource(ds);
  return { ctrl, requests, counts };
}

describe('SSRM v2 flat — unknown rowCount', () => {
  it('over-allocates one block past the loaded edge so scrolling can continue', async () => {
    const { ctrl, requests } = makeHarness({ total: 35, declareRowCount: false });

    await ctrl.ensureRange(0, BLOCK);

    // 10 rows loaded, but the reported count reaches into the NEXT block —
    // that headroom is what lets the viewport scroll far enough to ask for it.
    expect(requests).toEqual([0]);
    expect(ctrl.getRowCount()).toBe(BLOCK * 2);
    expect(ctrl.isRowCountEstimated()).toBe(true);

    // Scrolling to the reported edge fires the next block's request.
    await ctrl.ensureRange(BLOCK, BLOCK * 2);
    expect(requests).toEqual([0, 10]);
    expect(ctrl.getRowCount()).toBe(BLOCK * 3);
  });

  it('a short final block clamps the count exactly and stops further requests', async () => {
    const { ctrl, requests } = makeHarness({ total: 35, declareRowCount: false });

    // Drive it the way a viewport would: keep jumping to the bottom of
    // whatever the controller currently reports until the count settles.
    let guard = 0;
    let prev = -1;
    while (ctrl.getRowCount() !== prev && guard++ < 20) {
      prev = ctrl.getRowCount();
      await ctrl.ensureRange(Math.max(0, prev - BLOCK), prev);
    }

    // Block 3 came back short (5 of 10) → end of book, pinned exactly.
    expect(ctrl.getRowCount()).toBe(35);
    expect(ctrl.isRowCountEstimated()).toBe(false);
    expect(requests).toEqual([0, 10, 20, 30]);

    // No over-allocation past a known end: re-covering the book is all cache.
    requests.length = 0;
    await ctrl.ensureRange(0, ctrl.getRowCount());
    expect(requests).toEqual([]);
  });

  it('an empty first block pins the count at zero', async () => {
    const { ctrl, requests } = makeHarness({ total: 0, declareRowCount: false });

    await ctrl.ensureRange(0, BLOCK);

    expect(requests).toEqual([0]);
    expect(ctrl.getRowCount()).toBe(0);
    expect(ctrl.isRowCountEstimated()).toBe(false);
  });

  it('a declared rowCount is never over-allocated', async () => {
    const { ctrl, requests, counts } = makeHarness({ total: 25, declareRowCount: true });

    await ctrl.ensureRange(0, BLOCK);

    expect(ctrl.getRowCount()).toBe(25);
    expect(ctrl.isRowCountEstimated()).toBe(false);
    expect(counts).toEqual([25]);

    // A full mid-book block must not re-inflate a known total.
    await ctrl.ensureRange(10, 20);
    expect(ctrl.getRowCount()).toBe(25);
    expect(requests).toEqual([0, 10]);
  });

  /**
   * fix-wave-4 Q2 — `flatRowCountExact` used to be one boolean for two
   * provenances (a declared total vs. an inferred short-window clamp). Once
   * true it was permanently one-way, so a transient short reply (server
   * still settling) silently truncated the book forever. Only a DECLARED
   * count may stay one-way; an INFERRED one must re-inflate on the next
   * full-window reply.
   */
  it('a transient short reply recovers on the next full-window fetch (not permanently truncated)', async () => {
    const requests: number[] = [];
    const book: Row[] = Array.from({ length: 35 }, (_, i) => ({ id: `r${i}` }));
    // Explicit one-shot trigger rather than a call counter — `setDatasource`
    // itself fires an internal (fire-and-forget) purge refresh over the same
    // band, and a counter would race it non-deterministically.
    let scriptShortReply = false;

    const host: SsrmHostV2<Row> = {
      getRowId: (r) => r.id,
      getSortModel: () => [] as unknown as SortModel,
      getFilterModel: () => ({}) as FilterModel,
      getRowGroupCols: () => [],
      getExpandedGroupKeys: () => [],
      setRowCount: () => {},
      getRefreshRange: () => ({ rowStart: 0, rowEnd: BLOCK }),
      hydrateWindow: async () => {},
      applyTransaction: () => {},
      requestViewport: () => {},
      isDestroyed: () => false,
    };
    const ds: SsrmDatasource<Row> = {
      getRows: ({ request, success }) => {
        requests.push(request.startRow);
        if (request.startRow === 0 && scriptShortReply) {
          // Transient: the server is still settling and replies short even
          // though the book actually holds far more rows at this offset.
          // No declared `rowCount` — an unknown-count datasource.
          scriptShortReply = false;
          success({ rowData: book.slice(0, 4) });
          return;
        }
        success({ rowData: book.slice(request.startRow, request.endRow) });
      },
    };
    const ctrl = new ServerSideRowModelV2Controller<Row>(host, {
      rowIdField: 'id',
      cacheBlockSize: BLOCK,
    });
    ctrl.setDatasource(ds);

    // Let the datasource-mount purge refresh (fire-and-forget, internal to
    // `setDatasource`) settle with an ordinary full reply first, so it
    // cannot race the scripted short reply below.
    await ctrl.ensureRange(0, BLOCK);
    expect(ctrl.getRowCount()).toBeGreaterThan(0);

    // Force a fresh fetch of block 0 that comes back short this time.
    scriptShortReply = true;
    await ctrl.refresh({ purge: false });
    // The short reply pins an INFERRED (not declared) end-of-book guess.
    expect(ctrl.getRowCount()).toBe(4);
    expect(ctrl.isRowCountEstimated()).toBe(false);

    // Soft refresh again; this time the block settles and comes back full.
    await ctrl.refresh({ purge: false });

    // The inferred clamp re-inflates — it was never a declared fact.
    expect(ctrl.getRowCount()).toBeGreaterThan(4);
    expect(ctrl.isRowCountEstimated()).toBe(true);
  });

  it('a genuinely growing book re-inflates a previously-inferred count', async () => {
    const requests: number[] = [];
    let book: Row[] = Array.from({ length: 24 }, (_, i) => ({ id: `r${i}` }));

    const host: SsrmHostV2<Row> = {
      getRowId: (r) => r.id,
      getSortModel: () => [] as unknown as SortModel,
      getFilterModel: () => ({}) as FilterModel,
      getRowGroupCols: () => [],
      getExpandedGroupKeys: () => [],
      setRowCount: () => {},
      // Targets the block that pins the (about to be stale) inferred edge.
      getRefreshRange: () => ({ rowStart: 20, rowEnd: 30 }),
      hydrateWindow: async () => {},
      applyTransaction: () => {},
      requestViewport: () => {},
      isDestroyed: () => false,
    };
    const ds: SsrmDatasource<Row> = {
      getRows: ({ request, success }) => {
        requests.push(request.startRow);
        success({ rowData: book.slice(request.startRow, request.endRow) });
      },
    };
    const ctrl = new ServerSideRowModelV2Controller<Row>(host, {
      rowIdField: 'id',
      cacheBlockSize: BLOCK,
    });
    ctrl.setDatasource(ds);

    // Drive it the way a viewport would, same as the "short final block"
    // scenario above — settles once block 2 (20-30) comes back short.
    let guard = 0;
    let prev = -1;
    while (ctrl.getRowCount() !== prev && guard++ < 20) {
      prev = ctrl.getRowCount();
      await ctrl.ensureRange(Math.max(0, prev - BLOCK), prev);
    }
    expect(ctrl.getRowCount()).toBe(24);
    expect(ctrl.isRowCountEstimated()).toBe(false);

    // The book genuinely grows server-side — 20 more rows appended.
    book = [...book, ...Array.from({ length: 20 }, (_, i) => ({ id: `r${24 + i}` }))];

    // A soft refresh re-fetches the previously-short block; it is now full.
    await ctrl.refresh({ purge: false });

    expect(ctrl.getRowCount()).toBe(40);
    expect(ctrl.isRowCountEstimated()).toBe(true);
  });
});

describe('SSRM v2 flat — serverSideMaxCachedLeafBlocks', () => {
  it('bounds the block cache, evicting least-recently-touched blocks', async () => {
    // 8 is the controller's floor for the cap; the book is 12 blocks.
    const { ctrl, requests } = makeHarness({
      total: 120,
      declareRowCount: true,
      maxCachedLeafBlocks: 8,
    });

    for (let b = 0; b < 12; b++) {
      await ctrl.ensureRange(b * BLOCK, (b + 1) * BLOCK);
    }
    expect(requests).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]);

    // Block 0 is the least recently touched — evicted, so it refetches.
    requests.length = 0;
    await ctrl.ensureRange(0, BLOCK);
    expect(requests).toEqual([0]);
  });

  it('keeps every block when the cap is not reached', async () => {
    const { ctrl, requests } = makeHarness({ total: 120, declareRowCount: true });

    for (let b = 0; b < 12; b++) {
      await ctrl.ensureRange(b * BLOCK, (b + 1) * BLOCK);
    }

    requests.length = 0;
    await ctrl.ensureRange(0, BLOCK);
    expect(requests).toEqual([]);
  });

  // fix-wave-4 Q8 — a configured cap below the floor is silently clamped to
  // 8 (JSDoc-disclosed, not a defect); a console.warn on construction is
  // strictly better than silence and cheap.
  it('warns once and still clamps to the floor (8) when configured below it', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { ctrl, requests } = makeHarness({
        total: 120,
        declareRowCount: true,
        maxCachedLeafBlocks: 2,
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('serverSideMaxCachedLeafBlocks');

      for (let b = 0; b < 12; b++) {
        await ctrl.ensureRange(b * BLOCK, (b + 1) * BLOCK);
      }
      requests.length = 0;
      // Block 7 is inside the 8 most-recently-touched blocks — if the raw
      // configured value (2) had been used instead of the floor, only
      // blocks 10-11 would still be cached and this would refetch too.
      await ctrl.ensureRange(70, 80);
      expect(requests).toEqual([]);
      // Block 0 is outside the floor-8 window — evicted either way.
      await ctrl.ensureRange(0, BLOCK);
      expect(requests).toEqual([0]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // Fix wave 6 — the B-L2 plan assumed evicted rows are always outside the
  // loaded band "by construction"; that does not hold. A single
  // `ensureRange` call that itself spans more leaf blocks than the cap
  // forces `evictIfNeeded` (called after each block's load) to evict a
  // block still inside THAT SAME band — rows that were about to paint go
  // blank until the next viewport request. Pre-fix this was untested and
  // silent; `warnInBandEviction` makes it observable, once per controller.
  it('warns once when a single ensureRange call spans more leaf blocks than the cap', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { ctrl } = makeHarness({
        total: 200,
        declareRowCount: true,
        maxCachedLeafBlocks: 8,
      });

      // Exactly at the cap — not exceeding it — must not warn.
      await ctrl.ensureRange(0, BLOCK * 8);
      expect(warnSpy).not.toHaveBeenCalled();

      // One call spanning 10 blocks against an 8-block cap: in-band
      // eviction is possible within this very request.
      await ctrl.ensureRange(0, BLOCK * 10);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('serverSideMaxCachedLeafBlocks');
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('10');

      // Once per controller lifetime, not once per offending call.
      await ctrl.ensureRange(0, BLOCK * 15);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
