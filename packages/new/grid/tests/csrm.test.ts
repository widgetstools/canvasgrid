import { describe, expect, it } from 'vitest';
import { ClientSideRowModel } from '../src/csrm/clientSideRowModel';
import { GroupPivotCoordinator } from '../src/groupPivot/coordinator';

type Row = { id: string; desk: string; pnl: number };

describe('ClientSideRowModel', () => {
  it('filters sorts and quick-filters', () => {
    const m = new ClientSideRowModel<Row>(
      (r) => r.id,
      () => [{ field: 'desk' }, { field: 'pnl' }],
    );
    m.setRowData([
      { id: '1', desk: 'EQ', pnl: 10 },
      { id: '2', desk: 'FX', pnl: 30 },
      { id: '3', desk: 'EQ', pnl: 20 },
    ]);
    m.setFilterModel({ desk: { filterType: 'text', type: 'equals', filter: 'EQ' } });
    m.setSortModel([{ colId: 'pnl', direction: 'desc' }]);
    expect(m.getRows().map((r) => r.id)).toEqual(['3', '1']);
    m.setQuickFilterText('eq 2');
    expect(m.getRows().map((r) => r.id)).toEqual(['3']);
  });
});

describe('GroupPivotCoordinator', () => {
  it('fail-closes pivot on sparse SSRM', () => {
    const warn = console.warn;
    const calls: string[] = [];
    console.warn = (m: string) => { calls.push(m); };
    try {
      const g = new GroupPivotCoordinator({
        isSparseSsrm: () => true,
        onChanged: () => {},
      });
      expect(g.setPivotMode(true)).toBe(false);
      expect(g.isPivotMode()).toBe(false);
      expect(calls.some((c) => c.includes('sparse SSRM'))).toBe(true);
    } finally {
      console.warn = warn;
    }
  });
});
