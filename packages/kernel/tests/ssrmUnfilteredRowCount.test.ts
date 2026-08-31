import { describe, it, expect } from 'vitest';
import {
  ServerSideRowModelV2Controller,
  type SsrmDatasource,
  type SsrmHostV2,
} from '../src/core/serverSideRowModelV2';
import type { FilterModel, SortModel } from '../src/types';

/**
 * SSRM `Total Rows` — the unfiltered book size, which only a datasource can
 * know.
 *
 * The status bar's combined panel reads `getTotalRowCount()` and
 * `getDisplayedRowCount()`. Server-side, the first used to return the same
 * `rowCount` as the second, so filtering 5,000 rows down to 3,337 printed
 * "Total Rows: 3,337  Rows: 3,337" — two labels, one number, and no way to
 * tell the book had been filtered at all.
 *
 * A reply now carries `unfilteredRowCount` alongside the (post-filter)
 * `rowCount`. The rules that matter are which replies carry it, and — more
 * subtly — which resets are allowed to forget it.
 */

interface Row { id: string }

const BLOCK = 10;

function makeHarness(opts: { total: number; matching: number; declareUnfiltered?: boolean }) {
  const statusBarRefreshes: number[] = [];
  let seq = 0;
  const book: Row[] = Array.from({ length: opts.matching }, (_, i) => ({ id: `r${i}` }));

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
    refreshStatusBar: () => { statusBarRefreshes.push(++seq); },
  };

  const ds: SsrmDatasource<Row> = {
    getRows: ({ request, success }) => {
      const rowData = book.slice(request.startRow, request.endRow);
      success({
        rowData,
        rowCount: book.length,
        ...(opts.declareUnfiltered === false ? {} : { unfilteredRowCount: opts.total }),
      });
    },
  };

  const ctrl = new ServerSideRowModelV2Controller<Row>(host, { blockSize: BLOCK });
  return { ctrl, ds, statusBarRefreshes };
}

describe('SSRM unfiltered row count backs Total Rows', () => {
  it('is null before any reply — the grid falls back to the filtered count', () => {
    const { ctrl } = makeHarness({ total: 5000, matching: 3337 });
    expect(ctrl.getUnfilteredRowCount()).toBeNull();
  });

  it('latches what the datasource declares, not the filtered count', async () => {
    const { ctrl, ds } = makeHarness({ total: 5000, matching: 3337 });
    ctrl.setDatasource(ds);
    await ctrl.ensureRange(0, BLOCK);

    expect(ctrl.getUnfilteredRowCount()).toBe(5000);
    // The distinction the bug was missing: these are different numbers.
    expect(ctrl.getRowCount()).toBe(3337);
  });

  it('stays null when the datasource declares nothing', async () => {
    const { ctrl, ds } = makeHarness({ total: 5000, matching: 3337, declareUnfiltered: false });
    ctrl.setDatasource(ds);
    await ctrl.ensureRange(0, BLOCK);
    // Null, not 0 — the caller must be able to tell "unknown" from "empty"
    // so it can fall back rather than print Total Rows: 0.
    expect(ctrl.getUnfilteredRowCount()).toBeNull();
  });

  it('refreshes the status bar when it changes, and not on every block', async () => {
    const { ctrl, ds, statusBarRefreshes } = makeHarness({ total: 5000, matching: 3337 });
    ctrl.setDatasource(ds);
    await ctrl.ensureRange(0, BLOCK);
    expect(statusBarRefreshes.length).toBe(1);

    // Every block reply repeats the same total; scrolling must not fan out a
    // status-bar refresh per block.
    await ctrl.ensureRange(BLOCK, BLOCK * 3);
    expect(statusBarRefreshes.length).toBe(1);
  });

  it('survives a purge refresh — the count is invariant under filtering', async () => {
    const { ctrl, ds } = makeHarness({ total: 5000, matching: 3337 });
    ctrl.setDatasource(ds);
    await ctrl.ensureRange(0, BLOCK);

    // A filter change purges. Clearing the total here would blank Total Rows
    // on every keystroke and re-latch a frame later.
    await ctrl.refresh({ purge: true });
    expect(ctrl.getUnfilteredRowCount()).toBe(5000);
  });

  it('is dropped when the DATASOURCE changes — that really is a new book', async () => {
    const { ctrl, ds } = makeHarness({ total: 5000, matching: 3337 });
    ctrl.setDatasource(ds);
    await ctrl.ensureRange(0, BLOCK);
    expect(ctrl.getUnfilteredRowCount()).toBe(5000);

    const other = makeHarness({ total: 42, matching: 42 });
    ctrl.setDatasource(other.ds);
    // Cleared synchronously, before the new datasource has replied — the old
    // book's total must not be shown against the new one.
    expect(ctrl.getUnfilteredRowCount()).toBeNull();

    await ctrl.ensureRange(0, BLOCK);
    expect(ctrl.getUnfilteredRowCount()).toBe(42);
  });

  it('ignores a nonsense declaration rather than showing it', async () => {
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
    const ctrl = new ServerSideRowModelV2Controller<Row>(host, { blockSize: BLOCK });
    ctrl.setDatasource({
      getRows: ({ success }) => success({
        rowData: [{ id: 'a' }],
        rowCount: 1,
        unfilteredRowCount: Number.NaN,
      }),
    });
    await ctrl.ensureRange(0, BLOCK);
    expect(ctrl.getUnfilteredRowCount()).toBeNull();
  });
});
