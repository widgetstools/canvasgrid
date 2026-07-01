/**
 * Cycle 10 (post-cycle patch) + Cycle 15.5 / Task 2 + Cycle 18 / Task 7 —
 * default MAIN menu items registry.
 *
 * `buildDefaultMainMenuItems(grid, params)` produces the header / column
 * context menu — what ag-grid calls the "main menu" — distinct from the
 * cell context menu in `defaults.ts`. The cell menu is clipboard-heavy
 * (Cut / Copy / Copy with Headers / Paste / Export); the main menu is
 * column-ops-heavy and intentionally does NOT show clipboard items
 * because right-clicking a header has no cell-range context.
 *
 * Items shipped today (post 18 / Task 7):
 *   - Pin Column ► (Pin Left / Pin Right / No Pin)
 *   - Autosize This Column
 *   - Autosize All Columns
 *   - ────────
 *   - Reset Columns
 *   - ──────── (only when at least one role/pivot item below is visible)
 *   - Group by `<col.headerName>`     (when enableRowGroup && not grouped)
 *   - Un-Group by `<col.headerName>`  (when col is currently a group level)
 *   - Add to Labels                   (when enablePivot && not currently a pivot col)
 *   - Remove from Labels              (when currently a pivot col)
 *   - Value: Aggregate `<col>` ►      (when enableValue) — submenu lists
 *                                     registered agg names, current agg
 *                                     pre-checked; click semantics:
 *                                       not a value col       → addValueColumn
 *                                       value col + same agg  → removeValueColumn (toggle-off)
 *                                       value col + diff agg  → setValueColumnAggFunc
 *   - Expand All Groups              (when grouping is active)
 *   - Collapse All Groups            (when grouping is active)
 *   - ──────── (only when "Scroll to column" is shown)
 *   - Scroll to column               (when pivotMode === false AND col is visible)
 *
 * THE SYNC INVARIANT (Cycle 18 / Task 7 — AG-parity Prompt 7): the pivot
 * items are the THIRD view over PivotState, alongside the tool panel
 * plz/valz zones (Task 5) and the top-of-grid pivot panel (Task 6). The
 * click handlers MUST go through the same PivotState verbs the drag /
 * checkbox surfaces call (`addPivotColumn`, `removePivotColumn`,
 * `addValueColumn`, `removeValueColumn`, `setValueColumnAggFunc`) — NOT
 * a parallel code path. Triggering an item makes a matching pill appear
 * in the other two surfaces on the next `pivotStateChanged` event tick.
 *
 * Design plans:
 *   docs/superpowers/plans/notes/cycle-15-grouping-design.md
 *   docs/superpowers/plans/notes/cycle-18-pivoting-design.md
 *   /Users/develop/Downloads/pivot-behaviors-prompts.md  (Prompt 7)
 */
import type { GetMainMenuItemsParams, MenuItem } from './types';

/** Slice of the CGrid surface the main-menu registry needs. Deliberately
 *  narrow so tests can stub it with `vi.fn()` per slot, and so the next
 *  cycle's extensions (hide column, etc.) extend this interface rather
 *  than the broader `DefaultMenuGrid`. */
export interface DefaultMainMenuGrid {
  /** Cycle 6 / Task 4 — autosize specific leaf columns. The main menu
   *  uses this with a single-element array to autosize only the clicked
   *  column ("Autosize This Column"). */
  autoSizeColumns(keys: string[], skipHeader?: boolean): Promise<void>;
  /** Cycle 6 / Task 4 — autosize every visible non-suppressed leaf
   *  column (for the "Autosize All Columns" item). */
  autoSizeAllColumns(skipHeader?: boolean): Promise<void> | void;
  /** Cycle 6 / Task 2 — restore construction-time column state. */
  resetColumnState(): void;
  /** Cycle 6 / Task 5 — pin / unpin a batch of leaf columns. */
  setColumnsPinned(keys: string[], pinned: 'left' | 'right' | null): void;
  /** Cycle 15.5 / Task 2 — true when the column's resolved colDef has
   *  `enableRowGroup: true`. Gates the "Group by" item visibility.
   *  Optional for back-compat — when omitted, the menu omits both
   *  Group / Un-Group items entirely (the registry can't know whether
   *  to offer them without the predicate). */
  isColumnRowGroupEnabled?(colId: string): boolean;
  /** Cycle 15.5 / Task 2 — current row-group column id list in nesting
   *  order. Used to decide whether to show "Group by" (when colId NOT
   *  in the list) or "Un-Group by" (when it IS) and whether to show
   *  the Expand/Collapse All items (any grouping active). Optional
   *  for back-compat — same dead-path rationale as above. */
  getRowGroupColumns?(): string[];
  /** Cycle 15.5 / Task 2 — append `colId` to the row-group column list.
   *  Routes through the GroupingState primitive so the row group panel
   *  + tool panel zone re-render via `columnRowGroupChanged`. */
  addRowGroupColumn?(colId: string): void;
  /** Cycle 15.5 / Task 2 — remove `colId` from the row-group column list. */
  removeRowGroupColumn?(colId: string): void;
  /** Cycle 15.5 / Task 2 — expand every group at every level. */
  expandAll?(): void;
  /** Cycle 15.5 / Task 2 — collapse every group at every level. */
  collapseAll?(): void;
  /** Cycle 15.5 / Task 2 — resolved `headerName` for `colId`. Used to
   *  build the "Group by `<headerName>`" / "Un-Group by `<headerName>`"
   *  labels. Falls back to the raw colId when undefined. */
  getColumnHeaderName?(colId: string): string | undefined;

