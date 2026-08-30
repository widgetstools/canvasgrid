import { describe, it, expect, vi } from 'vitest';
import {
  ServerSideRowModelV2Controller,
  type SsrmHostV2,
} from '../src/core/serverSideRowModelV2';
import type { IServerSideDatasourceV2, SkeletonGroup } from '../src/types/ssrm';
import type { FilterModel, SortModel } from '../src/types';
import { encodePivotValueKey, PIVOT_PATH_SEP } from '../src/worker/passes/pivotPass';
import { pivotResultColumnId } from '../src/core/pivotColumns';
import { buildCompositeGroupKey } from '../src/core/ssrmRowMeta';
import type { SsrmPivotResult } from '../src/worker/protocol';

/**
 * Sorting a PIVOT result column on the sparse SSRM path.
 *
 * A pivot result column is synthesized by the kernel, so the datasource has
 * no such column: pushing that id into Perspective's view sort aborted WASM
 * outright, and filtering it out made the click a silent no-op with a live
 * sort chevron over unchanged rows. AG (and CSRM, via
 * `reorderGroupLevelByPivot`) order the row GROUPS by that pivot cell's
 * value — the cross-tab is already published to the kernel, so order the
 * skeleton here instead.
 */

interface Row { id: string; g: string }

const ROW_GROUP_COLS = ['g'];
/** Skeleton groups in deliberately non-alphabetical, non-value order. */
const SKELETON: SkeletonGroup[] = [
  { path: ['A'], leafCount: 1 },
  { path: ['B'], leafCount: 1 },
  { path: ['C'], leafCount: 1 },
];

/** Cross-tab: EMEA/pnl per group — B lowest, A middle, C highest. */
function pivotResult(values: Record<string, number | null>): SsrmPivotResult {
  const map = new Map<string, unknown>();
  for (const [g, v] of Object.entries(values)) {
    if (v === null) continue; // deliberately absent → sorts last on asc
    map.set(
      encodePivotValueKey(
        buildCompositeGroupKey(ROW_GROUP_COLS, [g]),
        ['EMEA'].join(PIVOT_PATH_SEP),
        'pnl',
      ),
      v,
    );
  }
  return {
    keyTree: [{ value: 'EMEA', path: ['EMEA'], children: [] }],
    leafPaths: [['EMEA']],
    values: map,
  };
}

const PIVOT_COL = pivotResultColumnId(['EMEA'], 'pnl');

function setup(opts: {
  sortModel: SortModel;
  pivot: SsrmPivotResult | null;
  maintainOrder?: boolean;
}) {
  const groupKeys: string[][] = [];
  const host: SsrmHostV2<Row> = {
    getRowId: (r) => r.id,
    getSortModel: () => opts.sortModel,
    getFilterModel: () => ({}) as FilterModel,
    getRowGroupCols: () => ROW_GROUP_COLS,
    getExpandedGroupKeys: () => [],
    setGroupKeys: (keys) => { groupKeys.push([...keys]); },
    setRowCount: () => {},
    getRefreshRange: () => ({ rowStart: 0, rowEnd: 50 }),
    hydrateWindow: async () => {},
    applyTransaction: () => {},
    requestViewport: () => {},
    isDestroyed: () => false,
    getPivotResult: () => opts.pivot,
  };
  const ds: IServerSideDatasourceV2<Row> = {
    getRows: ({ success }) => success({ rowData: [], rowCount: 0 }),
    getGroupSkeleton: ({ success }) => success({
      groups: SKELETON.map((g) => ({ ...g, path: [...g.path] })),
    }),
    getLeafRows: ({ success }) => success({ rowData: [] }),
  };
  const ctrl = new ServerSideRowModelV2Controller<Row>(host, {
    rowIdField: 'id',
    maintainOrder: opts.maintainOrder === true,
  });
  ctrl.setDatasource(ds);
  return { ctrl, groupKeys };
}

/** Group order the controller settled on, as plain group values. */
async function orderOf(s: ReturnType<typeof setup>): Promise<string[]> {
  await s.ctrl.ensureRange(0, 50);
  const last = s.groupKeys[s.groupKeys.length - 1] ?? [];
  return last.map((k) => k.split(':')[1] ?? k);
}

