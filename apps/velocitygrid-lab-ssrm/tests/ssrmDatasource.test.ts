/**
 * The datasource is the whole contract on this path, so it is the thing worth
 * testing: if the skeleton is wrong the tree is wrong, and no amount of grid
 * correctness saves it.
 */
import { describe, it, expect } from 'vitest';
import { createBlotterSsrmDatasource, type BlotterBook } from '../src/data/ssrmDatasource';
import { makeRows, type BlotterRow } from '../src/data/domain';

const BOOK: BlotterRow[] = makeRows(400, 42, 1_000);
const book: BlotterBook = { rows: () => BOOK, latencyMs: 0 };
const ds = createBlotterSsrmDatasource(book);

function skeleton(rowGroupCols: string[], filterModel = {}, sortModel: unknown[] = []) {
  let out!: { groups: { path: string[]; leafCount: number; aggregates?: Record<string, unknown> }[]; unfilteredRowCount?: number };
  ds.getGroupSkeleton({
    request: { rowGroupCols, filterModel, sortModel } as never,
    success: (r) => { out = r as never; },
    fail: () => { throw new Error('skeleton failed'); },
  } as never);
  return out;
}

function leaves(groupPath: string[], rowGroupCols: string[], startRow = 0, endRow = 1_000) {
  let out!: { rowData: BlotterRow[] };
  ds.getLeafRows({
    request: { groupPath, rowGroupCols, startRow, endRow, filterModel: {}, sortModel: [] } as never,
    success: (r) => { out = r as never; },
    fail: () => { throw new Error('leaves failed'); },
  } as never);
  return out.rowData;
}

function flat(startRow: number, endRow: number, filterModel = {}, sortModel: unknown[] = []) {
  let out!: { rowData: BlotterRow[]; rowCount?: number; unfilteredRowCount?: number };
  ds.getRows({
    request: { startRow, endRow, filterModel, sortModel } as never,
    success: (r) => { out = r as never; },
    fail: () => { throw new Error('getRows failed'); },
  } as never);
  return out;
}

describe('blotter SSRM datasource — flat windows', () => {
  it('serves a window and reports both counts', () => {
    const res = flat(0, 25);
    expect(res.rowData).toHaveLength(25);
    expect(res.rowCount).toBe(400);
    expect(res.unfilteredRowCount).toBe(400);
  });

  it('windows are slices of one order, not independent queries', () => {
    const all = flat(0, 400).rowData.map((r) => r.id);
    const middle = flat(100, 140).rowData.map((r) => r.id);
    expect(middle).toEqual(all.slice(100, 140));
  });

  it('sorts before slicing', () => {
    const res = flat(0, 400, {}, [{ colId: 'midPrice', direction: 'desc' }]);
    const prices = res.rowData.map((r) => r.midPrice);
    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
  });

  it('reports the filtered count in rowCount and the whole book in unfilteredRowCount', () => {
    const res = flat(0, 1_000, { assetClass: { filterType: 'set', values: ['Corporate'] } });
    expect(res.rowData.every((r) => r.assetClass === 'Corporate')).toBe(true);
    expect(res.rowCount).toBe(res.rowData.length);
    expect(res.unfilteredRowCount).toBe(400);
    expect(res.rowCount).toBeLessThan(400);
  });

  it('applies number comparisons', () => {
    const res = flat(0, 1_000, { modifiedDuration: { filterType: 'number', type: 'greaterThan', filter: 8 } });
    expect(res.rowData.length).toBeGreaterThan(0);
    expect(res.rowData.every((r) => r.modifiedDuration > 8)).toBe(true);
  });
});

