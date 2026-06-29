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
import { type PivotKeyNode, PIVOT_ROW_TOTAL_PATH_MARKER } from '../worker/passes/pivotPass';

/** Prefix marking a synthesized pivot-result column id. Mirrors how
 *  `AUTO_GROUP_COLUMN_ID` marks the auto-group column. */
export const PIVOT_RESULT_COL_PREFIX = 'pivotcol';
/** Cycle 18 / Task 8e — prefix marking a synthesized "row total" column.
 *  Row totals show the row-group total across ALL pivot values per row,
 *  computed by AggPass (so the cell reader hits `chunk.groupTotals[valueColId]`
 *  rather than `chunk.pivotValues`). Distinct prefix so cellAt can branch
 *  cleanly. AG-Grid parity: `pivotRowTotals`. */
export const PIVOT_ROW_TOTAL_COL_PREFIX = 'pivotrowtotal';
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
  /** The pivot key path (one stringified value per pivot level). Empty
   *  array when `isRowTotal === true`. */
  pivotPath: string[];
  /** The value column being measured at this intersection. */
  valueColId: string;
  /** Cycle 18 / Task 8e — when `true`, the cell value comes from
   *  `chunk.groupTotals[valueColId]` (the row-axis total across ALL
   *  pivot values) instead of `chunk.pivotValues`. */
  isRowTotal?: boolean;
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

/** Cycle 18 / Task 8d — inverse of `pivotResultColumnId`. Decodes a
 *  synthetic colId back into its `(pivotPath, valueColId)` parts so the
 *  worker's SortPass can look up the per-group aggregate when the user
 *  sorts a pivot result column. Returns `null` for a non-synthetic id. */
export function decodePivotResultColumnId(colId: string):
  { pivotPath: string[]; valueColId: string } | null {
  if (!isPivotResultColumnId(colId)) return null;
  const parts = colId.split(PIVOT_ID_SEP);
  // [prefix, ...pivotPath, valueColId]
  if (parts.length < 3) return null;
  const valueColId = parts[parts.length - 1]!;
  const pivotPath = parts.slice(1, parts.length - 1);
  return { pivotPath, valueColId };
}

/** Cycle 18 / Task 8e — stable colId for a row-total synthetic column.
 *  One per value column, regardless of pivot key set. The cell reader
 *  resolves the cell value via `chunk.groupTotals[valueColId]`. */
export function pivotRowTotalColumnId(valueColId: string): string {
  return [PIVOT_ROW_TOTAL_COL_PREFIX, valueColId].join(PIVOT_ID_SEP);
}

/** Cycle 18 / Task 8e — true when `colId` identifies a synthesized
 *  row-total column. */
export function isPivotRowTotalColumnId(colId: string): boolean {
  return colId.startsWith(PIVOT_ROW_TOTAL_COL_PREFIX + PIVOT_ID_SEP);
}

/** Cycle 18 / Task 8e — decode a row-total colId back to its value
 *  column. Returns `null` for a non-row-total id. */
