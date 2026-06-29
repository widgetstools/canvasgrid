// Cycle 18 / Task 3 — pivot column synthesis (main thread).
//
// `synthesizePivotColumns` turns the worker's distinct pivot-key tree
// (`PivotKeyNode[]`) plus the ordered value columns into the secondary
// (pivot result) column defs the grid renders, mirroring how
// `synthesizeAutoGroupColumns` turns a group model into the auto-group
// column(s). Pivot LEVELS become column-group LEVELS so the existing
// `HeaderGroupSubgrid` renders them verbatim — the synthesis just emits a
// `CColGroupDef[]` the column-tree resolver already understands.
//
// It also emits a `cellSpecById` map: synthetic colId → { pivotPath,
// valueColId } so the body cell lookup can address `pivotValues` for each
// (rowGroup × pivotKeyPath × valueColumn) intersection.

import { describe, it, expect } from 'vitest';
import {
  synthesizePivotColumns,
  pivotResultColumnId,
  isPivotResultColumnId,
} from '../src/core/pivotColumns';
import { resolveColumnTree } from '../src/core/columnTree';
import type { PivotKeyNode } from '../src/worker/passes/pivotPass';

/** Build a flat (single-level) key tree from leaf values. */
function flatTree(values: string[]): PivotKeyNode[] {
  return values.map((value) => ({ value, path: [value], children: [] }));
}

/** Two-level key tree: { [l0]: l1[] }. */
function nestedTree(spec: Record<string, string[]>): PivotKeyNode[] {
  return Object.entries(spec).map(([l0, l1s]) => ({
    value: l0,
    path: [l0],
    children: l1s.map((l1) => ({ value: l1, path: [l0, l1], children: [] })),
  }));
}

describe('pivotResultColumnId', () => {
  it('encodes a stable, unique id per (pivotPath, valueColId)', () => {
    const a = pivotResultColumnId(['TECH'], 'pnl');
    const b = pivotResultColumnId(['FIN'], 'pnl');
    const c = pivotResultColumnId(['TECH'], 'qty');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    // Deterministic — same inputs, same id.
    expect(pivotResultColumnId(['TECH'], 'pnl')).toBe(a);
  });

  it('round-trips through isPivotResultColumnId', () => {
    expect(isPivotResultColumnId(pivotResultColumnId(['TECH', 'EQ'], 'pnl'))).toBe(true);
    expect(isPivotResultColumnId('pnl')).toBe(false);
    expect(isPivotResultColumnId('ag-Grid-AutoColumn')).toBe(false);
  });
});

