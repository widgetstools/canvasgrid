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
import type { SerializedNode } from '../interaction/columnGroups/model';
import type { ModuleStateEnvelope } from './moduleState';
import type { FloatingRect } from '../interaction/floatingPanel/geometry';

/** Bump this whenever any GridState field's shape changes
 *  (renamed key, value-type change, mandatory new field). Keep
 *  `core/stateMigrations.ts` in sync — every bump needs a migrator
 *  for the prior version. */
export const STATE_SCHEMA_VERSION = 4;

export interface GridState {
  /** Schema version of the snapshot. Apps round-tripping snapshots
   *  through localStorage should pass the stored value back as-is —
   *  the grid handles forward migrations on `setState`. */
  version: number;

  // Column geometry (Cycle 6) — width, pinned, hide, sort, rowGroup,
  // pivot, value, position. Single primitive that subsumes the
  // per-column knobs.
  columnState?: CColumnState[];

  // Column-GROUP structure overlay (Cycle 21i / Task 6).
  // @deprecated v3 — Phase 2 / T2 moved this slice into
  // `modules.columnGroups.data.defs`; the v3→v4 migrator relocates it.
  // Kept OPTIONAL so pre-Phase-2 snapshots still typecheck as input.
  columnGroupDefs?: SerializedNode[];

  // Column-GROUP runtime open/collapse state (Cycle 21i / Task 8).
  // @deprecated v3 — Phase 2 / T2 moved this slice into
  // `modules.columnGroups.data.open`; the v3→v4 migrator relocates it.
  columnGroupOpen?: { groupId: string; open: boolean }[];

  // Engine-owned module slices (Cycle 21i Phase 2 / T2) — one named,
  // versioned envelope per registered `StateModule` (rules, calc,
  // column formatting, edit journal, … as they land). The kernel's
  // own built-in slice is `columnGroups` ({ defs, open } — the Task
  // 6/8 overlay relocated behind the registry). Envelope shape
  // matches the StarUI ConfigManager profile bundle: per-module
  // `{ version, data }`. Restored right after gridOptions/themeParams
  // and BEFORE `columnState`, so structural module slices (column
  // groups) settle before per-leaf geometry applies on top. Restore
  // degrades gracefully per-slice — see `ModuleStateRegistry.restore`.
  modules?: Record<string, ModuleStateEnvelope>;

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

  // Theme token overrides set via `setThemeParams` (Cycle 21i / Phase 1) —
  // data colours (row selection, cell range, flash) configured through the
  // Grid Options color picker. Restored alongside gridOptions.
  themeParams?: Record<string, string>;

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

  // Last known position/size of the generic floating panel (see
  // `CGrid.openFloatingPanel`, e.g. the Column Groups per-group Style
  // editor). NOT restored to an open float on load — only the rect is
  // remembered so a later open reopens where the user left it.
  toolPanelPopoutRect?: FloatingRect;
}

/** Helpers the grid uses to build / consume a snapshot. The minimal
 *  surface lives here so the implementation can grow without leaking
 *  back into the CGrid class file. */
export interface StateSnapshotSources {
  getColumnState(): CColumnState[];
  /** Cycle 21i Phase 2 / T2 — every registered module's `{version,
   *  data}` envelope (see `GridState.modules`). The kernel's own
   *  column-groups slice (formerly the dedicated
   *  `getColumnGroupOverlay` / `getColumnGroupOpenState` sources)
   *  rides this too. Optional so test harnesses without a registry
   *  still satisfy the interface. */
  getModuleState?(): Record<string, ModuleStateEnvelope> | undefined;
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
  /** Cycle 21i / Phase 1 — theme token overrides set via setThemeParams. */
  getThemeParams?(): Record<string, string>;
  /** Last known floating-panel rect, if any (see `toolPanelPopoutRect`). */
  getToolPanelPopoutRect?(): FloatingRect | undefined;
}

