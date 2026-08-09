import { describe, expect, it } from 'vitest';
import { pageCachedRows } from '../src/query/page';

describe('pageCachedRows', () => {
  const rows = [
    { id: '1', desk: 'RATES', pnl: 10 },
    { id: '2', desk: 'CREDIT', pnl: 30 },
    { id: '3', desk: 'RATES', pnl: 20 },
  ];

  it('windows without filter/sort', () => {
    const r = pageCachedRows(rows, { startRow: 1, endRow: 3 });
    expect(r.rowCount).toBe(3);
    expect(r.rowData).toHaveLength(2);
    expect(r.rowData[0]?.id).toBe('2');
  });

  it('applies sort and text filter', () => {
    const r = pageCachedRows(rows, {
      startRow: 0,
      endRow: 10,
      sortModel: [{ colId: 'pnl', direction: 'desc' }],
      filterModel: { desk: { filterType: 'text', type: 'contains', filter: 'rates' } },
    });
    expect(r.rowCount).toBe(2);
    expect(r.rowData.map((x) => x.pnl)).toEqual([20, 10]);
  });
});
