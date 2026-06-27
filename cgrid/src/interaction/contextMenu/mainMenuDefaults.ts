/**
 * Cycle 10 (post-cycle patch) + Cycle 15.5 / Task 2 — default MAIN menu
 * items registry.
 *
 * `buildDefaultMainMenuItems(grid, params)` produces the header / column
 * context menu — what ag-grid calls the "main menu" — distinct from the
 * cell context menu in `defaults.ts`. The cell menu is clipboard-heavy
 * (Cut / Copy / Copy with Headers / Paste / Export); the main menu is
 * column-ops-heavy and intentionally does NOT show clipboard items
 * because right-clicking a header has no cell-range context.
 *
 * Items shipped today (post 15.5 / Task 2):
 *   - Pin Column ► (Pin Left / Pin Right / No Pin)
 *   - Autosize This Column
 *   - Autosize All Columns
 *   - ────────
 *   - Reset Columns
 *   - ──────── (only when at least one group item below is visible)
 *   - Group by `<col.headerName>`   (when enableRowGroup && not grouped)
 *   - Un-Group by `<col.headerName>` (when col is currently a group level)
 *   - Expand All Groups              (when grouping is active)
 *   - Collapse All Groups            (when grouping is active)
 *
 * The group items mutate `rowGroupColumns` through the SAME primitive API
 * (`addRowGroupColumn` / `removeRowGroupColumn` / `expandAll` /
 * `collapseAll`) the row group panel + tool panel zone use. This is the
 * "three views over one ordered list" invariant the Cycle 15.5 worklog
 * calls out — Task 11's perf gate asserts mutating via any one view
 * re-renders the others.
 *
 * Design plan:
 *   docs/superpowers/plans/notes/cycle-15-grouping-design.md
 *   § Cycle 15.5 / Task 2 — icon family + ordering + visibility rules.
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

  // Cycle 15.5 / Task 2 — group section. Items appear only when the
  // grid surface exposes the predicates AND each item's visibility
  // condition holds. Mutually exclusive by design: Group-by hides when
  // the column is already grouped, Un-Group-by shows in its place.
  const rowGroupCols = grid.getRowGroupColumns?.() ?? [];
  const groupingActive = rowGroupCols.length > 0;
  const isCurrentlyGrouped = rowGroupCols.includes(colId);
  const isGroupable = grid.isColumnRowGroupEnabled?.(colId) === true;
  const headerName = grid.getColumnHeaderName?.(colId) ?? colId;
  const groupItems: MenuItem[] = [];
  if (
    isGroupable
    && !isCurrentlyGrouped
    && grid.addRowGroupColumn !== undefined
  ) {
    groupItems.push({
      name: `Group by ${headerName}`,
      icon: '☰',
      action: () => { grid.addRowGroupColumn!(colId); },
    });
  }
  if (
    isCurrentlyGrouped
    && grid.removeRowGroupColumn !== undefined
  ) {
    groupItems.push({
      name: `Un-Group by ${headerName}`,
      icon: '☰',
      action: () => { grid.removeRowGroupColumn!(colId); },
    });
  }
  if (groupingActive && grid.expandAll !== undefined) {
    groupItems.push({
      name: 'Expand All Groups',
      icon: '▾',
      action: () => { grid.expandAll!(); },
    });
  }
  if (groupingActive && grid.collapseAll !== undefined) {
    groupItems.push({
      name: 'Collapse All Groups',
      icon: '▸',
      action: () => { grid.collapseAll!(); },
    });
  }

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
  if (groupItems.length > 0) {
    items.push({ name: '---' });
    items.push(...groupItems);
  }
  return items;
}
