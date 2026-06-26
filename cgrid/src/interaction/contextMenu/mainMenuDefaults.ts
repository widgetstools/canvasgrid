/**
 * Cycle 10 (post-cycle patch) — default MAIN menu items registry.
 *
 * `buildDefaultMainMenuItems(grid, params)` produces the header / column
 * context menu — what ag-grid calls the "main menu" — distinct from the
 * cell context menu in `defaults.ts`. The cell menu is clipboard-heavy
 * (Cut / Copy / Copy with Headers / Paste / Export); the main menu is
 * column-ops-heavy and intentionally does NOT show clipboard items
 * because right-clicking a header has no cell-range context.
 *
 * Items shipped today:
 *   - Pin Column ► (Pin Left / Pin Right / No Pin)
 *   - Autosize This Column
 *   - Autosize All Columns
 *   - ────────
 *   - Reset Columns
 *
 * Future cycles will extend this with `Hide Column` (Cycle 11 column-state
 * surface), `Choose Columns` (Cycle 11 tool panel), `Group By <colName>`
 * (Cycle 13 grouping), `Filter ►` (existing Cycle 7 filter popup, just
 * not yet wired into the header menu).
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

  return [
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
}
