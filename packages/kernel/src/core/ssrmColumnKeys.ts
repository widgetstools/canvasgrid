/**
 * Build the SSRM fetch column set for a paint window.
 *
 * Paint columns ∪ system (id/sort/filter/group/agg) ∪ Perspective expression
 * *outputs* ∪ client rules/alerts/format watched fields.
 *
 * Calc *input* deps are intentionally omitted when expressions run in
 * Perspective — the WASM table already has them; only outputs need shipping.
 */
export type SsrmColumnKeysInput = {
  /** Visible leaf colIds (center + pinned), paint order. */
  visibleColIds: readonly string[];
  /** Extra overscan colIds adjacent to the viewport (optional). */
  overscanColIds?: readonly string[];
  /** Row-id field / getRowId source column. */
  rowIdField?: string | null;
  sortColIds?: readonly string[];
  filterColIds?: readonly string[];
  rowGroupColIds?: readonly string[];
  valueAggColIds?: readonly string[];
  /** Perspective expression output aliases currently registered / painted. */
  expressionOutputIds?: readonly string[];
  /** Client-side rules / alerts / format watched fields. */
  clientWatchedColIds?: readonly string[];
};

export function buildSsrmColumnKeys(input: SsrmColumnKeysInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  for (const id of input.visibleColIds) add(id);
  for (const id of input.overscanColIds ?? []) add(id);
  add(input.rowIdField ?? undefined);
  for (const id of input.sortColIds ?? []) add(id);
  for (const id of input.filterColIds ?? []) add(id);
  for (const id of input.rowGroupColIds ?? []) add(id);
  for (const id of input.valueAggColIds ?? []) add(id);
  for (const id of input.expressionOutputIds ?? []) add(id);
  for (const id of input.clientWatchedColIds ?? []) add(id);
  return out;
}

/** Field-merge a partial SSRM row onto a previously hydrated row. */
export function mergeSsrmRowFields<T extends Record<string, unknown>>(
  prev: T | undefined,
  next: T,
): T {
  if (!prev) return next;
  return { ...prev, ...next };
}
