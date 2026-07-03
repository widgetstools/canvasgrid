/**
 * Cycle 23 / Tasks 5-7 — grid state snapshot.
 *
 * `GridState` is the union of every mutable model the grid carries:
 * column geometry, filter / sort / group state, pivot mode + columns,
 * selection (cell + row), expanded routes, side-bar state, scroll
 * position. `getState()` returns this union; `setState()` restores
 * it in the order documented in the cycle's design notes (column
 * state → filter → sort → groups → pivot → expanded → selection →
 * scroll).
 *
 * The `version` field gates schema migrations — when a snapshot from
 * an older grid version is restored, the migration registry runs it
 * forward (Task 6).
 */

import type {
  CColumnState, SortModel, FilterModel, SelectionRange,
} from '../types';

/** Bump this whenever any GridState field's shape changes
 *  (renamed key, value-type change, mandatory new field). Keep
 *  `core/stateMigrations.ts` in sync — every bump needs a migrator
 *  for the prior version. */
export const STATE_SCHEMA_VERSION = 1;

export interface GridState {
  /** Schema version of the snapshot. Apps round-tripping snapshots
   *  through localStorage should pass the stored value back as-is —
   *  the grid handles forward migrations on `setState`. */
  version: number;

  // Column geometry (Cycle 6) — width, pinned, hide, sort, rowGroup,
  // pivot, value, position. Single primitive that subsumes the
  // per-column knobs.
  columnState?: CColumnState[];

  // Filter pipeline (Cycle 7).
  filterModel?: FilterModel;

  // Sort order (Cycle 8).
  sortModel?: SortModel;

  // Row grouping (Cycle 15).
  rowGroupColumns?: string[];

  // Expanded group keys (Cycle 15 / Task 7). Stored as an array
  // (not a Set) so the snapshot is JSON-serializable.
  expandedRouteIds?: string[];

  // Pivot (Cycle 18).
  pivotMode?: boolean;
  pivotCols?: string[];

  // Side bar (Cycle 11).
  sideBar?: {
    openedToolPanel: string | null;
    visible: boolean;
  };

  // Runtime-touched grid options (Cycle 21i / Phase 1). Only options
  // changed via `setGridOption` / `updateGridOptions` after construction,
  // and only JSON-serializable non-data keys (see
  // NON_PERSISTABLE_RUNTIME_OPTIONS in cgrid.ts). Restored FIRST on
  // `setState` so option-driven layout (row heights, panels) settles
  // before column state applies.
  gridOptions?: Record<string, unknown>;

  // Cell ranges + focused cell (Cycle 9).
  cellSelection?: {
    ranges: SelectionRange[];
    focused: { rowId: string; colId: string } | null;
  };

  // Persistent row selection (Cycle 12+).
  rowSelection?: string[];

  // Scroll position (Cycle 4). Last so the viewport math runs after
  // every model that affects layout has settled.
  scroll?: { top: number; left: number };
}

/** Helpers the grid uses to build / consume a snapshot. The minimal
 *  surface lives here so the implementation can grow without leaking
 *  back into the CGrid class file. */
export interface StateSnapshotSources {
  getColumnState(): CColumnState[];
  getFilterModel(): FilterModel;
  getSortModel(): SortModel;
  getRowGroupColumns(): string[];
  getExpandedKeys(): Set<string>;
  isPivotMode(): boolean;
  getPivotColumns(): string[];
  isSideBarVisible(): boolean;
  getOpenedToolPanel(): string | null;
  getCellRanges(): SelectionRange[];
  getFocusedCell(): { rowId: string; colId: string } | null;
  getSelectedRowIds(): string[];
  getScrollPosition(): { top: number; left: number };
  /** Cycle 21i / Phase 1 — runtime-touched, persistable option values. */
  getRuntimeOptions?(): Record<string, unknown>;
}

/** Schema migrations. Each entry runs over a snapshot whose
 *  `version` matches the registry key and returns the snapshot at
 *  `version + 1`. The chain runs forward from the snapshot's stored
 *  version until it matches `STATE_SCHEMA_VERSION`. Empty when no
 *  migrations exist yet (v1 is the inaugural shape). */
export const STATE_MIGRATIONS: Record<number, (s: GridState) => GridState> = {};

/** Forward-migrate a snapshot from its stored version to the current
 *  schema version. Snapshots already at the current version flow
 *  through unchanged; unknown future versions throw so the caller
 *  can surface a clear error instead of silently restoring partial
 *  state. */
export function migrateSnapshot(snapshot: GridState): GridState {
  let v = snapshot.version ?? 1;
  let current = snapshot;
  if (v > STATE_SCHEMA_VERSION) {
    throw new Error(
      `[cgrid] cannot restore state: snapshot version ${v} is newer than this build (${STATE_SCHEMA_VERSION})`,
    );
  }
  while (v < STATE_SCHEMA_VERSION) {
    const step = STATE_MIGRATIONS[v];
    if (!step) {
      throw new Error(`[cgrid] missing schema migration from version ${v} → ${v + 1}`);
    }
    current = step(current);
    v++;
  }
  return { ...current, version: STATE_SCHEMA_VERSION };
}

/** Compose a GridState snapshot from the supplied sources. Each
 *  field is included only when it carries information — an empty
 *  filter map / row-group list / selection list is omitted so
 *  snapshots stay compact. */
export function buildSnapshot(sources: StateSnapshotSources): GridState {
  const snapshot: GridState = { version: STATE_SCHEMA_VERSION };

  const columnState = sources.getColumnState();
  if (columnState.length > 0) snapshot.columnState = columnState;

  const filterModel = sources.getFilterModel();
  if (Object.keys(filterModel).length > 0) snapshot.filterModel = filterModel;

  const sortModel = sources.getSortModel();
  if (sortModel.length > 0) snapshot.sortModel = sortModel;

  const rowGroupColumns = sources.getRowGroupColumns();
  if (rowGroupColumns.length > 0) snapshot.rowGroupColumns = rowGroupColumns;

  const expanded = Array.from(sources.getExpandedKeys());
  if (expanded.length > 0) snapshot.expandedRouteIds = expanded;

  if (sources.isPivotMode()) snapshot.pivotMode = true;
  const pivotCols = sources.getPivotColumns();
  if (pivotCols.length > 0) snapshot.pivotCols = pivotCols;

  const opened = sources.getOpenedToolPanel();
  const visible = sources.isSideBarVisible();
  if (opened !== null || visible) snapshot.sideBar = { openedToolPanel: opened, visible };

  const runtimeOptions = sources.getRuntimeOptions?.();
  if (runtimeOptions && Object.keys(runtimeOptions).length > 0) {
    snapshot.gridOptions = runtimeOptions;
  }

  const ranges = sources.getCellRanges();
  const focused = sources.getFocusedCell();
  if (ranges.length > 0 || focused !== null) {
    snapshot.cellSelection = { ranges, focused };
  }

  const selectedRows = sources.getSelectedRowIds();
  if (selectedRows.length > 0) snapshot.rowSelection = selectedRows;

  const scroll = sources.getScrollPosition();
  if (scroll.top !== 0 || scroll.left !== 0) snapshot.scroll = scroll;

  return snapshot;
}