describe('synthesizePivotColumns — single pivot level', () => {
  it('emits one column group per pivot key with the value column underneath', () => {
    const { defs, cellSpecById } = synthesizePivotColumns({
      keyTree: flatTree(['FIN', 'TECH']),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
    });

    expect(defs).toHaveLength(2);
    const [fin, tech] = defs;
    expect(fin!.headerName).toBe('FIN');
    expect(tech!.headerName).toBe('TECH');
    // Each group carries exactly one leaf (the single value column).
    expect(fin!.children).toHaveLength(1);
    const finLeaf = fin!.children[0] as { colId: string; headerName?: string };
    expect(finLeaf.headerName).toBe('PnL');
    expect(finLeaf.colId).toBe(pivotResultColumnId(['FIN'], 'pnl'));

    // cellSpecById addresses pivotValues per synthetic column.
    const spec = cellSpecById.get(pivotResultColumnId(['FIN'], 'pnl'));
    expect(spec).toEqual({ pivotPath: ['FIN'], valueColId: 'pnl' });
    expect(cellSpecById.size).toBe(2);
  });

  it('emits one leaf per value column, in order', () => {
    const { defs, cellSpecById } = synthesizePivotColumns({
      keyTree: flatTree(['TECH']),
      valueColumns: [
        { colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' },
        { colId: 'qty', aggFunc: 'avg', headerName: 'Qty' },
      ],
    });
    const tech = defs[0]!;
    expect(tech.children).toHaveLength(2);
    expect((tech.children[0] as { headerName?: string }).headerName).toBe('PnL');
    expect((tech.children[1] as { headerName?: string }).headerName).toBe('Qty');
    expect(cellSpecById.size).toBe(2);
    expect(cellSpecById.get(pivotResultColumnId(['TECH'], 'qty'))).toEqual({
      pivotPath: ['TECH'],
      valueColId: 'qty',
    });
  });
});

describe('synthesizePivotColumns — nested pivot levels', () => {
  it('mirrors the key tree as nested column groups, value columns at the leaves', () => {
    const { defs, cellSpecById } = synthesizePivotColumns({
      keyTree: nestedTree({ TECH: ['EQ', 'BOND'], FIN: ['EQ'] }),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
    });

    // Resolve through the real column-tree resolver — the synthesized defs
    // MUST be accepted verbatim (this is the HeaderGroupSubgrid contract).
    const tree = resolveColumnTree(defs);
    // 2 pivot levels => 2 column-group header rows.
    expect(tree.maxDepth).toBe(2);
    // Cycle 18 / Task 4 — every non-leaf pivot key emits a "group total" leaf
    // (columnGroupShow:'closed') addressed at its prefix path PLUS the deeper
    // value-column leaves. Two non-leaf keys (TECH, FIN) → 2 total leaves +
    // 3 deep leaves (TECH/EQ, TECH/BOND, FIN/EQ) = 5.
    expect(tree.leaves).toHaveLength(5);
    expect(tree.leafById.has(pivotResultColumnId(['TECH', 'BOND'], 'pnl'))).toBe(true);

    expect(cellSpecById.get(pivotResultColumnId(['TECH', 'BOND'], 'pnl'))).toEqual({
      pivotPath: ['TECH', 'BOND'],
      valueColId: 'pnl',
    });
    expect(cellSpecById.size).toBe(5);
  });
});

describe('synthesizePivotColumns — resolver compatibility', () => {
  it('produces defs with unique group ids and number-typed leaves by default', () => {
    const { defs } = synthesizePivotColumns({
      keyTree: flatTree(['A', 'B', 'C']),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
    });
    // No throw on duplicate groupIds / colIds and resolves cleanly.
    const tree = resolveColumnTree(defs);
    expect(tree.leaves).toHaveLength(3);
    // Default cellDataType is number (aggregates are numeric) → number renderer.
    // Cycle 18 / Task 8d — synthesized columns are sortable; the worker's
    // SortPass decodes the synthesized colId via
    // `decodePivotResultColumnId` and re-orders row groups by the
    // matching pivot aggregate.
    for (const leaf of tree.leaves) {
      expect(leaf.cellDataType).toBe('number');
      expect(leaf.sortable).toBe(true);
    }
  });
});

// Cycle 18 / Task 4 — pivot column-group expand/collapse.
//
// For multi-level pivots, each non-leaf pivot key node emits a
// `columnGroupShow: 'closed'` "group total" leaf addressed at its prefix
// path (`PivotPass` already emits the prefix aggregate via
// `getPivotValue(out, groupKey, prefixPath, valueColId)`). The deeper
// value-column leaves carry `columnGroupShow: 'open'` so the cascading
// resolver (Task 4 in `core/columnGroupState.ts`) hides them whenever
// ANY ancestor pivot group is closed. The synthesis takes `pivotDefaultExpanded`
// — a per-LEVEL depth — and stamps `openByDefault = depth < pivotDefaultExpanded`
// on each synthesized group. A 1-level pivot has no collapsible level
// (every top-level key is a leaf), so the synthesis matches Task 3's
// behaviour verbatim — no `columnGroupShow`, no totals.
//
// Design note: docs/superpowers/plans/notes/cycle-18-pivoting-design.md (Task 4).
describe('synthesizePivotColumns — Task 4 collapse/expand', () => {
  it('1-level pivot: value cols carry no columnGroupShow (nothing to collapse)', () => {
    const { defs, cellSpecById } = synthesizePivotColumns({
      keyTree: flatTree(['FIN', 'TECH']),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
    });
    // Every leaf under a top-level pivot key has no columnGroupShow.
    for (const def of defs) {
      const children = (def.children as { columnGroupShow?: 'open' | 'closed' }[]);
      for (const leaf of children) expect(leaf.columnGroupShow).toBeUndefined();
    }
    // No extra "total" leaves: just one leaf per (key, value col).
    expect(cellSpecById.size).toBe(2);
  });

  it('2-level pivot: each level-0 group emits a closed-state total leaf addressed at the prefix', () => {
    const { defs, cellSpecById } = synthesizePivotColumns({
      keyTree: nestedTree({ TECH: ['EQ', 'BOND'], FIN: ['EQ'] }),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
    });

    // TECH and FIN are non-leaf nodes -> each gets a closed-state total leaf
    // alongside its child sub-groups.
    const tech = defs[0]!;
    const techChildren = tech.children as (
      | { colId: string; columnGroupShow?: 'open' | 'closed' }
      | { groupId: string; children: unknown[] }
    )[];
    // First child is the columnGroupShow:'closed' total leaf for the TECH prefix.
    const techTotal = techChildren[0] as { colId: string; columnGroupShow?: 'open' | 'closed' };
    expect(techTotal.colId).toBe(pivotResultColumnId(['TECH'], 'pnl'));
    expect(techTotal.columnGroupShow).toBe('closed');

    // The remaining children are the EQ / BOND sub-groups.
    const subGroups = techChildren.slice(1) as { groupId: string; children: unknown[] }[];
    expect(subGroups).toHaveLength(2);

    // Deeper value cols (under EQ / BOND) carry columnGroupShow:'open' so the
    // cascading resolver hides them when TECH (ancestor) is collapsed.
    const eqLeaves = subGroups[0]!.children as { colId: string; columnGroupShow?: 'open' | 'closed' }[];
    expect(eqLeaves[0]!.columnGroupShow).toBe('open');
    expect(eqLeaves[0]!.colId).toBe(pivotResultColumnId(['TECH', 'EQ'], 'pnl'));

    // cellSpecById carries both leaf-level AND total-level entries.
    // Totals: TECH at ['TECH'], FIN at ['FIN'].
    // Leaf level: TECH/EQ, TECH/BOND, FIN/EQ.
    expect(cellSpecById.size).toBe(5);
    expect(cellSpecById.get(pivotResultColumnId(['TECH'], 'pnl'))).toEqual({
      pivotPath: ['TECH'], valueColId: 'pnl',
    });
    expect(cellSpecById.get(pivotResultColumnId(['FIN'], 'pnl'))).toEqual({
      pivotPath: ['FIN'], valueColId: 'pnl',
    });
    expect(cellSpecById.get(pivotResultColumnId(['TECH', 'EQ'], 'pnl'))).toEqual({
      pivotPath: ['TECH', 'EQ'], valueColId: 'pnl',
    });
  });

  it('pivotDefaultExpanded=0 (default) leaves every BRANCH pivot group closed', () => {
    const { defs } = synthesizePivotColumns({
      keyTree: nestedTree({ TECH: ['EQ', 'BOND'] }),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
    });
    const tree = resolveColumnTree(defs);
    // TECH (branch, depth 0): closed (0 < 0 is false).
    expect(tree.groupById.get(pivotGroupIdFromPath(['TECH']))!.openByDefault).toBe(false);
    // EQ / BOND are LEAF pivot groups (no further pivot nesting). They
    // stay openByDefault=true so the user sees their value cols whenever
    // a branch ancestor expands; cascading-collapse on the value cols
    // (columnGroupShow:'open') hides them when an ancestor closes.
    expect(tree.groupById.get(pivotGroupIdFromPath(['TECH', 'EQ']))!.openByDefault).toBe(true);
    expect(tree.groupById.get(pivotGroupIdFromPath(['TECH', 'BOND']))!.openByDefault).toBe(true);
  });

  it('pivotDefaultExpanded=1 opens depth-0 branch pivot groups', () => {
    const { defs } = synthesizePivotColumns({
      keyTree: nestedTree({ TECH: ['EQ', 'BOND'] }),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
      pivotDefaultExpanded: 1,
    });
    const tree = resolveColumnTree(defs);
    // TECH (branch, depth 0): 0 < 1 → open.
    expect(tree.groupById.get(pivotGroupIdFromPath(['TECH']))!.openByDefault).toBe(true);
    // EQ / BOND (leaf groups): always open (see above).
    expect(tree.groupById.get(pivotGroupIdFromPath(['TECH', 'EQ']))!.openByDefault).toBe(true);
    expect(tree.groupById.get(pivotGroupIdFromPath(['TECH', 'BOND']))!.openByDefault).toBe(true);
  });

  it('pivotDefaultExpanded honours per-depth threshold for BRANCH groups in a 3-level pivot', () => {
    // 3-level pivot: Sector → AssetClass → Currency.
    const keyTree = [
      {
        value: 'TECH', path: ['TECH'],
        children: [
          {
            value: 'EQ', path: ['TECH', 'EQ'],
            children: [
              { value: 'USD', path: ['TECH', 'EQ', 'USD'], children: [] },
            ],
          },
        ],
      },
    ];
    const { defs } = synthesizePivotColumns({
      keyTree,
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
      pivotDefaultExpanded: 1,
    });
    const tree = resolveColumnTree(defs);
    // Depth-0 TECH (branch): 0 < 1 → open.
    expect(tree.groupById.get(pivotGroupIdFromPath(['TECH']))!.openByDefault).toBe(true);
    // Depth-1 EQ (branch — has Currency children): 1 < 1 is false → closed.
    expect(tree.groupById.get(pivotGroupIdFromPath(['TECH', 'EQ']))!.openByDefault).toBe(false);
    // Depth-2 USD (leaf — no further pivot nesting): always open.
    expect(tree.groupById.get(pivotGroupIdFromPath(['TECH', 'EQ', 'USD']))!.openByDefault).toBe(true);
  });

  it('end-to-end: collapsed TECH shows only the TECH total leaf, expanded shows the deeper leaves', async () => {
    const { ColumnGroupState, resolveVisibleLeaves } = await import('../src/core/columnGroupState');
    const { defs } = synthesizePivotColumns({
      keyTree: nestedTree({ TECH: ['EQ', 'BOND'] }),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
    });
    const tree = resolveColumnTree(defs);
    const state = new ColumnGroupState(tree);

    // Collapsed by default (pivotDefaultExpanded=0) → only TECH's total
    // leaf shows; deeper EQ / BOND value cols are hidden via cascading.
    expect(resolveVisibleLeaves(tree, state)).toEqual([
      pivotResultColumnId(['TECH'], 'pnl'),
    ]);

    // Expand TECH → total leaf hides, deeper value cols appear.
    state.setOpen(pivotGroupIdFromPath(['TECH']), true);
    expect(resolveVisibleLeaves(tree, state)).toEqual([
      pivotResultColumnId(['TECH', 'EQ'], 'pnl'),
      pivotResultColumnId(['TECH', 'BOND'], 'pnl'),
    ]);
  });
});

// Mirror of the private pivotGroupId() — kept here so the resolver test can
// look up groups by path without coupling to the module's internal helper.
// `` matches PIVOT_ID_SEP in core/pivotColumns.ts.
function pivotGroupIdFromPath(path: string[]): string {
  return ['pivotcol', 'grp', ...path].join('');
}

// Cycle 18 / Task 8e — pivot totals (row totals + column-group totals).
//
//   `pivotRowTotals: 'before' | 'after' | null` — adds ONE totals column
//      per value column at the start / end of the synthesized column
//      list. Cells read from `chunk.groupTotals[valueColId]` (already
//      computed by AggPass, no PivotPass changes needed).
//
//   `pivotColumnGroupTotals: 'before' | 'after' | null` — for multi-
//      level pivots, the existing per-prefix "group total" leaves Task 4
//      emitted with `columnGroupShow: 'closed'` now also show when the
//      group is open. Order is 'before' = first child, 'after' = last
//      child. Default null = Task 4 behaviour (closed-only).
//
// AG-parity Prompt 3 / 8 (totals follow-up).
import {
  isPivotRowTotalColumnId,
  pivotRowTotalColumnId,
} from '../src/core/pivotColumns';

describe('synthesizePivotColumns — pivotRowTotals (Task 8e)', () => {
  it('null (default) emits no row total columns', () => {
    const { defs, cellSpecById } = synthesizePivotColumns({
      keyTree: flatTree(['FIN', 'TECH']),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
    });
    expect(defs).toHaveLength(2);
    for (const spec of cellSpecById.values()) {
      expect((spec as { isRowTotal?: boolean }).isRowTotal).toBeFalsy();
    }
  });

  it('"after": appends a single-leaf totals group with one leaf per value column', () => {
    const { defs, cellSpecById } = synthesizePivotColumns({
      keyTree: flatTree(['FIN', 'TECH']),
      valueColumns: [
        { colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' },
        { colId: 'qty', aggFunc: 'sum', headerName: 'Qty' },
      ],
      pivotRowTotals: 'after',
    });
    expect(defs).toHaveLength(3);
    const last = defs[defs.length - 1]!;
    expect(last.children).toHaveLength(2);
    const pnlTotalId = pivotRowTotalColumnId('pnl');
    const qtyTotalId = pivotRowTotalColumnId('qty');
    const ids = (last.children as Array<{ colId: string }>).map((c) => c.colId);
    expect(ids).toEqual([pnlTotalId, qtyTotalId]);
    expect((cellSpecById.get(pnlTotalId) as { isRowTotal?: boolean })?.isRowTotal).toBe(true);
    expect(cellSpecById.get(pnlTotalId)?.valueColId).toBe('pnl');
  });

  it('"before": prepends the totals group ahead of all pivot key groups', () => {
    const { defs } = synthesizePivotColumns({
      keyTree: flatTree(['FIN', 'TECH']),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
      pivotRowTotals: 'before',
    });
    expect(defs).toHaveLength(3);
    const first = defs[0]!;
    const firstChild = (first.children as Array<{ colId: string }>)[0]!;
    expect(firstChild.colId).toBe(pivotRowTotalColumnId('pnl'));
  });

  it('pivotRowTotalColumnId / isPivotRowTotalColumnId round-trip uniquely per valueColId', () => {
    const a = pivotRowTotalColumnId('pnl');
    const b = pivotRowTotalColumnId('qty');
    expect(a).not.toBe(b);
    expect(isPivotRowTotalColumnId(a)).toBe(true);
    expect(isPivotRowTotalColumnId(b)).toBe(true);
    expect(isPivotRowTotalColumnId(pivotResultColumnId(['FIN'], 'pnl'))).toBe(false);
    expect(isPivotRowTotalColumnId('pnl')).toBe(false);
  });
});

describe('synthesizePivotColumns — pivotColumnGroupTotals (Task 8e)', () => {
  it('null (default) keeps Task 4 behaviour: prefix totals show only when group is closed', () => {
    const { defs } = synthesizePivotColumns({
      keyTree: nestedTree({ TECH: ['EQ', 'BOND'] }),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }],
    });
    const tech = defs[0]!;
    const total = (tech.children as Array<{ columnGroupShow?: 'open' | 'closed' }>)[0]!;
    expect(total.columnGroupShow).toBe('closed');
  });

  it('"after" appends the prefix-total leaf as the LAST child + makes it always visible', () => {
    const { defs } = synthesizePivotColumns({
      keyTree: nestedTree({ TECH: ['EQ', 'BOND'] }),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }],
      pivotColumnGroupTotals: 'after',
    });
    const tech = defs[0]!;
    const children = tech.children as Array<
      | { colId: string; columnGroupShow?: 'open' | 'closed' }
      | { groupId: string }
    >;
    expect(children).toHaveLength(3);
    const last = children[children.length - 1]! as { colId: string; columnGroupShow?: 'open' | 'closed' };
    expect(last.colId).toBe(pivotResultColumnId(['TECH'], 'pnl'));
    expect(last.columnGroupShow).toBeUndefined();
  });

  it('"before" keeps the prefix-total leaf as the FIRST child + makes it always visible', () => {
    const { defs } = synthesizePivotColumns({
      keyTree: nestedTree({ TECH: ['EQ', 'BOND'] }),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }],
      pivotColumnGroupTotals: 'before',
    });
    const tech = defs[0]!;
    const children = tech.children as Array<
      | { colId: string; columnGroupShow?: 'open' | 'closed' }
      | { groupId: string }
    >;
    expect(children).toHaveLength(3);
    const first = children[0]! as { colId: string; columnGroupShow?: 'open' | 'closed' };
    expect(first.colId).toBe(pivotResultColumnId(['TECH'], 'pnl'));
    expect(first.columnGroupShow).toBeUndefined();
  });

  it('does not affect 1-level pivots (no nesting => no prefix totals)', () => {
    const { defs } = synthesizePivotColumns({
      keyTree: flatTree(['FIN', 'TECH']),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }],
      pivotColumnGroupTotals: 'after',
    });
    expect(defs).toHaveLength(2);
  });
});

