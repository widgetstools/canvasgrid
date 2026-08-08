/**
 * Cycle 18 / Task 6 — Pivot panel public types.
 *
 * `PivotPanelHost` mounts a horizontal DOM strip ABOVE the column
 * header row (and ABOVE the row group panel when both are present —
 * pivot is the "matrix definition" layer that wraps the row dimension).
 * The strip carries one pill per `pivotColumns[i]` (in pivot-group
 * nesting order) plus a `›` separator between adjacent pills. Users
 * drag column headers INTO the strip to append a column to
 * `pivotColumns`, drag a pill OUT to remove it (or click the `×`
 * affordance inside the pill).
 *
 * The pill chrome reuses the Task 5 shared `.vg-columns-panel-pill*`
 * classes so the visual idiom across the top-of-grid panel and the
 * sidebar plz zone stays byte-identical.
 *
 * Design plan:
 *   docs/superpowers/plans/notes/cycle-18-pivoting-design.md (Task 7
 *   "Pivot panel in side bar" — the drop-zone semantics generalize
 *   to the top-of-grid panel) + AG-Grid parity Prompt 6.
 */

/** Resolved `pivotPanelShow` discriminant — controls when the panel
 *  mounts AND paints. Mirrors AG-Grid's same-named option. Default
 *  `'never'`.
 *
 *  Unlike the row group panel's `'onlyWhenGrouping'`, the pivot panel's
 *  `'onlyWhenPivoting'` mode RESERVES the strip's height at construction
 *  so a later `setPivotMode(true)` doesn't trigger a layout reflow.
 *  Only the strip CONTENT (pills + empty placeholder) is paint-
 *  suppressed while pivot is inactive. */
export type PivotPanelShow = 'always' | 'onlyWhenPivoting' | 'never';

/** Drop-target verdict for a single column the user is dragging
 *  toward the panel. The host paints the panel's hover outline in
 *  the matching variant: `'accept'` → focus-ring color;
 *  `'reject'` → muted variant (the column lacks `enablePivot`,
 *  is already pivoted); `null` → no drag in progress / pointer
 *  outside the panel. */
export type PivotPanelDropVerdict = 'accept' | 'reject' | null;
