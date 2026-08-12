// The sticky group band's ancestor walk — one traversal, two row sources.
//
// The band above the first visible row is the chain of group rows that are
// ancestors of that row. Both row models need it and legacy implemented it
// twice: once over CSRM `VisibleRowEntry` values with a `metaLookup` for
// display fields (`worker.ts::computeStickyAncestors`), once over sparse
// SSRM rows carrying `__ssrm` metadata (`computeSsrmStickyAncestors`). The
// walk is subtle in the same two places both times, so it lives here once.
//
// Runs O(stickyBoundaryRow) once per `getViewport`, not per row, so the
// callback indirection costs nothing measurable on the paint path.

import type { StickyAncestor } from './protocol';

/**
 * Walk `[0, limit)` of a visible order and return the ancestor chain of the
 * row at `limit`, sorted by depth ascending.
 *
 * `groupAt(i)` returns a group descriptor for index `i`, or `undefined` when
 * that index isn't a group row. `resolve(group, depth)` turns a surviving
 * descriptor into the wire entry, or returns `null` to END the chain.
 *
 * Two invariants the callers must not lose:
 *
 *  * A group at depth `d` starts a new subtree, so anything recorded DEEPER
 *    than `d` belongs to the previous subtree and stops being an ancestor of
 *    rows below this point. Without the purge a cross-parent child leaks
 *    into the band.
 *  * A collapsed (or unresolvable) group has no visible descendants, so
 *    nothing deeper than it can be a true ancestor either — the chain ends
 *    at the first one `resolve` rejects, it does not skip past it.
 */
export function collectStickyAncestors<TGroup extends { depth: number }>(
  limit: number,
  groupAt: (index: number) => TGroup | undefined,
  resolve: (group: TGroup, depth: number) => StickyAncestor | null,
): StickyAncestor[] {
  if (limit <= 0) return [];
  const lastAtDepth = new Map<number, TGroup>();
  for (let i = 0; i < limit; i++) {
    const group = groupAt(i);
    if (group === undefined) continue;
    for (const depth of lastAtDepth.keys()) {
      if (depth > group.depth) lastAtDepth.delete(depth);
    }
    lastAtDepth.set(group.depth, group);
  }
  if (lastAtDepth.size === 0) return [];
  const result: StickyAncestor[] = [];
  for (const depth of [...lastAtDepth.keys()].sort((a, b) => a - b)) {
    const entry = resolve(lastAtDepth.get(depth)!, depth);
    if (entry === null) break;
    result.push(entry);
  }
  return result;
}
