import { describe, it, expect } from 'vitest';
import { moveColumnToGroup, moveColumnGroup } from '../src/core/columnGroupMutation';
import { resolveColumnTree } from '../src/core/columnTree';
import type { CColDef, CColGroupDef } from '../src/types';

const leaf = (colId: string, extra: Partial<CColDef> = {}): CColDef => ({ colId, field: colId, ...extra });
const grp = (groupId: string, children: (CColDef | CColGroupDef)[], extra: Partial<CColGroupDef> = {}): CColGroupDef =>
  ({ groupId, headerName: groupId, children, ...extra });

// a: [ A, grp G1[ B, C ], grp G2[ D ] ]
const base = (): (CColDef | CColGroupDef)[] => [leaf('A'), grp('G1', [leaf('B'), leaf('C')]), grp('G2', [leaf('D')])];

/** flat leaf order from a defs tree (declaration order). */
const order = (defs: (CColDef | CColGroupDef)[]): string[] => resolveColumnTree(defs).leaves.map((l) => l.colId);
/** groupId a leaf sits under (or null). */
const parentOf = (defs: (CColDef | CColGroupDef)[], colId: string): string | null => {
  const t = resolveColumnTree(defs); const leaf = t.leafById.get(colId);
  const path = t.leaves.length ? undefined : undefined; // path via ResolvedColLeaf.groupPath
  // resolve via roots walk:
  let found: string | null = null;
  const walk = (nodes: any[], parent: string | null) => { for (const n of nodes) {
    if (n.kind === 'group') walk(n.children, n.groupId);
    else if (n.colDef.colId === colId) found = parent;
  }};
  walk(t.roots, null); return found;
};

describe('moveColumnToGroup (pure)', () => {
  it('moves a top-level leaf INTO a group at the end', () => {
    const r = moveColumnToGroup(base(), 'A', 'G1')!;
    expect(parentOf(r.defs, 'A')).toBe('G1');
    expect(order(r.defs)).toEqual(['B', 'C', 'A', 'D']); // A joins G1 after its leaves
  });
  it('moves a leaf INTO a group before a sibling', () => {
    const r = moveColumnToGroup(base(), 'A', 'G1', 'C')!;
    expect(order(r.defs)).toEqual(['B', 'A', 'C', 'D']);
    expect(parentOf(r.defs, 'A')).toBe('G1');
  });
  it('moves a grouped leaf OUT to top level (before a top-level ref)', () => {
    const r = moveColumnToGroup(base(), 'B', null, 'A')!;
    expect(parentOf(r.defs, 'B')).toBeNull();
    expect(order(r.defs)).toEqual(['B', 'A', 'C', 'D']);
  });
  it('cleans up a group emptied by the move (recursively)', () => {
    const r = moveColumnToGroup(base(), 'D', null)!; // empties G2
    expect(resolveColumnTree(r.defs).groupById.has('G2')).toBe(false);
  });
  it('preserves the leaf colDef fields (columnGroupShow, width)', () => {
    const defs = [leaf('A', { width: 111, columnGroupShow: 'open' }), grp('G1', [leaf('B')])];
    const r = moveColumnToGroup(defs, 'A', 'G1')!;
    const moved = resolveColumnTree(r.defs).leafById.get('A')!;
    expect(moved.width).toBe(111);
  });
  it('reorder WITHIN the same group is allowed (not a re-parent)', () => {
    const r = moveColumnToGroup(base(), 'C', 'G1', 'B')!; // C before B
    expect(order(r.defs)).toEqual(['A', 'C', 'B', 'D']);
  });
  it('rejects re-parent INTO a marryChildren group', () => {
    const defs = [leaf('A'), grp('G1', [leaf('B')], { marryChildren: true })];
    expect(moveColumnToGroup(defs, 'A', 'G1')).toBeNull();
  });
  it('rejects re-parent OUT of a marryChildren group', () => {
    const defs = [leaf('A'), grp('G1', [leaf('B'), leaf('C')], { marryChildren: true })];
    expect(moveColumnToGroup(defs, 'B', null)).toBeNull();
  });
  it('no-op returns null (unknown col, unknown target, already-there same position)', () => {
    expect(moveColumnToGroup(base(), 'ZZ', 'G1')).toBeNull();
    expect(moveColumnToGroup(base(), 'A', 'NOPE')).toBeNull();
    // B is already immediately before C inside G1 — "moving" it there is a
    // pure no-op (identical shape), so the mutation core must reject it.
    expect(moveColumnToGroup(base(), 'B', 'G1', 'C')).toBeNull();
  });
});