  // ── Cycle 18 / Task 7 — pivot surface (all optional for back-compat) ──

  /** True when `pivotMode` is currently on. The "Scroll to column" item
   *  hides under pivotMode === true (secondary pivot result columns
   *  have no 1:1 primary colId mapping to scroll to). */
  isPivotMode?(): boolean;
  /** True when the column's resolved colDef carries `enablePivot: true`.
   *  Gates the "Add to Labels" / "Remove from Labels" items. */
  isColumnPivotEnabled?(colId: string): boolean;
  /** True when the column's resolved colDef carries `enableValue: true`.
   *  Gates the "Value: Aggregate `<col>`" item + submenu. */
  isColumnValueEnabled?(colId: string): boolean;
  /** True when the column's resolved colDef does NOT carry `hide: true`
   *  (i.e. the column would render in the body if pivotMode were off).
   *  Gates the "Scroll to column" item. */
  isColumnVisible?(colId: string): boolean;
  /** Snapshot of the ordered pivot column list. Used to decide whether
   *  "Add to Labels" vs "Remove from Labels" shows. */
  getPivotColumns?(): string[];
  /** Snapshot of the ordered value column list (with current aggFunc).
   *  Used to drive the submenu's checked state + click semantics. */
  getValueColumns?(): Array<{ colId: string; aggFunc: string }>;
  /** Names of every registered aggFunc — built-in subset (`sum` / `avg`
   *  / `min` / `max` / `count`) plus any app-registered customs from
   *  `CGridOptions.aggFuncs`. Read at menu-open time so a runtime
   *  `setGridOption('aggFuncs', …)` takes effect on the next right-click. */
  getRegisteredAggFuncNames?(): string[];
  /** Append `colId` to the ordered pivot column list. Routes through
   *  the PivotState primitive so the tool panel plz zone + top-of-grid
   *  pivot panel re-render via `pivotStateChanged`. */
  addPivotColumn?(colId: string): void;
  /** Remove `colId` from the ordered pivot column list. */
  removePivotColumn?(colId: string): void;
  /** Append `colId` (with `aggFunc`) to the ordered value column list. */
  addValueColumn?(colId: string, aggFunc: string): void;
  /** Remove `colId` from the value column list. */
  removeValueColumn?(colId: string): void;
  /** Change the aggFunc of an existing value column. */
  setValueColumnAggFunc?(colId: string, aggFunc: string): void;
  /** Scroll the body horizontally so `colId`'s left edge sits inside the
   *  body viewport. Pinned columns + unknown IDs are no-ops. */
  ensureColumnVisible?(colId: string): void;
}

/** Build the default main-menu list. `params.colId` is always populated
 *  (the resolver only routes header / headerGroup hits here), so every
 *  item is safe to act on the column. */
