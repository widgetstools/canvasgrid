import { describe, it, expect } from 'vitest';
import { HeaderGroupSubgrid } from '../src/core/subgrid';
import { resolveColumnTree } from '../src/core/columnTree';

describe('HeaderGroupSubgrid', () => {
  const tree = resolveColumnTree([
    { field: 'id' },
    {
      groupId: 'pnl', headerName: 'P&L',
      children: [{ field: 'daily' }, { field: 'mtd' }, { field: 'ytd' }],
    },
  ]);
  const sg = new HeaderGroupSubgrid(() => tree, () => 24, 0, () => ['id', 'daily', 'mtd', 'ytd']);

  it('reports a single row at the configured header height', () => {
    expect(sg.getRowCount()).toBe(1);
    expect(sg.getRowHeight(0)).toBe(24);
  });

  it('getCell returns the group headerName for any leaf in the group', () => {
    expect(sg.getCell(0, 'daily')?.valueFormatted).toBe('P&L');
    expect(sg.getCell(0, 'ytd')?.valueFormatted).toBe('P&L');
  });

  it('getCell returns null for leaves with no group at this depth', () => {
    expect(sg.getCell(0, 'id')).toBeNull();
  });

  it('getGroupIdAt resolves the group at this depth', () => {
    expect(sg.getGroupIdAt('daily')).toBe('pnl');
    expect(sg.getGroupIdAt('id')).toBeNull();
  });
});

describe('HeaderGroupSubgrid — nested groups, depth selects ancestor', () => {
  const tree = resolveColumnTree([
    {
      groupId: 'outer', headerName: 'Outer',
      children: [
        { field: 'a' },
        {
          groupId: 'inner', headerName: 'Inner',
          children: [{ field: 'b' }, { field: 'c' }],
        },
      ],
    },
  ]);
  const top = new HeaderGroupSubgrid(() => tree, () => 24, 0, () => ['a', 'b', 'c']);
  const mid = new HeaderGroupSubgrid(() => tree, () => 24, 1, () => ['a', 'b', 'c']);

  it('depth=0 returns the outer group for every leaf', () => {
    expect(top.getGroupIdAt('a')).toBe('outer');
    expect(top.getGroupIdAt('b')).toBe('outer');
    expect(top.getGroupIdAt('c')).toBe('outer');
  });

  it('depth=1 returns inner for leaves under inner, null for leaves only under outer', () => {
    expect(mid.getGroupIdAt('a')).toBeNull();
    expect(mid.getGroupIdAt('b')).toBe('inner');
    expect(mid.getGroupIdAt('c')).toBe('inner');
  });
});
