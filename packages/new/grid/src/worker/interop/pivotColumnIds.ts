/**
 * Pivot-result colId encoding — the worker-side half of the main thread's
 * pivot column synthesis.
 *
 * PORT-NOTE: the encode/decode pair is defined in
 * `packages/kernel/src/core/pivotColumns.ts`, which the legacy SortPass
 * reached into (`../../core/pivotColumns`) for `decodePivotResultColumnId`
 * alone — the other 400 lines of that module synthesize `CColGroupDef` trees
 * on the main thread and have no worker caller. The rebuild's `src/core/` is
 * owned by another port, so the worker keeps the id grammar here.
 *
 * `src/core/pivotColumns.ts` HAS since landed, and it declares the same
 * grammar again — deliberately not imported from here, and not imported from
 * there, for one reason: that module already imports the worker
 * (`../worker/passes/pivotPass`), so having SortPass read it back would close
 * a worker → core → worker cycle. The direction to collapse in is therefore
 * core importing this file, not the reverse.
 *
 * Until that happens the two copies must agree byte-for-byte — this is a WIRE
 * FORMAT, not a private detail. `PIVOT_ID_SEP` here is written as the escape
 * `'\u0001'`; core writes the literal control character. Same value, verified.
 * Change one prefix or the separator without the other and a sort on a
 * pivot-result column silently stops resolving: `decodePivotResultColumnId`
 * returns null, SortPass falls through to its non-pivot path, and no error is
 * raised anywhere.
 */

/** Prefix marking a synthesized pivot-result column id. */
export const PIVOT_RESULT_COL_PREFIX = 'pivotcol';
/** Prefix marking a synthesized "row total" column (AG `pivotRowTotals`). */
export const PIVOT_ROW_TOTAL_COL_PREFIX = 'pivotrowtotal';
/** Separator inside a pivot-result colId — U+0001 cannot appear in a normal
 *  colId or a stringified pivot value. */
export const PIVOT_ID_SEP = '\u0001';

/** Build the stable colId for one (pivot key path × value column)
 *  intersection. Unique per distinct path + value column. */
export function pivotResultColumnId(pivotPath: readonly string[], valueColId: string): string {
  return [PIVOT_RESULT_COL_PREFIX, ...pivotPath, valueColId].join(PIVOT_ID_SEP);
}

/** True when `colId` identifies a synthesized pivot-result column. */
export function isPivotResultColumnId(colId: string): boolean {
  return colId.startsWith(PIVOT_RESULT_COL_PREFIX + PIVOT_ID_SEP);
}

/** Inverse of `pivotResultColumnId`. Decodes a synthetic colId back into its
 *  `(pivotPath, valueColId)` parts so `SortPass` can look up the per-group
 *  aggregate when the user sorts a pivot result column. `null` for a
 *  non-synthetic id. */
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

/** Stable colId for a row-total synthetic column — one per value column,
 *  regardless of pivot key set. */
export function pivotRowTotalColumnId(valueColId: string): string {
  return [PIVOT_ROW_TOTAL_COL_PREFIX, valueColId].join(PIVOT_ID_SEP);
}

/** True when `colId` identifies a synthesized row-total column. */
export function isPivotRowTotalColumnId(colId: string): boolean {
  return colId.startsWith(PIVOT_ROW_TOTAL_COL_PREFIX + PIVOT_ID_SEP);
}

/** Decode a row-total colId back to its value column. `null` for a
 *  non-row-total id. */
export function decodePivotRowTotalColumnId(colId: string): string | null {
  if (!isPivotRowTotalColumnId(colId)) return null;
  const parts = colId.split(PIVOT_ID_SEP);
  return parts.length >= 2 ? parts.slice(1).join(PIVOT_ID_SEP) : null;
}
