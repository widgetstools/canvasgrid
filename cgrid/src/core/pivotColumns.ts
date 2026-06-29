/**
 * Cycle 18 / Task 3 — pivot column synthesis (main thread).
 *
 * Pivot is a column transformation, not a new render mode. The worker
 * (`PivotPass`, Task 2) discovers the distinct pivot-key tree from the
 * filtered data and computes the cross-tab values; this module turns that
 * tree into the **secondary (pivot result) columns** the grid renders —
 * the exact analogue of `core/autoGroupColumn.ts` `synthesizeAutoGroupColumns`
 * turning a group model into the auto-group column(s).
 *
 * Pivot LEVELS are column-group LEVELS. A 2-level pivot (Sector →
 * AssetClass) produces a 2-deep `CColGroupDef` tree whose leaves are the
 * value columns. `core/subgrid.ts` `HeaderGroupSubgrid` renders that tree
 * verbatim — no new header painter (Cycle 4 reuse, per the design note
 * `docs/superpowers/plans/notes/cycle-18-pivoting-design.md` Task 3).
 *
 *   keyTree:  [ TECH:[EQ,BOND], FIN:[EQ] ]   valueColumns: [sum(PnL)]
 *
 *   ┌─ TECH ───────────┐  ┌─ FIN ─┐      ← column-group row 0 (level 0)
 *   │  EQ  │   BOND     │  │  EQ   │      ← column-group row 1 (level 1)
 *   │ PnL  │   PnL      │  │ PnL   │      ← leaf header (value column)
 *
 * Each synthesized leaf carries NO `field` — its value is the cross-tab
 * aggregate addressed in `chunk.pivotValues` by (rowGroupKey ×
 * pivotKeyPath × valueColId). `cellSpecById` is the per-colId reverse
 * index the body cell lookup uses to build that address.
 */

import type { CColDef, CColGroupDef } from '../types';
import type { PivotKeyNode } from '../worker/passes/pivotPass';

/** Prefix marking a synthesized pivot-result column id. Mirrors how
 *  `AUTO_GROUP_COLUMN_ID` marks the auto-group column. */
export const PIVOT_RESULT_COL_PREFIX = 'pivotcol';
/** Separator inside a pivot-result colId. `` cannot appear in a
 *  normal colId / stringified pivot value. */
const PIVOT_ID_SEP = '';

/** A measured column under pivot — the source colId + the aggregation to
 *  apply, plus presentation hints for the synthesized leaf. */
export interface PivotValueColumnSpec {
  colId: string;
  aggFunc: string;
  /** Leaf header text. Falls back to `colId` when omitted. */
  headerName?: string;
  /** Drives the leaf's default cell renderer + halign. Aggregates are
   *  numeric by default. */
  cellDataType?: 'text' | 'number';
  /** Leaf column width. Inherited from the source value column when set;
   *  the column-width resolver picks a default when omitted. */
  width?: number;
}

/** Reverse index entry: how a synthetic colId addresses `pivotValues`. */
export interface PivotCellSpec {
  /** The pivot key path (one stringified value per pivot level). */
  pivotPath: string[];
  /** The value column being measured at this intersection. */
  valueColId: string;
}

export interface SynthesizedPivotColumns<TRow = unknown> {
  /** Secondary column defs — feed straight into `resolveColumnTree`. */
  defs: CColGroupDef<TRow>[];
  /** Synthetic colId → the (pivotPath, valueColId) it reads from
   *  `pivotValues`. */
  cellSpecById: Map<string, PivotCellSpec>;
}

/** Build the stable colId for one (pivot key path × value column)
 *  intersection. Unique per distinct path + value column. */
export function pivotResultColumnId(pivotPath: readonly string[], valueColId: string): string {
  return [PIVOT_RESULT_COL_PREFIX, ...pivotPath, valueColId].join(PIVOT_ID_SEP);
}

/** True when `colId` identifies a synthesized pivot-result column. Used by
 *  the cgrid layer to route `cellAt` through the `pivotValues` lookup
 *  instead of the standard numeric/text chunk reader. */
export function isPivotResultColumnId(colId: string): boolean {
  return colId.startsWith(PIVOT_RESULT_COL_PREFIX + PIVOT_ID_SEP);
}

/** Stable groupId for a pivot column-group node at `path`. */
function pivotGroupId(path: readonly string[]): string {
  return [PIVOT_RESULT_COL_PREFIX, 'grp', ...path].join(PIVOT_ID_SEP);
}

