// Task 2 (production-hardening / A-C1) — shared grouped-index resolver.
//
// When grouping is active, the main thread speaks the GROUP-VISIBLE row
// order: group-header rows occupy a slot in the index space, and rows
// hidden inside a collapsed group are excluded entirely (see
// `computeGroupVisibleOrder`, `./viewportSlicer.ts`). Only
// `getRowIndicesForIds` (`./handlers/viewport.ts`) used to translate
// between that vocabulary and the underlying flat leaf rowId array;
// `getRowIndexForId`, `getRowByIndex`, `clipboardSerialize`, and autosize
// `textOf` all still indexed the flat array directly — off by however
// many group-header rows and collapsed leaves precede the target index.
//
// `buildVisibleIndexResolver(ctx)` is the ONE shared translation every
// index-facing worker endpoint should route through: it produces the
// group-visible id lookup exactly the way `getRowIndicesForIds` already
// did, and falls back to a flat passthrough when grouping isn't active
// (so ungrouped grids pay no extra cost or behavior change).

import type { HandlerCtx } from './dispatch';
import { cachedGroupVisibleOrder } from './groupViewCache';

export interface VisibleIndexResolver {
  /** Number of slots in the current visible order (group headers +
   *  visible leaf rows when grouping is active; flat visible row count
   *  otherwise). */
  length: number;
  /** The leaf rowId occupying `visibleIndex`, or `null` when that slot
   *  is a group-header row or the index is out of range. */
  leafIdAt(visibleIndex: number): string | null;
  /** The visible-order index of `rowId`, or -1 when the row is unknown
   *  or currently hidden inside a collapsed group. */
  indexOfLeafId(rowId: string): number;
}

/** Build the resolver for the CURRENT pipeline state. Cheap to call per
 *  request — builds one id→index `Map` (O(visible)) and, under
 *  grouping, one parallel `leafIdAt` lookup array; no per-lookup scan
 *  either way. */
export async function buildVisibleIndexResolver(ctx: HandlerCtx): Promise<VisibleIndexResolver> {
  const { state, helpers } = ctx;

  if (helpers.isGroupingActive() && state.groupOutput && state.groupInputIds) {
    const groupInputIds = state.groupInputIds;
    // Exactly the translation `getRowIndicesForIds` already performed
    // (worker/handlers/viewport.ts) — generalised into the shared
    // resolver every index-facing endpoint now consumes.
    // A-P2 (production hardening) — memoized per pipeline generation.
    // The memo ALSO keys on `suppressLeafRows`, so this call (which keeps
    // the pre-existing default `false` — deliberately unchanged here;
    // `getViewport` passes `isPivotActive()`) can never be served the
    // getViewport path's entry, and vice versa. Identical inputs ⇒
    // identical output as the direct call.
    const visibleOrder = cachedGroupVisibleOrder(
      state.groupViewCache,
      state.groupOutput,
      state.expandedKeys,
      helpers.effectiveExpandedKeys(),
      state.groupHideOpenParents,
      false,
    );
    const idAt = new Array<string | null>(visibleOrder.length);
    const idToIndex = new Map<string, number>();
    for (let i = 0; i < visibleOrder.length; i++) {
      const entry = visibleOrder[i]!;
      if (entry.kind === 'row') {
        const id = groupInputIds[entry.rowIndex];
        idAt[i] = id ?? null;
        if (id !== undefined) idToIndex.set(id, i);
      } else {
        idAt[i] = null;
      }
    }
    return {
      length: visibleOrder.length,
      leafIdAt: (visibleIndex) => {
        if (visibleIndex < 0 || visibleIndex >= idAt.length) return null;
        return idAt[visibleIndex]!;
      },
      indexOfLeafId: (rowId) => idToIndex.get(rowId) ?? -1,
    };
  }

  const ids = await helpers.visibleAsync();
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) idToIndex.set(ids[i]!, i);
  return {
    length: ids.length,
    leafIdAt: (visibleIndex) => {
      if (visibleIndex < 0 || visibleIndex >= ids.length) return null;
      return ids[visibleIndex]!;
    },
    indexOfLeafId: (rowId) => idToIndex.get(rowId) ?? -1,
  };
}