describe('sparse SSRM — sorting by a pivot result column', () => {
  it('orders groups ascending by the pivot cell value', async () => {
    const s = setup({
      sortModel: [{ colId: PIVOT_COL, direction: 'asc' }] as unknown as SortModel,
      pivot: pivotResult({ A: 20, B: 10, C: 30 }),
    });
    expect(await orderOf(s)).toEqual(['B', 'A', 'C']);
  });

  it('orders groups descending', async () => {
    const s = setup({
      sortModel: [{ colId: PIVOT_COL, direction: 'desc' }] as unknown as SortModel,
      pivot: pivotResult({ A: 20, B: 10, C: 30 }),
    });
    expect(await orderOf(s)).toEqual(['C', 'A', 'B']);
  });

  it('sorts groups with no value last on asc (matching CSRM)', async () => {
    const s = setup({
      sortModel: [{ colId: PIVOT_COL, direction: 'asc' }] as unknown as SortModel,
      pivot: pivotResult({ A: 20, B: null, C: 30 }),
    });
    expect(await orderOf(s)).toEqual(['A', 'C', 'B']);
  });

  it('leaves datasource order alone when not sorting a pivot column', async () => {
    const s = setup({
      sortModel: [{ colId: 'g', direction: 'desc' }] as unknown as SortModel,
      pivot: pivotResult({ A: 20, B: 10, C: 30 }),
    });
    // A plain column sort IS pushed to the datasource, so the kernel must not
    // second-guess the order it returned.
    expect(await orderOf(s)).toEqual(['A', 'B', 'C']);
  });

  it('is inert when no cross-tab has been published', async () => {
    const s = setup({
      sortModel: [{ colId: PIVOT_COL, direction: 'asc' }] as unknown as SortModel,
      pivot: null,
    });
    expect(await orderOf(s)).toEqual(['A', 'B', 'C']);
  });

  it('overrides groupMaintainOrder — an explicit sort must win', async () => {
    // Otherwise the click is pinned back to the previous positions and
    // appears to do nothing.
    const s = setup({
      sortModel: [{ colId: PIVOT_COL, direction: 'asc' }] as unknown as SortModel,
      pivot: pivotResult({ A: 20, B: 10, C: 30 }),
      maintainOrder: true,
    });
    expect(await orderOf(s)).toEqual(['B', 'A', 'C']);
  });
});

describe('groupMaintainOrder does not outlive a sort change', () => {
  it('re-orders when the sort model changes', async () => {
    // prevOrder is recaptured from the order it just imposed, so without
    // clearing it on a sort change the first order ever seen would be
    // re-pinned onto every later skeleton and group order could never change.
    let sortModel: SortModel = [] as unknown as SortModel;
    const groupKeys: string[][] = [];
    const host: SsrmHostV2<Row> = {
      getRowId: (r) => r.id,
      getSortModel: () => sortModel,
      getFilterModel: () => ({}) as FilterModel,
      getRowGroupCols: () => ROW_GROUP_COLS,
      getExpandedGroupKeys: () => [],
      setGroupKeys: (keys) => { groupKeys.push([...keys]); },
      setRowCount: () => {},
      getRefreshRange: () => ({ rowStart: 0, rowEnd: 50 }),
      hydrateWindow: async () => {},
      applyTransaction: () => {},
      requestViewport: () => {},
      isDestroyed: () => false,
      getPivotResult: () => pivotResult({ A: 20, B: 10, C: 30 }),
    };
    // The datasource honours the sort by returning groups reversed.
    const ds: IServerSideDatasourceV2<Row> = {
      getRows: ({ success }) => success({ rowData: [], rowCount: 0 }),
      getGroupSkeleton: ({ success }) => {
        const groups = SKELETON.map((g) => ({ ...g, path: [...g.path] }));
        success({ groups: sortModel.length > 0 ? groups.reverse() : groups });
      },
      getLeafRows: ({ success }) => success({ rowData: [] }),
    };
    const ctrl = new ServerSideRowModelV2Controller<Row>(host, {
      rowIdField: 'id', maintainOrder: true,
    });
    ctrl.setDatasource(ds);
    await ctrl.ensureRange(0, 50);
    const first = (groupKeys[groupKeys.length - 1] ?? []).map((k) => k.split(':')[1]);
    expect(first).toEqual(['A', 'B', 'C']);

    sortModel = [{ colId: 'g', direction: 'desc' }] as unknown as SortModel;
    await ctrl.refresh({ purge: true });
    await ctrl.ensureRange(0, 50);
    const after = (groupKeys[groupKeys.length - 1] ?? []).map((k) => k.split(':')[1]);
    expect(after).toEqual(['C', 'B', 'A']);
  });
});
