import { describe, it, expect } from 'vitest';
import { resolveColumnTree, isColGroupDef } from '../src/core/columnTree';
import type { CColDef, CColGroupDef } from '../src/types';

describe('isColGroupDef', () => {
  it('returns true when def has a children array', () => {
    expect(isColGroupDef({ children: [{ field: 'a' }] })).toBe(true);
  });
  it('returns false for leaf defs', () => {
    expect(isColGroupDef({ field: 'a' })).toBe(false);
  });
});

describe('resolveColumnTree — flat (no groups)', () => {
  it('produces leaf-only roots and leaves in declaration order', () => {
    const defs: CColDef[] = [
      { field: 'a' }, { field: 'b' }, { field: 'c' },
    ];
    const tree = resolveColumnTree(defs);
    expect(tree.roots).toHaveLength(3);
    expect(tree.roots.every((n) => n.kind === 'leaf')).toBe(true);
    expect(tree.leaves.map((l) => l.colId)).toEqual(['a', 'b', 'c']);
    expect(tree.maxDepth).toBe(0);
    expect(tree.groupById.size).toBe(0);
    expect(tree.leafById.get('b')?.colId).toBe('b');
  });

  it('preserves defaultColDef inheritance through leaves', () => {
    const defs: CColDef[] = [{ field: 'a' }, { field: 'b' }];
    const tree = resolveColumnTree(defs, { sortable: false });
    expect(tree.leaves.every((l) => l.sortable === false)).toBe(true);
  });

  it('top-level leaves have empty groupPath and depth 0', () => {
    const tree = resolveColumnTree([{ field: 'a' }] satisfies CColDef[]);
    const node = tree.roots[0]!;
    expect(node.kind).toBe('leaf');
    if (node.kind === 'leaf') {
      expect(node.depth).toBe(0);
      expect(node.groupPath).toEqual([]);
    }
  });
});

describe('resolveColumnTree — single-level groups', () => {
  const defs: (CColDef | CColGroupDef)[] = [
    { field: 'id' },
    {
      groupId: 'pnl',
      headerName: 'P&L',
      children: [{ field: 'daily' }, { field: 'mtd' }, { field: 'ytd' }],
    },
    { field: 'tail' },
  ];

  it('flattens leaves in declaration order across groups + ungrouped', () => {
    const tree = resolveColumnTree(defs);
    expect(tree.leaves.map((l) => l.colId)).toEqual(['id', 'daily', 'mtd', 'ytd', 'tail']);
  });

  it('maxDepth reflects group nesting (=1 for single-level groups)', () => {
    const tree = resolveColumnTree(defs);
    expect(tree.maxDepth).toBe(1);
  });

  it('group node carries depth, leafColIds, and is findable by groupId', () => {
    const tree = resolveColumnTree(defs);
    const pnl = tree.groupById.get('pnl');
    expect(pnl).toBeDefined();
    expect(pnl!.depth).toBe(0);
    expect(pnl!.leafColIds).toEqual(['daily', 'mtd', 'ytd']);
    expect(pnl!.kind).toBe('group');
  });

  it('child leaves carry groupPath = ancestor groupIds', () => {
    const tree = resolveColumnTree(defs);
    const pnlNode = tree.roots[1]!;
    expect(pnlNode.kind).toBe('group');
    if (pnlNode.kind !== 'group') return;
    for (const child of pnlNode.children) {
      expect(child.kind).toBe('leaf');
      if (child.kind === 'leaf') {
        expect(child.depth).toBe(1);
        expect(child.groupPath).toEqual(['pnl']);
      }
    }
  });
});

describe('resolveColumnTree — auto-generated groupId', () => {
  it('assigns unique cg-grp- IDs to groups missing groupId', () => {
    const tree = resolveColumnTree([
      { headerName: 'Anon', children: [{ field: 'x' }] },
      { headerName: 'Anon2', children: [{ field: 'y' }] },
    ]);
    const ids = Array.from(tree.groupById.keys());
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^cg-grp-/);
    expect(ids[1]).toMatch(/^cg-grp-/);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('resolveColumnTree — defaults', () => {
  it('defaults openByDefault=false, marryChildren=false, headerName=""', () => {
    const tree = resolveColumnTree([{ children: [{ field: 'a' }] }]);
    const node = tree.roots[0]!;
    expect(node.kind).toBe('group');
    if (node.kind === 'group') {
      expect(node.openByDefault).toBe(false);
      expect(node.marryChildren).toBe(false);
      expect(node.headerName).toBe('');
    }
  });

  it('honors openByDefault + marryChildren when set', () => {
    const tree = resolveColumnTree([{
      groupId: 'g', openByDefault: true, marryChildren: true,
      children: [{ field: 'a' }],
    }]);
    const g = tree.groupById.get('g')!;
    expect(g.openByDefault).toBe(true);
    expect(g.marryChildren).toBe(true);
  });
});

describe('resolveColumnTree — nested groups', () => {
  it('builds depth + leafColIds for 2-level nesting', () => {
    const tree = resolveColumnTree([
      {
        groupId: 'outer',
        children: [
          { field: 'a' },
          {
            groupId: 'inner',
            children: [{ field: 'b' }, { field: 'c' }],
          },
        ],
      },
    ]);
    expect(tree.maxDepth).toBe(2);
    expect(tree.leaves.map((l) => l.colId)).toEqual(['a', 'b', 'c']);
    expect(tree.groupById.get('outer')!.leafColIds).toEqual(['a', 'b', 'c']);
    expect(tree.groupById.get('outer')!.depth).toBe(0);
    expect(tree.groupById.get('inner')!.leafColIds).toEqual(['b', 'c']);
    expect(tree.groupById.get('inner')!.depth).toBe(1);
  });

  it('inner-group child leaves carry full groupPath', () => {
    const tree = resolveColumnTree([
      {
        groupId: 'outer',
        children: [{
          groupId: 'inner',
          children: [{ field: 'b' }],
        }],
      },
    ]);
    const outer = tree.roots[0];
    if (outer?.kind !== 'group') throw new Error('expected group');
    const inner = outer.children[0];
    if (inner?.kind !== 'group') throw new Error('expected nested group');
    const leaf = inner.children[0];
    expect(leaf?.kind).toBe('leaf');
    if (leaf?.kind === 'leaf') {
      expect(leaf.depth).toBe(2);
      expect(leaf.groupPath).toEqual(['outer', 'inner']);
    }
  });
});

describe('resolveColumnTree — errors', () => {
  it('throws on empty children array', () => {
    expect(() => resolveColumnTree([{ children: [] }])).toThrow(/empty.*children/i);
  });

  it('throws on duplicate colId across groups', () => {
    expect(() =>
      resolveColumnTree([
        { children: [{ field: 'a' }] },
        { children: [{ field: 'a' }] },
      ]),
    ).toThrow(/duplicate.*colId/i);
  });

  it('throws on duplicate explicit groupId', () => {
    expect(() =>
      resolveColumnTree([
        { groupId: 'g', children: [{ field: 'a' }] },
        { groupId: 'g', children: [{ field: 'b' }] },
      ]),
    ).toThrow(/duplicate.*groupId/i);
  });
});