describe('anonymous (auto-id) groups are draggable (ag-grid parity)', () => {
  // A group authored WITHOUT an explicit groupId is a legal ag-grid pattern
  // (`{ headerName, children }`). `resolveColumnTree` numbers it `cg-grp-1`
  // (first anonymous group, pre-order DFS) — that SAME synthesized id must
  // be usable as a move target, not just a display label.
  it('moveColumnToGroup succeeds against an anonymous group\'s synthesized id', () => {
    const defs: (CColDef | CColGroupDef)[] = [leaf('A'), { headerName: 'G', children: [leaf('B')] } as CColGroupDef];
    const r = moveColumnToGroup(defs, 'A', 'cg-grp-1');
    expect(r).not.toBeNull();
    expect(order(r!.defs)).toEqual(['B', 'A']);
    expect(parentOf(r!.defs, 'A')).toBe('cg-grp-1');
  });
});

describe('moveColumnGroup (pure)', () => {
  it('moves a whole group to top level before a ref', () => {
    // nested: [ A, grp G1[ B, grp G2[ C ] ] ] → move G2 to top before A
    const defs = [leaf('A'), grp('G1', [leaf('B'), grp('G2', [leaf('C')])])];
    const r = moveColumnGroup(defs, 'G2', null, 'A')!;
    expect(order(r.defs)).toEqual(['C', 'A', 'B']);
    expect(resolveColumnTree(r.defs).groupById.get('G2')!.depth).toBe(0);
  });
  it('rejects moving a group into itself or a descendant', () => {
    const defs = [grp('G1', [grp('G2', [leaf('C')])])];
    expect(moveColumnGroup(defs, 'G1', 'G2')).toBeNull();
    expect(moveColumnGroup(defs, 'G1', 'G1')).toBeNull();
  });
});

describe('function-valued fields (regression — DataCloneError)', () => {
  // `structuredClone` throws `DataCloneError` on any function-valued field.
  // `CColDef` legitimately carries functions (`valueFormatter`, `cellRenderer`,
  // `valueGetter`, `comparator`, ...), so the mutation core must NOT use a raw
  // `structuredClone` over the whole tree (packages/kernel/src/core/columnGroupMutation.ts:29).
  it('moveColumnToGroup does not throw when a leaf carries a function field, and the moved leaf keeps the SAME function reference', () => {
    const valueFormatter = (x: unknown) => String(x);
    const defs: (CColDef | CColGroupDef)[] = [
      { colId: 'p', field: 'p', valueFormatter },
      grp('G', [leaf('other')]),
    ];
    let r: ReturnType<typeof moveColumnToGroup> = null;
    expect(() => {
      r = moveColumnToGroup(defs, 'p', 'G');
    }).not.toThrow();
    expect(r).not.toBeNull();
    const moved = resolveColumnTree(r!.defs).leafById.get('p')!;
    expect(moved.valueFormatter).toBe(valueFormatter);
  });

  it('moveColumnGroup does not throw when moving a group containing a function-valued leaf', () => {
    const valueFormatter = (x: unknown) => String(x);
    const defs: (CColDef | CColGroupDef)[] = [
      grp('G1', [{ colId: 'p', field: 'p', valueFormatter } as CColDef, leaf('q')]),
      grp('G2', [leaf('other')]),
    ];
    let r: ReturnType<typeof moveColumnGroup> = null;
    expect(() => {
      r = moveColumnGroup(defs, 'G1', 'G2');
    }).not.toThrow();
    expect(r).not.toBeNull();
    const moved = resolveColumnTree(r!.defs).leafById.get('p')!;
    expect(moved.valueFormatter).toBe(valueFormatter);
  });
});
