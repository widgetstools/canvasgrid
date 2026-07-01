/**
 * Cycle 15 / Task 6 — Row group panel public types.
 *
 * `RowGroupPanelHost` mounts a horizontal DOM strip ABOVE the column
 * header row. The strip carries one chip per `rowGroupCols[i]` (in
 * nesting order) plus a `›` separator between adjacent chips. Users
 * drag column headers INTO the strip to append a column to
 * `rowGroupCols`, drag a chip OUT to remove it (or click the `×`
 * affordance inside the chip).
 *
 * Design plan:
 *   docs/superpowers/plans/notes/cycle-15-grouping-design.md § Task 6.
 */

/** Resolved `rowGroupPanelShow` discriminant — controls when the
 *  panel mounts. Mirrors ag-grid's same-named option. Default
 *  `'never'`. */
export type RowGroupPanelShow = 'always' | 'onlyWhenGrouping' | 'never';

/** Drop-target verdict for a single column the user is dragging
 *  toward the panel. The host paints the panel's hover outline in
 *  the matching variant: `'accept'` → focus-ring color;
 *  `'reject'` → muted variant (the column lacks `enableRowGroup`,
 *  is already grouped, or is the auto-group column itself); `null`
 *  → no drag in progress / pointer outside the panel. */
export type RowGroupPanelDropVerdict = 'accept' | 'reject' | null;

/** Per-chip render params handed to the chip-builder. Kept open so
 *  Cycle 16+ extensions (sort indicators, custom icons) can layer in
 *  without breaking the Cycle 15 chip shape. */
export interface RowGroupChipParams {
  /** Column id that this chip represents. Matches the
   *  `rowGroupCols[i]` entry the chip was built from. */
  colId: string;
  /** Resolved `headerName` for the column. Falls back to `colId`
   *  when the column def has no header name. */
  label: string;
  /** Position of this chip in the chip strip (0-based). Mirrors the
   *  `rowGroupCols[i]` index. */
  index: number;
}
