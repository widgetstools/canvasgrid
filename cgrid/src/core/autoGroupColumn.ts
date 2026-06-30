import type { CColDef, GroupModel } from '../types';
import { resolveColDef, type ResolvedColDef } from './propertyChain';

/**
 * Cycle 15 / Task 4 + Task 5 — synthesized auto-group column(s).
 *
 * Task 4 shipped the `'singleColumn'` variant: one column at index 0 of
 * the visible-leaf order rendering chevron + indent + value + (count) for
 * every group row. Task 5 adds:
 *
 *   - `'multipleColumns'` — synthesize ONE auto-group column per
 *     `rowGroupCols[i]` entry. Each column "owns" one group depth via
 *     `cellRendererParams.groupColumnDepth`. The `'group'` renderer
 *     paints chrome ONLY when the row's depth matches the column's slot;
 *     other cells stay blank.
 *   - `'groupRows'` — NO auto-group columns. Group rows render as a
 *     full-row strip in the body painter (`byRows.ts`). Synthesis returns
 *     an empty list.
 *   - `'custom'` — NO auto-group columns. Group rows defer to
 *     `CGridOptions.groupRowRenderer` (or fall back to the `'group'`
 *     renderer in groupRows mode when the option is unset). Synthesis
 *     returns an empty list.
 *
 * Design notes:
 *   `docs/superpowers/plans/notes/cycle-15-grouping-design.md` § Task 4
 *   (singleColumn) + Task 5 (multipleColumns / groupRows / custom).
 *
 * Architecture rules:
 *   - Synthesized defs round-trip through `resolveColDef` so the resulting
 *     `ResolvedColDef` inherits every default the painter / interaction
 *     stack relies on (`minWidth`, `cellClassFn`, etc.).
 *   - Synthesized columns are NOT sortable (`sortable: false`). Sorting
 *     groups by value lands in Task 11's `groupSort`.
 *   - Synthesized columns are resizable + movable by default; apps
 *     override via `autoGroupColumnDef` (applied uniformly to every
 *     column in `'multipleColumns'` mode).
 *   - The `colId` of each synthesized column is forced — apps cannot
 *     override it, otherwise the cgrid layer would lose its handle on
 *     the column.
 */

/** Canonical prefix for synthesized auto-group columns. Matches ag-grid's
 *  legacy `'ag-Grid-AutoColumn'` constant so app code referencing the id
 *  by string keeps working. In `'singleColumn'` mode the colId equals
 *  this constant exactly; in `'multipleColumns'` mode each per-level
 *  column appends `'-${depth}'` (e.g. `ag-Grid-AutoColumn-0`,
 *  `ag-Grid-AutoColumn-1`). */
export const AUTO_GROUP_COLUMN_ID = 'ag-Grid-AutoColumn';

/** Build the canonical auto-group colId for a per-level column in
 *  `'multipleColumns'` mode. Index matches `rowGroupCols[i]`. */
export function autoGroupColumnIdForDepth(depth: number): string {
  return `${AUTO_GROUP_COLUMN_ID}-${depth}`;
}

/** Returns `true` when `colId` identifies any synthesized auto-group
 *  column (singleColumn or any per-level multipleColumns slot). Used by
 *  the cgrid layer to route `cellAt` through the group-context lookup
 *  instead of the standard numeric/text reader. */
export function isAutoGroupColumnId(colId: string): boolean {
  if (colId === AUTO_GROUP_COLUMN_ID) return true;
  return colId.startsWith(`${AUTO_GROUP_COLUMN_ID}-`);
}

/** Returns the depth a synthesized multipleColumns auto-group column
 *  owns, or `null` for the singleColumn variant / non-auto-group
 *  colIds. The renderer also reads depth from
 *  `cellRendererParams.groupColumnDepth`; this helper is for callers
 *  that only have the colId at hand (e.g. `cellAt`). */
