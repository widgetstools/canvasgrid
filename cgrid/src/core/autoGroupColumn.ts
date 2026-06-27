import type { CColDef, GroupModel } from '../types';
import { resolveColDef, type ResolvedColDef } from './propertyChain';

/**
 * Cycle 15 / Task 4 — synthesized auto-group column.
 *
 * When `rowGroupCols.length > 0` AND `groupDisplayType` resolves to
 * `'singleColumn'` (the default), `buildAutoGroupColumn` returns a single
 * resolved column that the cgrid layer inserts at index 0 of the visible
 * leaf order. Each cell renders via the `'group'` cell renderer
 * (`renderer/cellRenderers/group.ts`) — data rows paint nothing; group
 * rows paint chevron + indent + value + optional `(count)`.
 *
 * Design notes:
 *   `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 4.
 *
 * Architecture rules:
 *   - The synthesized def must round-trip through `resolveColDef` so the
 *     resulting `ResolvedColDef` inherits every default the rest of the
 *     painter / interaction stack relies on (`minWidth`, `cellClassFn`,
 *     etc.).
 *   - The column is NOT sortable (`sortable: false`). Sorting groups by
 *     value lands in Task 11's `groupSort`.
 *   - The column is resizable + movable by default; apps override via
 *     `autoGroupColumnDef`.
 */

/** The stable colId of the auto-group column. Identical to ag-grid's
 *  legacy `'ag-Grid-AutoColumn'` constant so app code that references
 *  the id by string keeps working without a rename. */
export const AUTO_GROUP_COLUMN_ID = 'ag-Grid-AutoColumn';

/** The cell renderer key the auto-group column uses by default. The
 *  `'group'` painter is registered in `cgrid.ts` alongside the other
 *  built-ins. */
export const AUTO_GROUP_RENDERER = 'group';

/** Default `headerName` when the app does not override via
 *  `autoGroupColumnDef.headerName`. Matches ag-grid's default label. */
export const AUTO_GROUP_DEFAULT_HEADER_NAME = 'Group';

/** Default column width in CSS px. Wide enough to fit 3 levels of indent
 *  (3 × 14 + 6 + 12 + 6 + 6 = ~72 for the chrome) PLUS a ~120 px value
 *  + count. Apps override via `autoGroupColumnDef.width`. */
export const AUTO_GROUP_DEFAULT_WIDTH = 200;

export type GroupDisplayType = 'singleColumn' | 'multipleColumns' | 'groupRows' | 'custom';

/** Resolved value for `CGridOptions.groupDisplayType`. Defaults to
 *  `'singleColumn'` when undefined — matches ag-grid's default. */
export function resolveGroupDisplayType(value: GroupDisplayType | undefined): GroupDisplayType {
  return value ?? 'singleColumn';
}

/** Should the cgrid layer insert a SINGLE auto-group column at index 0
 *  of the visible leaf order?
 *
 *  Yes when:
 *    - `rowGroupCols.length > 0` (grouping is active), AND
 *    - `groupDisplayType === 'singleColumn'`.
 *
 *  `'multipleColumns'` synthesizes N auto-group columns (Task 5);
 *  `'groupRows'` spans the value across the row (Task 5);
 *  `'custom'` defers to `groupRowRenderer` (Task 5). All three return
 *  `false` here — Task 5 handles the alternatives. */
export function shouldInsertAutoGroupColumn(
  groupModel: GroupModel,
  groupDisplayType: GroupDisplayType,
): boolean {
  if (groupModel.rowGroupCols.length === 0) return false;
  return groupDisplayType === 'singleColumn';
}

export interface AutoGroupColumnInput<TRow = unknown> {
  /** App-supplied `autoGroupColumnDef` override (a partial `CColDef`). When
   *  provided, its fields layer onto the built-in defaults below. The
   *  `colId` field, if present, is ignored — the synthesized column
   *  always uses `AUTO_GROUP_COLUMN_ID`. */
  override?: Partial<CColDef<TRow>>;
}

/** Build the resolved auto-group column. The returned def carries:
 *  - `colId: 'ag-Grid-AutoColumn'`
 *  - `cellRenderer: 'group'`
 *  - `sortable: false`
 *  - `resizable: true`
 *  - `width: 200` (default) — apps override via `autoGroupColumnDef.width`
 *  - `headerName: 'Group'` — apps override via `autoGroupColumnDef.headerName`
 *
 *  Round-trips through `resolveColDef` so every downstream `ResolvedColDef`
 *  consumer keeps working without a special case for synthesized columns.
 *
 *  Cycle 15 / Task 4.
 */
export function buildAutoGroupColumn<TRow = unknown>(
  input: AutoGroupColumnInput<TRow> = {},
): ResolvedColDef<TRow> {
  const override = input.override ?? {};

  // Merge order: built-in defaults <- app override. The colId is forced —
  // an app override with a stray `colId` would otherwise create a column
  // the cgrid layer can't find via the canonical constant.
  const merged: CColDef<TRow> = {
    ...override,
    colId: AUTO_GROUP_COLUMN_ID,
    headerName: override.headerName ?? AUTO_GROUP_DEFAULT_HEADER_NAME,
    width: override.width ?? AUTO_GROUP_DEFAULT_WIDTH,
    cellRenderer: override.cellRenderer ?? AUTO_GROUP_RENDERER,
    cellDataType: 'text',
    sortable: override.sortable ?? false,
    resizable: override.resizable ?? true,
  };

  // `resolveColDef` rejects defs without a `colId` AND a `field`; we
  // supply `colId` so the resolver runs cleanly without us pretending
  // a field exists. The synthesized column has no `field` — its cell
  // value is derived from chunk row-level data, not from a row object's
  // key.
  return resolveColDef<TRow>(merged);
}