describe('blotter SSRM datasource — group skeleton', () => {
  it('returns a group for every prefix, at every depth', () => {
    const { groups } = skeleton(['desk', 'region']);
    const depths = new Set(groups.map((g) => g.path.length));
    // 0 is the grand total, 1 is desks, 2 is desk+region. The kernel needs all
    // three to build the tree.
    expect(depths).toEqual(new Set([0, 1, 2]));
  });

  it('leaf counts add up: children sum to their parent, top level sums to the book', () => {
    const { groups } = skeleton(['desk', 'region']);
    const top = groups.filter((g) => g.path.length === 1);
    expect(top.reduce((n, g) => n + g.leafCount, 0)).toBe(400);

    for (const parent of top) {
      const kids = groups.filter((g) => g.path.length === 2 && g.path[0] === parent.path[0]);
      expect(kids.reduce((n, g) => n + g.leafCount, 0)).toBe(parent.leafCount);
    }
  });

  it('carries the grand total as the empty path', () => {
    const { groups } = skeleton(['desk']);
    const grand = groups.find((g) => g.path.length === 0);
    expect(grand).toBeDefined();
    expect(grand!.leafCount).toBe(400);
    const expected = BOOK.reduce((n, r) => n + r.marketValue, 0);
    expect(grand!.aggregates!.marketValue).toBe(expected);
  });

  it('pre-aggregates each group so a collapsed row shows a true whole-subtree sum', () => {
    const { groups } = skeleton(['desk']);
    for (const g of groups.filter((x) => x.path.length === 1)) {
      const mine = BOOK.filter((r) => r.desk === g.path[0]);
      expect(g.aggregates!.marketValue).toBe(mine.reduce((n, r) => n + r.marketValue, 0));
      expect(g.aggregates!.dailyPnL).toBe(mine.reduce((n, r) => n + r.dailyPnL, 0));
    }
  });

  it('does not collide paths whose segments contain spaces', () => {
    // 'Real Estate' is a real sector and 'Emerging Markets' a real desk, so a
    // space-joined key would let ['Real', 'Estate'] and ['Real Estate'] share
    // a bucket. Grouping by two space-bearing columns is the shape that would
    // expose it.
    const { groups } = skeleton(['issuerSector', 'desk']);
    const two = groups.filter((g) => g.path.length === 2);
    const keys = two.map((g) => JSON.stringify(g.path));
    expect(new Set(keys).size).toBe(keys.length);
    for (const g of two) {
      const mine = BOOK.filter((r) => r.issuerSector === g.path[0] && r.desk === g.path[1]);
      expect(g.leafCount).toBe(mine.length);
    }
  });

  it('reflects the filter in both the groups and the unfiltered count', () => {
    const { groups, unfilteredRowCount } = skeleton(['desk'], {
      currency: { filterType: 'set', values: ['USD'] },
    });
    const grand = groups.find((g) => g.path.length === 0)!;
    expect(grand.leafCount).toBe(BOOK.filter((r) => r.currency === 'USD').length);
    expect(unfilteredRowCount).toBe(400);
  });
});

describe('blotter SSRM datasource — leaves', () => {
  it('returns only the rows under the requested group', () => {
    const { groups } = skeleton(['desk', 'region']);
    const g = groups.find((x) => x.path.length === 2)!;
    const rows = leaves(g.path, ['desk', 'region']);
    expect(rows).toHaveLength(g.leafCount);
    expect(rows.every((r) => r.desk === g.path[0] && r.region === g.path[1])).toBe(true);
  });

  it('windows within the group, not within the book', () => {
    const { groups } = skeleton(['desk']);
    const g = groups.find((x) => x.path.length === 1)!;
    const all = leaves(g.path, ['desk']);
    expect(leaves(g.path, ['desk'], 0, 5)).toEqual(all.slice(0, 5));
    expect(leaves(g.path, ['desk'], 5, 10)).toEqual(all.slice(5, 10));
  });

  it('lists every descendant leaf id for selection, from any depth', () => {
    const { groups } = skeleton(['desk', 'region']);
    const parent = groups.find((x) => x.path.length === 1)!;
    let ids: string[] = [];
    ds.getGroupLeafIds!({
      request: { groupPath: parent.path, rowGroupCols: ['desk', 'region'], filterModel: {}, sortModel: [] } as never,
      success: (r) => { ids = r.ids; },
      fail: () => { throw new Error('ids failed'); },
    } as never);
    expect(ids).toHaveLength(parent.leafCount);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('blotter SSRM datasource — liveness', () => {
  it('reads the book through the accessor, so a replaced book is seen', () => {
    let current: BlotterRow[] = makeRows(10, 1, 1_000);
    const live = createBlotterSsrmDatasource({ rows: () => current, latencyMs: 0 });
    const read = () => {
      let n = 0;
      live.getRows({
        request: { startRow: 0, endRow: 500, filterModel: {}, sortModel: [] } as never,
        success: (r) => { n = r.rowData.length; },
        fail: () => { throw new Error('failed'); },
      } as never);
      return n;
    };
    expect(read()).toBe(10);
    // A scenario overlay replaces the array wholesale; a datasource that had
    // captured the original would keep answering with stale rows forever.
    current = makeRows(25, 1, 1_000);
    expect(read()).toBe(25);
  });
});