/** Schema migrations. Each entry runs over a snapshot whose
 *  `version` matches the registry key and returns the snapshot at
 *  `version + 1`. The chain runs forward from the snapshot's stored
 *  version until it matches `STATE_SCHEMA_VERSION`. */
export const STATE_MIGRATIONS: Record<number, (s: GridState) => GridState> = {
  // v1 -> v2 (Cycle 21i / Task 6): added the OPTIONAL `columnGroupDefs`
  // field. No shape change to any existing field — a v1 snapshot restores
  // unchanged (it simply lacks the group overlay, exactly like a flat
  // grid's own snapshot omits it). Identity migrator; `migrateSnapshot`
  // stamps the bumped `version` on the result.
  1: (s) => s,
  // v2 -> v3 (Cycle 21i / Task 8): added the OPTIONAL `columnGroupOpen`
  // field. No shape change to any existing field — a v2 snapshot restores
  // unchanged (it simply lacks the runtime open/collapse overlay, exactly
  // like a flat grid's own snapshot omits it). Identity migrator.
  2: (s) => s,
  // v3 -> v4 (Cycle 21i Phase 2 / T2): the column-group overlay moved
  // behind the module-state registry. Relocate the legacy top-level
  // `columnGroupDefs` / `columnGroupOpen` fields into the
  // `modules.columnGroups` envelope (module version 1) so `setState`
  // has ONE restore path. Snapshots without groups pass through
  // unchanged.
  3: (s) => relocateLegacyGroupFields(s),
};

/** Move the deprecated top-level `columnGroupDefs` / `columnGroupOpen`
 *  fields into the `modules.columnGroups` envelope. Runs as the v3→v4
 *  migrator AND unconditionally in `migrateSnapshot` — a snapshot
 *  composed programmatically at v4 with the (still-typed, deprecated)
 *  legacy fields would otherwise typecheck but silently drop them. An
 *  existing `modules.columnGroups` envelope wins over legacy fields. */
function relocateLegacyGroupFields(s: GridState): GridState {
  const { columnGroupDefs, columnGroupOpen, ...rest } = s;
  if (!columnGroupDefs && !columnGroupOpen) return s;
  if (rest.modules?.columnGroups) return rest as GridState;
  const data: { defs?: unknown; open?: unknown } = {};
  if (columnGroupDefs) data.defs = columnGroupDefs;
  if (columnGroupOpen) data.open = columnGroupOpen;
  return {
    ...rest,
    modules: { ...rest.modules, columnGroups: { version: 1, data } },
  };
}

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
  // Deprecated fields are relocated regardless of the stored version —
  // see relocateLegacyGroupFields.
  current = relocateLegacyGroupFields(current);
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

  const modules = sources.getModuleState?.();
  if (modules) snapshot.modules = modules;

  const filterModel = sources.getFilterModel();
  if (Object.keys(filterModel).length > 0) snapshot.filterModel = filterModel;

  const sortModel = sources.getSortModel();
  if (sortModel.length > 0) snapshot.sortModel = sortModel;

  const rowGroupColumns = sources.getRowGroupColumns();
  if (rowGroupColumns.length > 0) snapshot.rowGroupColumns = rowGroupColumns;

  // When grouping is active, always persist expansion — including an
  // empty array for "all collapsed". Omitting the field would look like
  // "no opinion" and restore would fall back to groupDefaultExpanded
  // (typically all open).
  if (rowGroupColumns.length > 0) {
    snapshot.expandedRouteIds = Array.from(sources.getExpandedKeys());
  } else {
    const expanded = Array.from(sources.getExpandedKeys());
    if (expanded.length > 0) snapshot.expandedRouteIds = expanded;
  }

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

  const themeParams = sources.getThemeParams?.();
  if (themeParams && Object.keys(themeParams).length > 0) {
    snapshot.themeParams = themeParams;
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

  const toolPanelPopoutRect = sources.getToolPanelPopoutRect?.();
  if (toolPanelPopoutRect) snapshot.toolPanelPopoutRect = toolPanelPopoutRect;

  return snapshot;
}
