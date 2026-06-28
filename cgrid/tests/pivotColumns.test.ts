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
    // Leaves: TECH/EQ, TECH/BOND, FIN/EQ => 3 leaves × 1 value col.
    expect(tree.leaves).toHaveLength(3);
    expect(tree.leafById.has(pivotResultColumnId(['TECH', 'BOND'], 'pnl'))).toBe(true);

    expect(cellSpecById.get(pivotResultColumnId(['TECH', 'BOND'], 'pnl'))).toEqual({
      pivotPath: ['TECH', 'BOND'],
      valueColId: 'pnl',
    });
    expect(cellSpecById.size).toBe(3);
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
    for (const leaf of tree.leaves) {
      expect(leaf.cellDataType).toBe('number');
      expect(leaf.sortable).toBe(false);
    }
  });
});