export function autoGroupColumnDepthFromId(colId: string): number | null {
  if (!colId.startsWith(`${AUTO_GROUP_COLUMN_ID}-`)) return null;
  const tail = colId.slice(AUTO_GROUP_COLUMN_ID.length + 1);
  const n = Number(tail);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** The cell renderer key the auto-group column uses by default. The
 *  `'group'` painter is registered in `cgrid.ts` alongside the other
 *  built-ins. */
export const AUTO_GROUP_RENDERER = 'group';

/** Default `headerName` when the app does not override via
 *  `autoGroupColumnDef.headerName`. Matches ag-grid's default label. */
export const AUTO_GROUP_DEFAULT_HEADER_NAME = 'Group';

/** Default column width for `'singleColumn'` mode. Wide enough to fit
 *  3 levels of indent (3 × 14 + chrome = ~72 for the leading area) +
 *  ~120 px value + count. Apps override via `autoGroupColumnDef.width`. */
export const AUTO_GROUP_DEFAULT_WIDTH = 200;

/** Default column width PER LEVEL in `'multipleColumns'` mode. Smaller
 *  than the singleColumn default because each column "owns" exactly one
 *  depth (no per-cell indent inside the column) and the levels stack
 *  horizontally. 140 px × 3 levels ≈ 420 px of group spine — on the
 *  order of the singleColumn 200 px but split across N columns so each
 *  carries its own chevron + value + (count). */
export const AUTO_GROUP_MULTIPLE_DEFAULT_WIDTH = 140;

export type GroupDisplayType = 'singleColumn' | 'multipleColumns' | 'groupRows' | 'custom';

/** Resolved value for `CGridOptions.groupDisplayType`. Defaults to
 *  `'singleColumn'` when undefined — matches ag-grid's default. */
export function resolveGroupDisplayType(value: GroupDisplayType | undefined): GroupDisplayType {
  return value ?? 'singleColumn';
}

/** Should the cgrid layer paint a full-row group strip in the body
 *  painter? `true` for `'groupRows'` AND `'custom'` (the strip is the
 *  same allocation in both; only the renderer differs). `false` for
 *  `'singleColumn'` and `'multipleColumns'` — those modes paint
 *  per-cell via the auto-group columns. */
export function isGroupRowStripMode(displayType: GroupDisplayType): boolean {
  return displayType === 'groupRows' || displayType === 'custom';
}

/** Should the cgrid layer insert a SINGLE auto-group column at index 0
 *  of the visible-leaf order?
 *
 *  Yes when:
 *    - `rowGroupCols.length > 0` (grouping is active), AND
 *    - `groupDisplayType === 'singleColumn'`.
 *
 *  `'multipleColumns'` synthesizes N auto-group columns via
 *  `synthesizeAutoGroupColumns` (Task 5); `'groupRows'` and `'custom'`
 *  paint a full-row strip in the body painter — no per-cell columns.
 *  All three return `false` here. */
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

/** Build the resolved SINGLE-COLUMN auto-group column. The returned def carries:
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
    // The auto-group column is always rendered at the leftmost slot
    // (just after a selection column when that's added later); the
    // visible-leaf order builder re-prepends it on every recompute,
    // so a UI drag would never stick. Suppress the movable affordance
    // by default so the header cursor doesn't suggest a drag the
    // engine ignores. Apps that really want it draggable can opt in
    // via `autoGroupColumnDef: { suppressMovable: false }`.
    suppressMovable: override.suppressMovable ?? true,
  };

  // `resolveColDef` rejects defs without a `colId` AND a `field`; we
  // supply `colId` so the resolver runs cleanly without us pretending
  // a field exists. The synthesized column has no `field` — its cell
  // value is derived from chunk row-level data, not from a row object's
  // key.
  return resolveColDef<TRow>(merged);
}

/** Per-cell renderer params threaded onto every multipleColumns
 *  auto-group column so the `'group'` renderer knows which depth the
 *  column owns. The renderer paints chrome ONLY when the row's
 *  `groupDepth === groupColumnDepth` AND `rowKind === 1`. */
export interface AutoGroupColumnRendererParams {
  /** The 0-indexed group depth this column owns. Matches
   *  `rowGroupCols[groupColumnDepth]`. `undefined` in singleColumn mode
   *  — the renderer paints any depth in that case. */
  readonly groupColumnDepth: number;
}

export interface AutoGroupColumnsInput<TRow = unknown> {
  groupModel: GroupModel;
  groupDisplayType: GroupDisplayType;
  /** App-supplied `autoGroupColumnDef` override applied uniformly to every
   *  synthesized column. The `colId` field, if present, is ignored; the
   *  `cellRendererParams.groupColumnDepth` is filled in per column AFTER
   *  the override merges so apps cannot accidentally point every column
   *  at the same depth. */
  override?: Partial<CColDef<TRow>>;
  /** Optional per-level headerName lookup. When provided, each
   *  synthesized column at index `i` uses `headerNames[i]` (typically
   *  the source grouping column's `headerName`); when missing or undefined
   *  for a level, the column falls back to `AUTO_GROUP_DEFAULT_HEADER_NAME`.
   *  Length need not match `rowGroupCols.length` — extras are ignored,
   *  shorter arrays fall back per slot. */
  headerNames?: ReadonlyArray<string | undefined>;
}

export interface AutoGroupColumnsSynthesis<TRow = unknown> {
  /** Resolved auto-group columns to insert at the start of the
   *  visible-leaf order. Empty when no columns synthesize (groupRows,
   *  custom, or bypassed). */
  columns: ResolvedColDef<TRow>[];
  /** Display type the synthesis was computed against. Returned so the
   *  caller can dispatch downstream (e.g., enable the groupRows
   *  full-row paint mode). */
  displayType: GroupDisplayType;
  /** `true` when the body painter should render group rows as full-row
   *  strips instead of per-cell. Mirrors `isGroupRowStripMode(displayType)`
   *  so callers can read one field instead of re-resolving the predicate. */
  fullRowStrip: boolean;
}

/** Synthesize the auto-group column(s) for the active `groupModel` +
 *  `groupDisplayType`. Returns an empty `columns` list when grouping is
 *  bypassed (`rowGroupCols.length === 0`) OR the mode renders rows full-
 *  width (`'groupRows'`, `'custom'`). The cgrid layer reads `fullRowStrip`
 *  to decide whether the body painter needs the strip code path.
 *
 *  Cycle 15 / Task 5.
 */
export function synthesizeAutoGroupColumns<TRow = unknown>(
  input: AutoGroupColumnsInput<TRow>,
): AutoGroupColumnsSynthesis<TRow> {
  const { groupModel, groupDisplayType } = input;
  const fullRowStrip = isGroupRowStripMode(groupDisplayType);

  if (groupModel.rowGroupCols.length === 0) {
    return { columns: [], displayType: groupDisplayType, fullRowStrip: false };
  }

  if (groupDisplayType === 'singleColumn') {
    return {
      columns: [buildAutoGroupColumn<TRow>({ override: input.override })],
      displayType: groupDisplayType,
      fullRowStrip: false,
    };
  }

  if (groupDisplayType === 'multipleColumns') {
    const override = input.override ?? {};
    const headerNames = input.headerNames ?? [];
    const columns: ResolvedColDef<TRow>[] = [];
    for (let depth = 0; depth < groupModel.rowGroupCols.length; depth++) {
      const colId = autoGroupColumnIdForDepth(depth);
      const headerName = headerNames[depth] ?? override.headerName ?? AUTO_GROUP_DEFAULT_HEADER_NAME;
      // Build per-level cellRendererParams. The override's params, when
      // present, supplies extra app fields (e.g., `showCount: false`); the
      // depth tag is appended last so apps cannot accidentally overwrite
      // it with a stale value. Spreading guards against non-object
      // `cellRendererParams` (the type is `unknown`).
      const overrideParams =
        override.cellRendererParams !== null
        && typeof override.cellRendererParams === 'object'
          ? (override.cellRendererParams as Record<string, unknown>)
          : null;
      const cellRendererParams: AutoGroupColumnRendererParams & Record<string, unknown> = {
        ...(overrideParams ?? {}),
        groupColumnDepth: depth,
      };
      const merged: CColDef<TRow> = {
        ...override,
        colId,
        headerName,
        width: override.width ?? AUTO_GROUP_MULTIPLE_DEFAULT_WIDTH,
        cellRenderer: override.cellRenderer ?? AUTO_GROUP_RENDERER,
        cellRendererParams,
        cellDataType: 'text',
        sortable: override.sortable ?? false,
        resizable: override.resizable ?? true,
      };
      columns.push(resolveColDef<TRow>(merged));
    }
    return { columns, displayType: groupDisplayType, fullRowStrip: false };
  }

  // 'groupRows' and 'custom' — no auto-group columns. The body painter
  // renders group rows as a full-row strip; `fullRowStrip: true` flags
  // that mode to callers.
  return { columns: [], displayType: groupDisplayType, fullRowStrip };
}