export function buildDefaultMainMenuItems(
  grid: DefaultMainMenuGrid,
  params: GetMainMenuItemsParams,
): MenuItem[] {
  const { colId } = params;

  const pinAction = (pinned: 'left' | 'right' | null) => () => {
    grid.setColumnsPinned([colId], pinned);
  };

  const headerName = grid.getColumnHeaderName?.(colId) ?? colId;

  // Cycle 15.5 / Task 2 — group section. Items appear only when the
  // grid surface exposes the predicates AND each item's visibility
  // condition holds. Mutually exclusive by design: Group-by hides when
  // the column is already grouped, Un-Group-by shows in its place.
  const rowGroupCols = grid.getRowGroupColumns?.() ?? [];
  const groupingActive = rowGroupCols.length > 0;
  const isCurrentlyGrouped = rowGroupCols.includes(colId);
  const isGroupable = grid.isColumnRowGroupEnabled?.(colId) === true;
  const roleItems: MenuItem[] = [];
  if (
    isGroupable
    && !isCurrentlyGrouped
    && grid.addRowGroupColumn !== undefined
  ) {
    roleItems.push({
      name: `Group by ${headerName}`,
      icon: '☰',
      action: () => { grid.addRowGroupColumn!(colId); },
    });
  }
  if (
    isCurrentlyGrouped
    && grid.removeRowGroupColumn !== undefined
  ) {
    roleItems.push({
      name: `Un-Group by ${headerName}`,
      icon: '☰',
      action: () => { grid.removeRowGroupColumn!(colId); },
    });
  }

  // Cycle 18 / Task 7 — Add/Remove from Labels (pivot role).
  const isPivotable = grid.isColumnPivotEnabled?.(colId) === true;
  const pivotCols = grid.getPivotColumns?.() ?? [];
  const isCurrentlyPivoted = pivotCols.includes(colId);
  if (isPivotable && grid.isColumnPivotEnabled !== undefined) {
    if (!isCurrentlyPivoted && grid.addPivotColumn !== undefined) {
      roleItems.push({
        name: 'Add to Labels',
        icon: '⊞',
        action: () => { grid.addPivotColumn!(colId); },
      });
    } else if (isCurrentlyPivoted && grid.removePivotColumn !== undefined) {
      roleItems.push({
        name: 'Remove from Labels',
        icon: '⊟',
        action: () => { grid.removePivotColumn!(colId); },
      });
    }
  }

  // Cycle 18 / Task 7 — Value: Aggregate <col> submenu.
  const isValueable = grid.isColumnValueEnabled?.(colId) === true;
  if (isValueable && grid.isColumnValueEnabled !== undefined) {
    const valueCols = grid.getValueColumns?.() ?? [];
    const currentEntry = valueCols.find((v) => v.colId === colId);
    const aggNames = grid.getRegisteredAggFuncNames?.() ?? [];
    const subMenu: MenuItem[] = aggNames.map((aggName) => {
      const isCurrent = currentEntry !== undefined && currentEntry.aggFunc === aggName;
      const item: MenuItem = {
        name: aggName,
        action: () => {
          if (currentEntry === undefined) {
            grid.addValueColumn?.(colId, aggName);
          } else if (currentEntry.aggFunc === aggName) {
            // Click on the currently-active agg → toggle off.
            grid.removeValueColumn?.(colId);
          } else {
            grid.setValueColumnAggFunc?.(colId, aggName);
          }
        },
      };
      if (isCurrent) item.icon = '✓';
      return item;
    });
    if (subMenu.length > 0) {
      roleItems.push({
        name: `Value: Aggregate ${headerName}`,
        icon: 'Σ',
        subMenu,
      });
    }
  }

  if (groupingActive && grid.expandAll !== undefined) {
    roleItems.push({
      name: 'Expand All Groups',
      icon: '▾',
      action: () => { grid.expandAll!(); },
    });
  }
  if (groupingActive && grid.collapseAll !== undefined) {
    roleItems.push({
      name: 'Collapse All Groups',
      icon: '▸',
      action: () => { grid.collapseAll!(); },
    });
  }

  // Cycle 18 / Task 7 — Scroll to column (pivotMode-OFF parity item).
  // Secondary (pivot result) columns can't be scroll-to'd by primary
  // colId — there's no 1:1 mapping — so the item hides under
  // pivotMode === true. Also requires the column to be visible (i.e.
  // not currently hidden); scrolling to a hidden column is a no-op.
  const pivotMode = grid.isPivotMode?.() === true;
  const isVisible = grid.isColumnVisible?.(colId) === true;
  const showScrollTo =
    !pivotMode
    && isVisible
    && grid.ensureColumnVisible !== undefined
    && grid.isColumnVisible !== undefined;

  const items: MenuItem[] = [
    {
      name: 'Pin Column',
      icon: '📌',
      subMenu: [
        { name: 'Pin Left', action: pinAction('left') },
        { name: 'Pin Right', action: pinAction('right') },
        { name: 'No Pin', action: pinAction(null) },
      ],
    },
    {
      name: 'Autosize This Column',
      icon: '↔',
      action: () => { void grid.autoSizeColumns([colId]); },
    },
    {
      name: 'Autosize All Columns',
      icon: '↔',
      action: () => { void grid.autoSizeAllColumns(); },
    },
    { name: '---' },
    {
      name: 'Reset Columns',
      icon: '↺',
      action: () => { grid.resetColumnState(); },
    },
  ];
  if (roleItems.length > 0) {
    items.push({ name: '---' });
    items.push(...roleItems);
  }
  if (showScrollTo) {
    items.push({ name: '---' });
    items.push({
      name: 'Scroll to column',
      icon: '→',
      action: () => { grid.ensureColumnVisible!(colId); },
    });
  }
  return items;
}
