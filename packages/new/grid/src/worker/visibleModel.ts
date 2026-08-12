// The visible-model cache, its invalidation set, and the `getViewport`
// staleness contract.
//
// ## `visibleCache`
//
// `State.visibleCache` memoizes the output of `buildVisibleAsync` — the
// post-filter, post-group, post-pivot, post-sort rowId order. Every request
// that needs the visible order reads it through `visibleAsync()`, which
// rebuilds only when the cache is null. The cache is nulled by every
// mutation that can change that order:
//
//   data      — setRowData, applyTransaction (sync + async flush),
//               ssrmHydrate, ssrmSetClientPipeline
//   filter    — setFilterModel, setQuickFilter, setExternalFilterPresent,
//               setAlwaysPassRowIds, refilter
//   sort      — setSortModel, setPostSortRowsPresent
//   group     — setGroupModel, setExpandedKeys, setEmitGroupDescendants
//   pivot     — setPivotModel, setPivotMaxGeneratedColumns,
//               setStrictPivotColumnOrder
//   columns   — updateColumns
//   calc      — setCalcProgram
//
// Legacy scattered `state.visibleCache = null` across four files, so that
// list was only discoverable by grep — and the group / pivot mutations
// aren't in it at all, because they lean on `invalidateAndCount` rebuilding
// unconditionally instead. Routing all of it through this module makes the
// set enumerable from one place and lets the generation counter below ride
// along for free.
//
// Two distinct operations, deliberately named apart: a **change** to the
// model (`invalidateVisibleModel` / `setVisibleModel`, both of which advance
// the generation) versus a **fill** of the cache after a change
// (`visibleAsync`'s memoize-on-miss, which must not). The counter only has
// to move when the model moves; how many times it moves per mutation is not
// meaningful, so paths that both invalidate and immediately rebuild may
// advance it more than once.
//
// ## The `getViewport` staleness contract (SPEC refactor 2)
//
// There is **no cancellation** for an in-flight `getViewport`. This is
// deliberate, not an oversight, and the main thread depends on it:
//
//  * `getViewport` is `await`-ed mid-flight. `visibleAsync()` can suspend on
//    either of the two pipeline round-trips (`externalFilterCandidates`,
//    `postSortRowsRequest`), so a `setFilterModel` can land — and invalidate
//    the model — while a viewport request is parked.
//  * `WorkerClient` correlates responses by `id` through a pending map. A
//    request that never gets a response leaves its promise pending forever
//    and its entry in the map forever. So the worker must answer EVERY
//    `getViewport`, superseded or not.
//  * The main thread therefore owns the discard decision: it compares the
//    response against its own viewport generation/epoch and drops chunks it
//    has already moved past.
//
// What was incidental before is that nothing in the worker named the
// generation the main thread was guarding on — the response carried no way
// to tell a current chunk from a superseded one. `visibleModelGeneration`
// on the `viewport` response closes that: it is the generation of the
// visible order the chunk was sliced from. The main thread's epoch guard
// stays authoritative; this just makes it checkable.
//
// One honest wrinkle the generation exposes rather than fixes: when the
// model is invalidated WHILE `buildVisibleAsync` is suspended, the resolved
// array is still written into `visibleCache` (a stale write) and the next
// reader is served the superseded order until something nulls the cache
// again. That is legacy behavior and the parity gate pins it, so it stays;
// the stamped generation at least makes it visible on the wire.

import type { State } from './workerState';

/** Drop the memoized visible order and advance the generation. Call this
 *  instead of assigning `state.visibleCache = null` directly. */
export function invalidateVisibleModel(state: State): void {
  state.visibleCache = null;
  state.visibleModelGeneration++;
}

/** Install a visible order the worker did not derive from
 *  `buildVisibleAsync` — the sparse SSRM path, where the server's scroll
 *  order IS the visible order. Advances the generation for the same reason
 *  `invalidateVisibleModel` does: the order changed. */
export function setVisibleModel(state: State, ids: string[]): void {
  state.visibleCache = ids;
  state.visibleModelGeneration++;
}

/** The generation a chunk sliced right now would describe. Read by the
 *  `getViewport` handler to stamp its response. */
export function visibleModelGeneration(state: State): number {
  return state.visibleModelGeneration;
}
