import { describe, expect, it } from 'vitest';
import { PerspectiveBook } from '../src/book';

describe('PerspectiveBook sparse SSRM queries', () => {
  it('serves flat windows with stable rowCount', async () => {
    const book = new PerspectiveBook({ snapshotRows: 40, feed: 'seed' });
    await book.registerView({ id: 'v1' });
    book.connect();
    const page = await book.getSsrmRows('v1', { startRow: 0, endRow: 10 });
    expect(page.rowCount).toBe(40);
    expect(page.rows).toHaveLength(10);
    expect(page.rows[0]!.positionId).toBeTruthy();
    book.destroy();
  });

  it('builds multi-depth skeleton with root grand totals', async () => {
    const book = new PerspectiveBook({ snapshotRows: 30, feed: 'seed' });
    await book.registerView({ id: 'v1' });
    book.connect();
    const { groups } = await book.getGroupSkeleton('v1', {
      rowGroupCols: ['desk', 'region'],
    });
    const root = groups.find((g) => g.path.length === 0);
    expect(root?.leafCount).toBe(30);
    expect(typeof root?.aggregates?.pnl).toBe('number');
    const desks = groups.filter((g) => g.path.length === 1);
    expect(desks.length).toBe(3); // EQ FX FI
    const leaves = groups.filter((g) => g.path.length === 2);
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.reduce((s, g) => s + g.leafCount, 0)).toBe(30);
    book.destroy();
  });

  it('returns leaf windows for a deepest group path', async () => {
    const book = new PerspectiveBook({ snapshotRows: 30, feed: 'seed' });
    await book.registerView({ id: 'v1' });
    book.connect();
    const { rows } = await book.getLeafRows('v1', {
      groupPath: ['EQ', 'AMER'],
      rowGroupCols: ['desk', 'region'],
      startRow: 0,
      endRow: 100,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.desk === 'EQ' && r.region === 'AMER')).toBe(true);
    const ids = await book.getGroupLeafIds('v1', {
      groupPath: ['EQ', 'AMER'],
      rowGroupCols: ['desk', 'region'],
    });
    expect(ids.ids).toEqual(rows.map((r) => r.positionId));
    book.destroy();
  });

  it('projects columnKeys on flat and leaf fetches', async () => {
    const book = new PerspectiveBook({ snapshotRows: 10, feed: 'seed' });
    await book.registerView({ id: 'v1' });
    book.connect();
    const page = await book.getSsrmRows('v1', {
      startRow: 0,
      endRow: 3,
      columnKeys: ['ticker', 'pnl'],
    });
    expect(Object.keys(page.rows[0]!).sort()).toEqual(['pnl', 'positionId', 'ticker']);
    book.destroy();
  });
});
