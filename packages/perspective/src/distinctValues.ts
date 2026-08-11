/**
 * Extract set-filter values from a Perspective grouped `to_json` dump.
 *
 * On a `group_by` View, `row[colId]` is an **aggregate** (often `count` =
 * leaf count). The real unique keys live only on `__ROW_PATH__`.
 * Set filters must never read the aggregate field.
 */

export type GroupedDistinctRow = {
  __ROW_PATH__?: unknown;
  [key: string]: unknown;
};

/**
 * Collect distinct depth-1 group keys from `__ROW_PATH__` only.
 * Skips the root aggregate row (`path: []`). Never reads `row[colId]`.
 */
export function distinctValuesFromRowPaths(
  rows: readonly GroupedDistinctRow[],
  limit?: number,
): string[] {
  const cap = limit != null && limit > 0 ? limit : Number.POSITIVE_INFINITY;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const path = row.__ROW_PATH__;
    if (!Array.isArray(path) || path.length === 0) continue;
    const raw = path[0];
    if (raw == null) continue;
    // Path segments are the column's native values (string / number / bool).
    // Stringify for the set-filter checkbox list — same as CSRM DistinctValuesPass.
    const s = String(raw);
    if (s === '' || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= cap) break;
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return out;
}
