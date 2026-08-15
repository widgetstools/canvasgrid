import { describe, it, expect } from 'vitest';
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
    getGroupKeys: () => [],
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
});