/**
 * Synthesize the secondary column defs + cell index for an active pivot.
 *
 * `keyTree` is the worker's distinct pivot-key tree (already sorted at
 * every level); `valueColumns` are the ordered measures. Every leaf node
 * of `keyTree` expands into one column group whose children are the value
 * columns; every intermediate node becomes a nesting column group.
 *
 * **Cycle 18 / Task 4 — collapse/expand.** Every NON-LEAF pivot key node
 * also emits a `columnGroupShow: 'closed'` "group total" leaf addressed
 * at its prefix path (the prefix aggregate `PivotPass` already emits via
 * `getPivotValue(out, groupKey, prefixPath, valueColId)`). The deeper
 * value-column leaves under a multi-level pivot carry
 * `columnGroupShow: 'open'` so the cascading resolver
 * (`resolveVisibleLeaves` in `core/columnGroupState.ts`) hides them
 * whenever ANY ancestor pivot group is closed. `pivotDefaultExpanded`
 * (default `0`) seeds `openByDefault = depth < pivotDefaultExpanded` on
 * each synthesized group — `0` keeps every group closed (only the
 * top-level totals show), `1` opens depth-0, and so on.
 *
 * 1-level pivots have no collapsible level (every key is a leaf, no
 * ancestor branch), so the synthesis matches Task 3's behaviour
 * verbatim — no `columnGroupShow`, no totals.
 *
 * Precondition (the caller's `isPivotActive` guard): `valueColumns` is
 * non-empty, so no empty-children group is ever produced (which
 * `resolveColumnTree` would reject).
 */
export function synthesizePivotColumns<TRow = unknown>(input: {
  keyTree: PivotKeyNode[];
  valueColumns: PivotValueColumnSpec[];
  /** Expand pivot column groups down to this depth by default. `0` (the
   *  default) keeps every group closed. Mirrors AG-Grid's
   *  `pivotDefaultExpanded` grid option. */
  pivotDefaultExpanded?: number;
}): SynthesizedPivotColumns<TRow> {
  const { keyTree, valueColumns } = input;
  const pivotDefaultExpanded = input.pivotDefaultExpanded ?? 0;
  const cellSpecById = new Map<string, PivotCellSpec>();

  const buildValueLeaves = (
    pivotPath: readonly string[],
    columnGroupShow: 'open' | 'closed' | undefined,
  ): CColDef<TRow>[] =>
    valueColumns.map((vc) => {
      const colId = pivotResultColumnId(pivotPath, vc.colId);
      cellSpecById.set(colId, { pivotPath: [...pivotPath], valueColId: vc.colId });
      const def: CColDef<TRow> = {
        colId,
        headerName: vc.headerName ?? vc.colId,
        cellDataType: vc.cellDataType ?? 'number',
        // Synthesized columns are derived, not author-provided: not
        // sortable (Task 8 wires sort-by-aggregate), no field (value
        // comes from chunk.pivotValues, not a row object key).
        sortable: false,
      };
      if (vc.width !== undefined) def.width = vc.width;
      if (columnGroupShow !== undefined) def.columnGroupShow = columnGroupShow;
      return def;
    });

  const buildNode = (
    node: PivotKeyNode,
    depth: number,
    hasAncestorBranch: boolean,
  ): CColGroupDef<TRow> => {
    if (node.children.length === 0) {
      // Leaf pivot level — emit the value columns. The group itself is
      // openByDefault=true so the user sees its value cols whenever any
      // branch ancestor is expanded; cascading-collapse + the value
      // cols' `columnGroupShow:'open'` hides them when a branch ancestor
      // closes. Top-level leaves of a 1-level pivot have no ancestor
      // branch and stay always-visible (no `columnGroupShow`).
      return {
        groupId: pivotGroupId(node.path),
        headerName: node.value,
        openByDefault: true,
        children: buildValueLeaves(node.path, hasAncestorBranch ? 'open' : undefined),
      };
    }
    // Branch node — emit a "group total" leaf (visible when this group
    // is collapsed) PLUS the recursive child groups. The totals address
    // the prefix path that PivotPass already aggregates. Branch groups
    // honour `pivotDefaultExpanded` per level.
    const openByDefault = depth < pivotDefaultExpanded;
    const totals = buildValueLeaves(node.path, 'closed');
    const childGroups = node.children.map((c) => buildNode(c, depth + 1, true));
    return {
      groupId: pivotGroupId(node.path),
      headerName: node.value,
      openByDefault,
      children: [...totals, ...childGroups],
    };
  };

  return { defs: keyTree.map((n) => buildNode(n, 0, false)), cellSpecById };
}

/** True when `groupId` identifies a synthesized pivot-result column GROUP
 *  (as opposed to a user-defined column group). The Cycle 18 / Task 4
 *  header chevron uses this to mark pivot groups as collapsible. */
export function isPivotResultGroupId(groupId: string): boolean {
  return groupId.startsWith(PIVOT_RESULT_COL_PREFIX + PIVOT_ID_SEP + 'grp' + PIVOT_ID_SEP);
}