// Cycle 18 / Task 8f — processPivotResultColDef / processPivotResultColGroupDef.
//
// App-provided callbacks let the app mutate the synthesized colDef / group
// before the resolver sees it. Common uses: override headerName, set
// valueFormatter, add cellStyle / cellClassRules. AG-Grid parity.
describe('synthesizePivotColumns — processPivotResultColDef (Task 8f)', () => {
  it('is called once per synthesized LEAF colDef + receives the def by reference for in-place mutation', () => {
    const seen: string[] = [];
    const { defs } = synthesizePivotColumns({
      keyTree: flatTree(['FIN', 'TECH']),
      valueColumns: [
        { colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' },
        { colId: 'qty', aggFunc: 'sum', headerName: 'Qty' },
      ],
      processPivotResultColDef: (def) => {
        seen.push(def.colId ?? '');
        def.headerName = `[${def.headerName}]`;
      },
    });
    // 2 pivot keys × 2 value cols = 4 leaves.
    expect(seen).toHaveLength(4);
    for (const group of defs) {
      const leaves = (group.children as Array<{ headerName: string }>);
      for (const leaf of leaves) expect(leaf.headerName.startsWith('[')).toBe(true);
    }
  });

  it('is NOT called when undefined (default no-op)', () => {
    const { defs } = synthesizePivotColumns({
      keyTree: flatTree(['FIN']),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
    });
    const leaf = (defs[0]!.children as Array<{ headerName: string }>)[0]!;
    expect(leaf.headerName).toBe('PnL');
  });

  it('is also called on row-total leaves (Task 8e) when pivotRowTotals is set', () => {
    let totalLeafSeen = false;
    synthesizePivotColumns({
      keyTree: flatTree(['FIN']),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum', headerName: 'PnL' }],
      pivotRowTotals: 'after',
      processPivotResultColDef: (def) => {
        if (def.colId && def.colId.startsWith('pivotrowtotal')) totalLeafSeen = true;
      },
    });
    expect(totalLeafSeen).toBe(true);
  });
});

describe('synthesizePivotColumns — processPivotResultColGroupDef (Task 8f)', () => {
  it('is called once per synthesized GROUP def + receives the group by reference', () => {
    const seen: string[] = [];
    const { defs } = synthesizePivotColumns({
      keyTree: nestedTree({ TECH: ['EQ', 'BOND'] }),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }],
      processPivotResultColGroupDef: (g) => {
        seen.push(g.headerName ?? '');
        g.headerName = `<${g.headerName}>`;
      },
    });
    // TECH (depth-0) + EQ (depth-1) + BOND (depth-1) = 3 groups.
    expect(seen.sort()).toEqual(['BOND', 'EQ', 'TECH']);
    const tech = defs[0]!;
    expect(tech.headerName).toBe('<TECH>');
  });

  it('is NOT called for the row-totals group (different category — leaves go through processPivotResultColDef)', () => {
    // The row-totals group is wrapped chrome — its identity is "Total"
    // for layout reasons. Apps customise the totals via the leaf
    // callback, not the group one (the group has no per-pivot-key
    // semantics).
    let totalsGroupSeen = false;
    synthesizePivotColumns({
      keyTree: flatTree(['FIN']),
      valueColumns: [{ colId: 'pnl', aggFunc: 'sum' }],
      pivotRowTotals: 'after',
      processPivotResultColGroupDef: (g) => {
        if (g.headerName === 'Total') totalsGroupSeen = true;
      },
    });
    expect(totalsGroupSeen).toBe(false);
  });
});