export function decodePivotRowTotalColumnId(colId: string): string | null {
  if (!isPivotRowTotalColumnId(colId)) return null;
  const parts = colId.split(PIVOT_ID_SEP);
  return parts.length >= 2 ? parts.slice(1).join(PIVOT_ID_SEP) : null;
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
  /** Cycle 18 / Task 8e — `'before' | 'after' | null`. Adds a totals
   *  column group at the start / end of the synthesized output with
   *  one leaf per value column. Cells read from `chunk.groupTotals`
   *  (no PivotPass change needed — AggPass already computes them).
   *  AG-Grid parity: `pivotRowTotals`. */
  pivotRowTotals?: 'before' | 'after' | null;
  /** Cycle 18 / Task 8e — `'before' | 'after' | null`. For multi-level
   *  pivots, the existing per-prefix "group total" leaves Task 4 emits
   *  with `columnGroupShow: 'closed'` get promoted to ALWAYS VISIBLE
   *  (no columnGroupShow stamp) at the requested position within each
   *  non-leaf pivot column group. `null` keeps the Task 4 behaviour
   *  (closed-only). AG-Grid parity: `pivotColumnGroupTotals`. */
  pivotColumnGroupTotals?: 'before' | 'after' | null;
  /** Cycle 18 / Task 8f — app-provided callback fired once per
   *  synthesized leaf colDef BEFORE the resolver sees it. Apps mutate
   *  the def in place (override headerName, set valueFormatter, add
   *  cellStyle / cellClassRules, etc.). Pivot result columns + row-
   *  total leaves both flow through this callback. AG-Grid parity:
   *  `processPivotResultColDef`. */
  processPivotResultColDef?: (colDef: CColDef<TRow>) => void;
  /** Cycle 18 / Task 8f — app-provided callback fired once per
   *  synthesized column GROUP (the pivot-key column groups; NOT the
   *  row-totals wrapper group whose identity is layout chrome). Apps
   *  mutate the group def in place — override headerName, headerClass,
   *  etc. AG-Grid parity: `processPivotResultColGroupDef`. */
  processPivotResultColGroupDef?: (groupDef: CColGroupDef<TRow>) => void;
}): SynthesizedPivotColumns<TRow> {
  const { keyTree, valueColumns } = input;
  const pivotDefaultExpanded = input.pivotDefaultExpanded ?? 0;
  const pivotRowTotals = input.pivotRowTotals ?? null;
  const pivotColumnGroupTotals = input.pivotColumnGroupTotals ?? null;
  const processColDef = input.processPivotResultColDef;
  const processGroupDef = input.processPivotResultColGroupDef;
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
        // Cycle 18 / Task 8d — synthesized columns ARE sortable; the
        // user-clicked sort lands as a SortModel entry whose colId is
        // the synthesized one, the worker's SortPass decodes
        // `(pivotPath, valueColId)` via `decodePivotResultColumnId` and
        // sorts each row-group level by the matching pivot aggregate.
        // No `field` — value comes from chunk.pivotValues, not a row
        // object key. AG-Grid parity Prompt 8.
        sortable: true,
      };
      if (vc.width !== undefined) def.width = vc.width;
      if (columnGroupShow !== undefined) def.columnGroupShow = columnGroupShow;
      // Cycle 18 / Task 8f — let the app mutate the def in place
      // (headerName, valueFormatter, cellStyle, …) BEFORE the resolver
      // sees it. The mutation is intentionally last so app overrides
      // win over the synthesis defaults.
      processColDef?.(def);
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
      const leafGroup: CColGroupDef<TRow> = {
        groupId: pivotGroupId(node.path),
        headerName: node.value,
        openByDefault: true,
        children: buildValueLeaves(node.path, hasAncestorBranch ? 'open' : undefined),
      };
      // Cycle 18 / Task 8f — app group-def hook fires AFTER children
      // are built so apps can re-read leaf shape if they want.
      processGroupDef?.(leafGroup);
      return leafGroup;
    }
    // Branch node — emit a "group total" leaf PLUS the recursive child
    // groups. The totals address the prefix path that PivotPass already
    // aggregates. Branch groups honour `pivotDefaultExpanded` per level.
    //
    // Cycle 18 / Task 8e — when `pivotColumnGroupTotals` is set, the
    // prefix-totals leaves get promoted to ALWAYS VISIBLE (no
    // columnGroupShow stamp) and the ordering switches to before / after
    // the child sub-groups per the option value. `null` keeps the
    // Cycle 18 / Task 4 behaviour: columnGroupShow:'closed' so the
    // totals leaf only appears when the group is collapsed; the leaf
    // sits at the front of the children list.
    const openByDefault = depth < pivotDefaultExpanded;
    // Cycle 18 / Task 8e — when `pivotColumnGroupTotals` is set the
    // prefix totals are ALWAYS-VISIBLE leaves that need their own
    // sub-group wrapper so the sector-depth header band has a cell to
    // paint above them (otherwise the column-tree resolver lines them
    // up against an empty header slot — visually broken when sector
    // sibling groups ARE labelled). The Cycle 18 / Task 4 default
    // (`null`) keeps the columnGroupShow:'closed' loose-leaf shape
    // since those leaves only paint when their parent collapses (no
    // sector siblings to align against, so no header gap).
    const childGroups = node.children.map((c) => buildNode(c, depth + 1, true));
    let orderedChildren: Array<CColDef<TRow> | CColGroupDef<TRow>>;
    if (pivotColumnGroupTotals === null) {
      const totals = buildValueLeaves(node.path, 'closed');
      orderedChildren = [...totals, ...childGroups];
    } else {
      const totalsLeaves = buildValueLeaves(node.path, undefined);
      const totalsGroup: CColGroupDef<TRow> = {
        groupId: [pivotGroupId(node.path), 'total'].join(PIVOT_ID_SEP),
        headerName: 'Total',
        openByDefault: true,
        children: totalsLeaves,
      };
      processGroupDef?.(totalsGroup);
      orderedChildren = pivotColumnGroupTotals === 'after'
        ? [...childGroups, totalsGroup]
        : [totalsGroup, ...childGroups];
    }
    const branchGroup: CColGroupDef<TRow> = {
      groupId: pivotGroupId(node.path),
      headerName: node.value,
      openByDefault,
      children: orderedChildren,
    };
    // Cycle 18 / Task 8f — app group-def hook.
    processGroupDef?.(branchGroup);
    return branchGroup;
  };

  const matrixDefs = keyTree.map((n) => buildNode(n, 0, false));

  // Cycle 18 / Task 8e — emit the optional row-totals group (one leaf
  // per value column). The cell reader detects the row-total prefix and
  // reads from `chunk.groupTotals[valueColId]` instead of the pivot map.
  if (pivotRowTotals !== null && valueColumns.length > 0) {
    const totalLeaves: CColDef<TRow>[] = valueColumns.map((vc) => {
      const colId = pivotRowTotalColumnId(vc.colId);
      cellSpecById.set(colId, {
        // The sentinel marker lands the same lookup PivotPass populates
        // for its row-total bucket. The join of a single-element path
        // produces the marker verbatim (no PIVOT_PATH_SEP).
        pivotPath: [PIVOT_ROW_TOTAL_PATH_MARKER],
        valueColId: vc.colId,
        isRowTotal: true,
      });
      const def: CColDef<TRow> = {
        colId,
        headerName: vc.headerName ?? vc.colId,
        cellDataType: vc.cellDataType ?? 'number',
        // Row totals are sortable too — the user can sort row groups
        // by the row-total just like by any other pivot result column.
        sortable: true,
      };
      if (vc.width !== undefined) def.width = vc.width;
      // Cycle 18 / Task 8f — also fire the column-def callback for
      // row-total leaves so apps can customise valueFormatter / cellStyle
      // on the totals column the same way they would on any other pivot
      // result column. The wrapper GROUP ("Total") is intentionally NOT
      // forwarded to processGroupDef — its identity is layout chrome.
      processColDef?.(def);
      return def;
    });
    const totalsGroup: CColGroupDef<TRow> = {
      groupId: [PIVOT_RESULT_COL_PREFIX, 'grp', 'rowtotal'].join(PIVOT_ID_SEP),
      headerName: 'Total',
      openByDefault: true,
      children: totalLeaves,
    };
    const defs = pivotRowTotals === 'before'
      ? [totalsGroup, ...matrixDefs]
      : [...matrixDefs, totalsGroup];
    return { defs, cellSpecById };
  }

  return { defs: matrixDefs, cellSpecById };
}

/** True when `groupId` identifies a synthesized pivot-result column GROUP
 *  (as opposed to a user-defined column group). The Cycle 18 / Task 4
 *  header chevron uses this to mark pivot groups as collapsible. */
export function isPivotResultGroupId(groupId: string): boolean {
  return groupId.startsWith(PIVOT_RESULT_COL_PREFIX + PIVOT_ID_SEP + 'grp' + PIVOT_ID_SEP);
}
