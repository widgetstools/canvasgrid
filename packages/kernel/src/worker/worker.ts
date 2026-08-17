import type {
  WorkerRequest, WorkerResponse, WorkerPush, WorkerInitPayload, MeasureTextItem,
  StickyAncestor,
} from './protocol';
import {
  RowStore, FilterPass, SortPass, AggPass, GroupPass, ViewportSlicer, TransactionQueue,
  QuickFilterPass, DistinctValuesPass, diffRowFields, PivotPass,
} from './dataPipeline';
import type { GroupNode, GroupPassOutput } from './passes/groupPass';
import { rebuildFlatOrder } from './passes/sortPass';
import { CalcProgramStore } from './passes/calcPass';
import {
  computeGroupVisibleRowCount,
  type VisibleRowEntry,
} from './viewportSlicer';
import { ComparatorRegistry } from './comparatorRegistry';
import { AggFuncRegistry } from './aggFuncRegistry';
import type { TransactionResult } from '../types';
import type { WorkerColumn } from './protocol';
import {
  MeasureCache, measureKey, offscreenMeasurer, workerCanMeasure, wrapTextToHeight,
} from './measureText';
import { cachedEffectiveExpandedKeys, createGroupViewCaches } from './groupViewCache';
import type { State } from './workerState';
import type { HandlerCtx, PostFn, WorkerHelpers } from './dispatch';
import { dispatchTable } from './dispatch';

interface AutoHeightCol {
  colId: string;
  field: string;
  font: string;
  width: number;
  lineHeight: number;
  padding: number;
}

interface PendingMeasure {
  rowId: string;
  colId: string;
  cacheKey: string;
  itemIndex: number;
}

// Cycle 19 / Task 6 — `State` interface moved to `./workerState.ts` so
// per-domain handler modules (`worker/handlers/*.ts`) can reference it
// without importing this file (which imports the handlers via
// `./dispatch`). The concrete object is still constructed by `initHost`
// below.
//
// `PostFn` + `Postable` moved to `./dispatch.ts` for the same reason.

export interface WorkerHost {
  handle(req: WorkerRequest): void;
}

export function createWorkerHost(post: PostFn): WorkerHost {
  let state: State | null = null;

  function buildCandidates(aggFilterCols: ReadonlySet<string> | null = null): string[] {
    if (!state) return [];
    // Cycle 7 / Task 7 — QuickFilterPass runs BEFORE FilterPass. A null
    // return means no quick-filter constraint, so we skip the intersection
    // entirely.
    // AG `groupAggFiltering` — entries on AGGREGATED columns evaluate group
    // aggregates instead of leaves (excluded here, applied by
    // `pruneGroupsByAggFilter`); entries on non-aggregated columns still
    // filter leaves. Quick filter always applies at leaf level.
    const quickIds = state.quickFilter.apply();
    let ids = aggFilterCols && aggFilterCols.size > 0
      ? state.filter.applyExcluding(aggFilterCols)
      : state.filter.apply();
    if (quickIds !== null) {
      const allow = new Set(quickIds);
      ids = ids.filter((id) => allow.has(id));
    }
    return ids;
  }

  /** AG `groupAggFiltering` — evaluate the filter model against per-group
   *  aggregate values and prune the tree. Passing groups keep their whole
   *  subtree (implicit `suppressAggFilteredOnly`); non-passing groups
   *  survive only when a descendant passes (as chrome, without their own
   *  direct leaves). Returns null when no filter entry targets an
   *  aggregated column — the model then imposes no group constraint. */
  function pruneGroupsByAggFilter(ids: readonly string[]): GroupPassOutput | null {
    if (!state) return null;
    const out = state.groupOutput!;
    const activeAggCols = state.filter.activeColIds().filter((colId) => {
      const c = state!.columns.find((cc) => cc.colId === colId);
      return c?.aggFunc != null;
    });
    if (activeAggCols.length === 0) return null;
    const totals = state.agg.applyGroups(ids as string[], out).groupTotals;
    const passes = (key: string): boolean => {
      const t = totals[key];
      for (const colId of activeAggCols) {
        if (state!.filter.entryMatches(colId, t?.[colId]) !== true) return false;
      }
      return true;
    };
    const prune = (node: GroupNode): GroupNode | null => {
      if (passes(node.key)) return node; // whole subtree included as-is
      const children: GroupNode[] = [];
      for (const c of node.childGroups) {
        const p = prune(c);
        if (p) children.push(p);
      }
      if (children.length === 0) return null;
      let childCount = 0;
      for (const c of children) childCount += c.childCount;
      return {
        ...node,
        childGroups: children,
        childIndices: new Uint32Array(0),
        childCount,
      };
    };
    const roots: GroupNode[] = [];
    for (const r of out.roots) {
      const p = prune(r);
      if (p) roots.push(p);
    }
    const flatOrder = rebuildFlatOrder(
      roots,
      state.group.getIncludeFooter(),
      state.group.getIncludeTotalFooter(),
      state.group.getRemoveSingleChildren(),
    );
    return { roots, flatOrder, bypassed: false };
  }

  /** Cycle 7 / Task 8 — runs the external-filter round-trip when
   *  `state.externalFilterPresent` is set. `candidates` is the
   *  post-column-filter, post-quick-filter survivor set MINUS any
   *  alwaysPass rows (those bypass external filter too). The promise
   *  resolves once main posts back `externalFilterResult` for the
   *  matching callId. Resolves immediately when there are no candidates
   *  so empty inputs don't trip a needless round-trip. */
  function runExternalFilter(candidates: string[]): Promise<string[]> {
    if (!state) return Promise.resolve([]);
    if (candidates.length === 0) return Promise.resolve([]);
    const callId = state.nextExternalFilterCallId++;
    return new Promise<string[]>((resolve) => {
      state!.pendingExternalFilters.set(callId, resolve);
      post({ type: 'externalFilterCandidates', callId, rowIds: candidates });
    });
  }

  async function buildVisibleAsync(): Promise<string[]> {
    if (!state) return [];
    // SSRM sparse path — server owns filter/sort/agg; scroll order is
    // authoritative. When `ssrmClientPipeline` is on the book has been
    // fully hydrated and CSRM features (group/pivot/filter/sort/totals)
    // run through the same pipeline as clientSide.
    if (state.ssrmActive && !state.ssrmClientPipeline) {
      // Still materialise Stage A over hydrated leaves so calculated
      // columns paint in the sparse SSRM viewport (row-local exprs only;
      // Stage B aggregates stay on the client-pipeline path).
      state.calc.ensureStageA(state.store, (colId) => state!.columns.find((c) => c.colId === colId)?.field);
      return state.ssrmOrder;
    }
    // Cycle 21d / Task 11 — CalcPass Stage A: materialise row-local calc
    // values BEFORE the filter reads them. No program → immediate no-op.
    state.calc.ensureStageA(state.store, (colId) => state!.columns.find((c) => c.colId === colId)?.field);
    // AG `groupAggFiltering` — active only when grouping is on AND a
    // filter model is installed. Entries on aggregated columns prune the
    // GROUP tree by aggregate values below; entries on non-aggregated
    // columns still filter leaves (a text filter on a plain column must
    // not silently no-op).
    const aggFiltering = state.groupAggFiltering
      && state.group.getModel().rowGroupCols.length > 0
      && state.filter.hasActiveModel();
    const aggFilterCols = aggFiltering
      ? new Set(state.filter.activeColIds().filter((colId) => {
        const c = state!.columns.find((cc) => cc.colId === colId);
        return c?.aggFunc != null;
      }))
      : null;
    let ids = buildCandidates(aggFilterCols);
    const alwaysPass = state.alwaysPassIds;
    if (state.externalFilterPresent) {
      // Subtract alwaysPass from the candidate set the main thread
      // evaluates — alwaysPass rows bypass the external predicate too
      // (per catalog docs: "Allows specific rows to bypass all filters
      // unconditionally").
      const filteredCandidates: string[] = alwaysPass.size === 0
        ? ids
        : ids.filter((id) => !alwaysPass.has(id));
      const surviving = await runExternalFilter(filteredCandidates);
      const merged = new Set<string>(surviving);
      if (alwaysPass.size > 0) {
        // Restore alwaysPass rows; they survive every filter pass.
        for (const id of alwaysPass) {
          // Only include alwaysPass rows that still exist in the store —
          // a stale row that's been removed would otherwise leak in.
          if (state.store.getById(id) !== undefined) merged.add(id);
        }
      }
      ids = Array.from(merged);
    } else if (alwaysPass.size > 0) {
      // No external filter — alwaysPass still trumps column + quick.
      const merged = new Set<string>(ids);
      for (const id of alwaysPass) {
        if (state.store.getById(id) !== undefined) merged.add(id);
      }
      ids = Array.from(merged);
    }
    // Cycle 15 / Task 1 — GroupPass slot. Runs against the post-filter
    // (post-quick / post-external / post-alwaysPass) row set and BEFORE
    // SortPass. The output is stored on state so Task 2's slicer + Task
    // 11's group-aware sort can read from it.
    state.groupOutput = state.group.apply(ids);
    // AG parity 2026-07-21 — `groupDefaultExpanded` seeded while the tree
    // was empty (group model before data): re-seed against the FIRST
    // non-empty tree so the configured default actually applies.
    if (
      state.pendingDefaultExpandSeed
      && !state.groupOutput.bypassed
      && state.groupOutput.roots.length > 0
    ) {
      state.pendingDefaultExpandSeed = false;
      state.expandedKeys = state.group.computeDefaultExpandedKeys(state.groupOutput.roots);
    }
    // AG `groupAggFiltering` — prune the group tree by aggregate values:
    // a group whose aggregates pass the filter keeps its WHOLE subtree; a
    // non-passing group survives only as chrome above passing descendants.
    if (aggFiltering && !state.groupOutput.bypassed && state.groupOutput.roots.length > 0) {
      const pruned = pruneGroupsByAggFilter(ids);
      if (pruned !== null) state.groupOutput = pruned;
    }
    // Cycle 15 / Task 8 — capture the pre-sort, post-filter rowId
    // array so descendant lookups (`collectGroupDescendantRowIds`) can
    // translate a GroupNode's `childIndices` back to string rowIds
    // without rerunning the filter pipeline. Stored as a frozen slice
    // so a future `state.group.apply` doesn't mutate this snapshot
    // behind a pending descendant request.
    state.groupInputIds = state.groupOutput.bypassed ? null : ids.slice();
    // Cycle 18 / Task 3 — capture the post-filter set for PivotPass key
    // discovery + grand-total aggregation. When grouping is active this is
    // the same array `groupInputIds` snapshots (so `GroupNode.childIndices`
    // align); we keep a dedicated handle so ungrouped pivots have it too.
    state.pivotInputIds = ids.slice();
    // Cycle 18 / Task 8d — compute PivotPass eagerly (before SortPass)
    // when the model is active. The result is sort-invariant (keyed by
    // group key strings, not node order), so the cached value is safe
    // to read in the getViewport handler. When pivot is INACTIVE the
    // cached value is null and the handler also skips. The benefit of
    // running early: a sort entry targeting a synthesized pivot-result
    // column can re-order the row groups by the aggregate value.
    const pivotModel = state.pivot.getModel();
    if (
      pivotModel.pivotColIds.length > 0
      && pivotModel.valueCols.length > 0
    ) {
      const pivotInputIds = !state.groupOutput.bypassed && state.groupInputIds !== null
        ? state.groupInputIds
        : state.pivotInputIds;
      state.pivotOut = state.pivot.apply(pivotInputIds, state.groupOutput);
    } else {
      state.pivotOut = null;
    }
    // Cycle 21d / Task 12 — CalcPass Stage B: scoped aggregate scalars +
    // per-row aggregate-dependent values. Runs AFTER grouping (scopes are
    // defined by the tree) and BEFORE sort (sort sees fresh Stage-B
    // values). FilterPass ran earlier in this pass, so filtering on a
    // Stage-B column reads the PREVIOUS pass's values — the documented
    // one-frame settle (spec §2.3); no reentrant recompute.
    state.calc.ensureStageB(
      state.store, state.groupOutput, ids,
      (colId) => state!.columns.find((c) => c.colId === colId)?.field,
    );
    // Cycle 15 / Task 11 — group-aware sort. When grouping is active,
    // sort happens inside the group tree (within-bucket child indices +
    // per-level group ordering), NOT across the flat post-filter array.
    // The `flatOrder` we ship to the slicer carries the sorted order;
    // the flat `ids` array stays in its pre-sort post-filter order so
    // `flatOrder[i].rowIndex` continues to address it correctly. When
    // grouping is bypassed, fall back to the pre-Task-11 flat global
    // sort — `ids` becomes the sorted order the flat slicer reads.
    if (!state.groupOutput.bypassed) {
      // Cycle 15 / Task 12 — thread the GroupPass-level flatOrder
      // options (footer emission + elision) through SortPass so the
      // rebuilt flatOrder re-emits footer entries / honors elision.
      // Without this, sorting strips the footer entries the
      // GroupPass-emitted flatOrder carries.
      // Cycle 18 / Task 8d — also thread the cached PivotPass output
      // through so a pivot-result column sort can re-order each level.
      state.groupOutput = state.sort.applyGrouped(state.groupOutput, ids, {
        includeFooter: state.group.getIncludeFooter(),
        includeTotalFooter: state.group.getIncludeTotalFooter(),
        removeSingleChildren: state.group.getRemoveSingleChildren(),
        maintainOrder: state.groupMaintainOrder,
      }, state.pivotOut ?? undefined);
    } else {
      const modelStr = JSON.stringify(state.sort.getModel());
      const beforeIds = ids.slice(0, 5);
      ids = state.sort.apply(ids);
      const afterIds = ids.slice(0, 5);
      const changed = beforeIds.some((id, i) => id !== afterIds[i]);
      if (!changed && modelStr !== '[]') {
        console.error('[worker] CRITICAL BUG: sort.apply returned same order despite non-empty model:', modelStr);
      }
    }
    // Cycle 8 / Task 4 — when `postSortRowsPresent`, ship the sorted ids
    // up for the main-thread hook to re-order. Empty sets skip the
    // round-trip (an empty array round-trip is just a waste of two
    // postMessage calls). The hook can also reorder when no sort is
    // active — the input is the post-SortPass order, which equals the
    // pre-sort order when the sort model is empty.
    if (state.postSortRowsPresent && ids.length > 0) {
      ids = await runPostSortRows(ids);
    }
    return ids;
  }

  /** Cycle 8 / Task 4 — runs the post-sort round-trip when
   *  `state.postSortRowsPresent` is set. Returns the re-ordered rowId
   *  array. */
  function runPostSortRows(ids: string[]): Promise<string[]> {
    if (!state) return Promise.resolve(ids);
    const callId = state.nextPostSortRowsCallId++;
    return new Promise<string[]>((resolve) => {
      state!.pendingPostSortRows.set(callId, resolve);
      post({ type: 'postSortRowsRequest', callId, rowIds: ids });
    });
  }

  async function visibleAsync(): Promise<string[]> {
    if (!state) return [];
    if (state.visibleCache) return state.visibleCache;
    // A-C3 (production hardening) — single-flight pipeline. When a build is
    // already running (its external-filter / postSortRows round-trip has
    // suspended `buildVisibleAsync` across an `await` at worker.ts:180-198 /
    // :302-305), a concurrent caller must await the SAME build. The old
    // check-then-set of `visibleCache` let a second `buildVisibleAsync`
    // start and interleave writes to
    // groupOutput/pivotOut/groupInputIds/visibleCache. Invalidation nulls
    // `visibleCachePromise` (everywhere `visibleCache` is nulled) so the
    // next call rebuilds.
    if (state.visibleCachePromise) return state.visibleCachePromise;
    const p: Promise<string[]> = buildVisibleAsync().then(
      (result) => {
        // Publish only if this build is still the in-flight one — an
        // invalidation during the build nulls/replaces the promise, and a
        // stale build's output must not overwrite the fresh cache.
        if (state && state.visibleCachePromise === p) {
          state.visibleCache = result;
          state.visibleCachePromise = null;
        }
        return result;
      },
      (err) => {
        if (state && state.visibleCachePromise === p) state.visibleCachePromise = null;
        throw err;
      },
    );
    state.visibleCachePromise = p;
    return p;
  }

  /** Cycle 15 / Task 4 — true when the most recent `buildVisibleAsync`
   *  produced a group tree the slicer should walk over (instead of
   *  emitting the flat post-sort row order). Reads the latest
   *  `state.groupOutput` set inside `buildVisibleAsync`. */
  function isGroupingActive(): boolean {
    return !!state?.groupOutput && !state.groupOutput.bypassed;
  }

  /** Cycle 18 / Task 3 follow-up — true when the most recent
   *  `PivotPass.apply` produced cross-tab output (NOT bypassed AND NOT
   *  capped). Under pivot mode the slicer hides leaf data rows
   *  entirely; only group + footer rows surface so the user sees a
   *  clean cross-tab matrix. AG-Grid parity. */
  function isPivotActive(): boolean {
    return !!state?.pivotOut && !state.pivotOut.bypassed;
  }

  /** Cycle 15 / Task 7 — resolve the effective expanded-keys set for the
   *  next pipeline pass. When `state.expandedKeys` is non-null the API
   *  has been driven explicitly (collapseAll / setExpanded /
   *  collapse-and-toggle); use it verbatim. When it is `null` the grid
   *  is in the "default = every group expanded" mode (Task 4 mount,
   *  Task 7 `expandAll`); derive the all-keys set from the current
   *  `flatOrder` so the slicer + meta lookup paint with chevrons in
   *  the down/expanded state for every group.
   *
   *  A-P2 (production hardening) — the derived (sentinel) branch is a
   *  full `flatOrder` walk plus a Set the size of the group count, and it
   *  ran on EVERY getViewport / resolver build. It is memoized on
   *  `state.groupViewCache` keyed on the `groupOutput` + `expandedKeys`
   *  identities. The returned Set is now SHARED across calls — every
   *  in-repo consumer only reads it (see `groupViewCache.ts`). */
  function effectiveExpandedKeys(): Set<string> {
    if (!state) return new Set<string>();
    return cachedEffectiveExpandedKeys(
      state.groupViewCache, state.groupOutput, state.expandedKeys,
    );
  }

  /** Cycle 15 / Task 7 — list of EVERY composite group key in the
   *  current tree, in flatOrder traversal order. Shipped back with
   *  `setGroupModel` / `setExpandedKeys` replies so the main-thread
   *  mirror can materialise its `expandedKeys` snapshot (the
   *  `getExpandedKeys()` API needs the all-keys set when the
   *  main-side state is still at the "default = all expanded"
   *  sentinel). Empty when grouping is bypassed. */
  function currentGroupKeys(): string[] {
    if (!state?.groupOutput) return [];
    const out: string[] = [];
    for (const e of state.groupOutput.flatOrder) {
      if (e.kind === 'group') out.push(e.key);
    }
    return out;
  }

  /** Cycle 15 / Task 8 — collect the descendant leaf rowIds for every
   *  composite group key in `currentGroupKeys()` order. Returns an
   *  array parallel to `currentGroupKeys()` so the main thread can pair
   *  them index-by-index in a `Map<groupKey, string[]>`. Returns an
   *  empty array when grouping bypasses OR when `groupInputIds` is
   *  missing (should never happen post-`buildVisibleAsync`).
   *
   *  Cost: O(totalDescendants × depth) — for the common case
   *  (1 M rows × 3 group cols × ~450 leaf groups) the walk touches
   *  every leaf index once across roughly `depth × groupCount`
   *  recursive frames. Suitable for `setGroupModel` / `setExpandedKeys`
   *  replies; not on the per-frame paint path. */
  function collectGroupDescendantRowIds(): string[][] {
    if (!state?.groupOutput || state.groupOutput.bypassed) return [];
    const inputIds = state.groupInputIds;
    if (!inputIds) return [];
    const out: string[][] = [];
    const collect = (node: GroupNode, into: string[]): void => {
      if (node.childGroups.length > 0) {
        for (const child of node.childGroups) collect(child, into);
        return;
      }
      // Leaf — `childIndices` are positions into `inputIds`.
      const idxs = node.childIndices;
      for (let i = 0; i < idxs.length; i++) {
        const idx = idxs[i]!;
        const id = inputIds[idx];
        if (id !== undefined) into.push(id);
      }
    };
    const walk = (nodes: readonly GroupNode[]): void => {
      for (const node of nodes) {
        const descendants: string[] = [];
        collect(node, descendants);
        out.push(descendants);
        if (node.childGroups.length > 0) walk(node.childGroups);
      }
    };
    walk(state.groupOutput.roots);
    return out;
  }

  /** Cycle 15 / Task 4 — flatten the `GroupNode` tree into a `key →
   *  { value, childCount, isExpanded }` lookup the slicer reads when
   *  packing the chunk's group-row slots. Built once per viewport
   *  request — the tree is small relative to the visible window and the
   *  cost is swamped by the slice's column-data fill.
   *
   *  Cycle 15 / Task 7 — takes the effective expanded set so per-group
   *  `isExpanded` paints the correct chevron (down for expanded, right
   *  for collapsed). The slicer also clamps the chunk's `isExpanded[i]`
   *  array against this value, so the renderer can read either source. */
  function buildGroupMetaLookup(
    roots: readonly GroupNode[],
    columns: readonly WorkerColumn[],
    expandedKeys: ReadonlySet<string>,
  ): Map<string, { value: string; childCount: number; isExpanded: boolean; colId: string }> {
    const map = new Map<string, { value: string; childCount: number; isExpanded: boolean; colId: string }>();
    const colTypeByColId = new Map<string, 'text' | 'number'>();
    for (const c of columns) colTypeByColId.set(c.colId, c.type);
    const walk = (nodes: readonly GroupNode[]): void => {
      for (const node of nodes) {
        const colType = colTypeByColId.get(node.colId);
        const value = node.value;
        // AG parity — rows with no value in the group column collect under
        // a labeled "(Blanks)" group (was: empty label → em-dash glyph).
        let formatted: string;
        if (value === null || value === undefined) formatted = '(Blanks)';
        // Non-finite numbers (NaN/Infinity) are values, not blanks — label
        // them by their string form.
        else if (colType === 'number' && typeof value === 'number') formatted = String(value);
        else {
          formatted = String(value);
          if (formatted === '') formatted = '(Blanks)';
        }
        map.set(node.key, {
          value: formatted,
          childCount: node.childCount,
          isExpanded: expandedKeys.has(node.key),
          colId: node.colId,
        });
        if (node.childGroups.length > 0) walk(node.childGroups);
      }
    };
    walk(roots);
    return map;
  }

  /** Cycle 15 / Task 16 — compute the sticky ancestor band for `rowStart`.
   *  Walks `visibleOrder[0..rowStart)`, tracking the last group entry seen
   *  at each depth. Only expanded groups can have visible descendants below
   *  them, so non-expanded ancestors are excluded. O(rowStart). */
  function computeStickyAncestors(
    visibleOrder: readonly VisibleRowEntry[],
    rowStart: number,
    metaLookup: ReadonlyMap<string, { value: string; childCount: number; isExpanded: boolean; colId: string }>,
  ): StickyAncestor[] {
    if (rowStart === 0) return [];
    const lastAtDepth = new Map<number, string>(); // depth → composite key
    const limit = Math.min(rowStart, visibleOrder.length);
    for (let i = 0; i < limit; i++) {
      const entry = visibleOrder[i]!;
      if (entry.kind === 'group') {
        // A group at depth d starts a new subtree — deeper entries belong
        // to the previous subtree and are no longer ancestors of rows
        // below this point (prevents a cross-parent child in the band).
        for (const depth of lastAtDepth.keys()) {
          if (depth > entry.depth) lastAtDepth.delete(depth);
        }
        lastAtDepth.set(entry.depth, entry.key);
      }
    }
    if (lastAtDepth.size === 0) return [];
    const result: StickyAncestor[] = [];
    for (const [depth, key] of [...lastAtDepth.entries()].sort((a, b) => a[0] - b[0])) {
      const meta = metaLookup.get(key);
      // A collapsed (or unknown) group ends the ancestor chain — deeper
      // entries cannot be true ancestors of rows below it.
      if (!meta || !meta.isExpanded) break;
      result.push({ depth, key, colId: meta.colId, value: meta.value, childCount: meta.childCount, isExpanded: meta.isExpanded });
    }
    return result;
  }

  async function invalidateAndCount(): Promise<number> {
    if (!state) return 0;
    // A-C3 (production hardening) — this helper's contract is "invalidate
    // AND count": it ALWAYS forces a fresh pipeline build (the pre-hardening
    // body called `buildVisibleAsync()` unconditionally, and some callers —
    // e.g. the pivot handler — rely on that without nulling `visibleCache`
    // themselves). Null both tokens so `visibleAsync` starts THE fresh
    // single-flight build that any concurrent getViewport then joins;
    // `state.groupOutput` is a side effect of that same build.
    state.visibleCache = null;
    state.visibleCachePromise = null;
    const visible = await visibleAsync();
    if (isGroupingActive()) {
      return computeGroupVisibleRowCount(
        state.groupOutput!.flatOrder, effectiveExpandedKeys(),
        state.groupHideOpenParents, isPivotActive(),
      );
    }
    return visible.length;
  }

  /** Cycle 4 / Task 11 (cell-flash patch) — diff each update row
   *  against the currently-stored row (PRE-apply) and merge changed
   *  field names into `state.pendingFlashes`. The next viewport slice
   *  reads + drains this map. */
  function stageFlashesForUpdates(s: State, updates: unknown[]): void {
    for (const newRow of updates) {
      let rowId: string;
      try { rowId = s.store.getRowId(newRow); } catch { continue; }
      const oldRow = s.store.getById(rowId);
      if (oldRow === undefined) continue;
      const changed = diffRowFields(oldRow, newRow);
      if (changed.size === 0) continue;
      const existing = s.pendingFlashes.get(rowId);
      if (existing) {
        for (const f of changed) existing.add(f);
      } else {
        s.pendingFlashes.set(rowId, changed);
      }
    }
  }

  function initHost(payload: WorkerInitPayload, id: number): void {
    const store = new RowStore(payload.rowIdField);
    if (payload.rowHeight != null) store.setGridRowHeight(payload.rowHeight);

    const queue = new TransactionQueue({
      waitMs: payload.asyncTransactionWaitMillis ?? 50,
      throttleMs: payload.asyncTransactionThrottleMillis ?? 0,
      // Default ON — blotter feeds land many updates per row per window;
      // last-write-wins before apply. Opt out with asyncTransactionConflate: false.
      conflate: payload.asyncTransactionConflate !== false,
      getRowId: (row) => store.getRowId(row),
      onFlush: (results: TransactionResult[]) => {
        post({ type: 'asyncTransactionsFlushed', results });
      },
    });

    queue.setFlushFn((txs) => {
      const all: TransactionResult[] = [];
      const touched = new Set<string>();
      for (const tx of txs) {
        // Cycle 4 / Task 11 — diff each update row against the stored
        // row BEFORE apply, so we can populate pendingFlashes with the
        // changed (rowId, field) pairs. Skipped when the worker's
        // flash flag is off.
        if (state!.enableCellChangeFlash && tx.update && tx.update.length > 0) {
          stageFlashesForUpdates(state!, tx.update);
        }
        // Cycle 21d / Task 11 — capture pre-apply rows for PREV([col]).
        // Final review Fix 2 — also capture removed rows' pre-apply
        // snapshot (Stage B's delta path needs the OLD value to
        // `removeRow` the correct scalar out of a cached scope's state;
        // `store.getById` is undefined POST-apply for a removed row).
        if ((tx.update && tx.update.length > 0) || (tx.remove && tx.remove.length > 0)) {
          state!.calc.capturePrevForUpdates(store, tx.update ?? [], tx.remove ?? []);
        }
        const r = store.apply(tx);
        all.push(r);
        state!.calc.onTransaction(r);
        // Aggregate cache must drop any row that just mutated so the next
        // QuickFilterPass.apply rebuilds against current values.
        for (const a of r.add)    touched.add(a.rowId);
        for (const u of r.update) touched.add(u.rowId);
        for (const x of r.remove) touched.add(x.rowId);
      }
      // Damage-region rendering (Task 3) — stage every touched rowId for
      // the next `getViewport`'s `touchedRows`. Async-flush-only in this
      // task (mirrors where `pendingFlashes` is staged for the same
      // async-queue path); drained per-rowId in the getViewport handler.
      for (const id of touched) state!.pendingTouched.add(id);
      state!.quickFilter.invalidateRows(touched);
      state!.distinct.invalidateRows(touched);
      // Drop removed rows from the alwaysPass set so the worker never
      // tries to surface a row that no longer exists.
      if (state!.alwaysPassIds.size > 0) {
        for (const tx of txs) {
          if (!tx.remove) continue;
          for (const id of tx.remove) state!.alwaysPassIds.delete(id);
        }
      }
      state!.visibleCache = null;
      state!.visibleCachePromise = null;
      // Async transaction flush: the modelUpdated push lands one
      // microtask later once `buildVisibleAsync` resolves. Cycle 7 / Task 8
      // — when an external filter is active the await also covers the
      // candidates ↔ result round-trip with main.
      const wasPendingSeed = state!.pendingDefaultExpandSeed;
      void invalidateAndCount().then((visibleCount) => {
        // Cycle 15 / Task 7 — when grouping is active, fan the
        // current composite keys back so main's `knownGroupKeys`
        // mirror tracks any group added / removed by this txn.
        const groupKeys = isGroupingActive() ? currentGroupKeys() : undefined;
        // AG parity — first data can arrive via an async flush; if this
        // rebuild consumed the deferred `groupDefaultExpanded` seed, ship
        // the seeded set so main's expansion mirror stays truthful.
        const expandedKeys = wasPendingSeed && !state!.pendingDefaultExpandSeed
          ? (state!.expandedKeys === null ? null : Array.from(state!.expandedKeys))
          : undefined;
        post({ type: 'modelUpdated', visibleCount, groupKeys, expandedKeys });
      });
      return all;
    });

    const comparators = new ComparatorRegistry();
    const aggFuncs = new AggFuncRegistry();
    const group = new GroupPass(store, payload.columns);
    // Cycle 15 / Task 9 — seed the default-expansion rule before any
    // `setGroupModel` lands so the very first model swap re-seeds
    // `state.expandedKeys` from the option (instead of falling back
    // to the all-expanded sentinel). Both fields are independently
    // optional; `setDefaultExpansion` normalises `undefined` to the
    // sentinel values internally.
    if (payload.groupDefaultExpanded !== undefined || payload.groupDefaultExpandedKeys !== undefined) {
      group.setDefaultExpansion({
        expanded: payload.groupDefaultExpanded,
        keys: payload.groupDefaultExpandedKeys,
      });
    }
    // Cycle 15 / Task 10 — install the elision flag before any
    // `setGroupModel` so the very first tree-build's flatOrder
    // honors `groupRemoveSingleChildren`. Init-only; matches the
    // Task 9 default-expansion pattern (no runtime mutation surface).
    {
      // AG v33 `groupHideParentOfSingleChild` (boolean | 'leafGroupsOnly')
      // supersedes the deprecated `groupRemoveSingleChildren` boolean.
      const hideSingle = payload.groupHideParentOfSingleChild
        ?? (payload.groupRemoveSingleChildren === true);
      if (hideSingle) group.setRemoveSingleChildren(hideSingle);
    }
    // Cycle 15 / Task 12 — install the per-group footer flags before
    // the first `setGroupModel` so the very first tree-build's
    // flatOrder carries footer entries. Both default off; init-only
    // mutation surface matches Task 9 / 10. `groupIncludeTotalFooter`
    // is meaningful only as a companion to `groupIncludeFooter` (the
    // GroupPass guards). Wiring both here so the worker doesn't have
    // to plumb a separate setter through.
    if (payload.groupIncludeFooter === true || payload.groupIncludeTotalFooter === true) {
      group.setIncludeFooter(
        payload.groupIncludeFooter === true,
        payload.groupIncludeTotalFooter === true,
      );
    }
    state = {
      store,
      filter:      new FilterPass(store, payload.columns),
      quickFilter: new QuickFilterPass(store, payload.columns),
      distinct:    new DistinctValuesPass(store, payload.columns),
      sort:        new SortPass(store, payload.columns, comparators),
      group,
      groupOutput: null,
      // Cycle 18 / Task 3 — pivot engine shares the same AggFuncRegistry
      // as AggPass so custom aggFuncs resolve identically.
      pivot:       new PivotPass(store, payload.columns, aggFuncs),
      pivotInputIds: null,
      pivotOut:    null,
      groupInputIds: null,
      emitGroupDescendants: false,
      expandedKeys: null,
      comparators,
      aggFuncs,
      // Cycle 21d / Task 10 — calc program store, always constructed
      // (no-program = inert; CalcPass stages gate on hasProgram()).
      calc:        new CalcProgramStore(),
      agg:         new AggPass(store, payload.columns, aggFuncs),
      slicer:      new ViewportSlicer(store, payload.columns),
      queue,
      columns: payload.columns,
      visibleCache: null,
      visibleCachePromise: null,
      ssrmActive: false,
      ssrmClientPipeline: false,
      ssrmOrder: [],
      ssrmRowCount: 0,
      ssrmGroupMetaSeen: false,
      ssrmGrandTotals: null,
      groupMaintainOrder: payload.groupMaintainOrder === true,
      groupAggFiltering: payload.groupAggFiltering === true,
      pendingDefaultExpandSeed: false,
      measureCache: new MeasureCache(1024),
      pendingFallbacks: new Map(),
      nextBatchId: 1,
      externalFilterPresent: false,
      alwaysPassIds: new Set(),
      pendingExternalFilters: new Map(),
      nextExternalFilterCallId: 1,
      postSortRowsPresent: false,
      pendingPostSortRows: new Map(),
      nextPostSortRowsCallId: 1,
      enableCellChangeFlash: payload.enableCellChangeFlash === true,
      pendingFlashes: new Map(),
      // Damage-region rendering (Task 3) — see workerState.ts doc comment.
      pendingTouched: new Set(),
      // Cycle 15 / Task 10 — captured at init; threaded into
      // `sliceGroupedViewport` on every `getViewport` so data-row
      // `groupValue[i]` slots populate when the option is on.
      showOpenedGroup: payload.showOpenedGroup === true,
      groupHideOpenParents: payload.groupHideOpenParents === true,
      // A-P2 — per-generation grouped-walk memo; see groupViewCache.ts.
      groupViewCache: createGroupViewCaches(),
    };
    // Cycle 21d / Task 11 — seam wiring: every pass reads calc-column
    // values through the same CalcProgramStore instance held on state.
    state.filter.setCalcSource(state.calc);
    state.sort.setCalcSource(state.calc);
    state.group.setCalcSource(state.calc);
    state.slicer.setCalcSource(state.calc);
    // Cycle 21d / Task 13 review — DistinctValuesPass never got the Task
    // 11 seam; a calc column's set-filter popup was silently empty.
    state.distinct.setCalcSource(state.calc);

    post({ id, type: 'ready' });
  }

  /** Project the autoHeight columns from the current `state.columns`. Only
   *  columns whose metadata is complete (font + width + lineHeight) are
   *  included — partial metadata would silently misalign the measurement
   *  with the renderer. */
  function autoHeightCols(): AutoHeightCol[] {
    if (!state) return [];
    const out: AutoHeightCol[] = [];
    for (const col of state.columns) {
      if (!col.autoHeight || !col.field) continue;
      const font = col.autoHeightFont;
      const width = col.autoHeightWidth;
      const lineHeight = col.autoHeightLineHeight;
      const padding = col.autoHeightPadding ?? 0;
      if (!font || width == null || lineHeight == null) continue;
      out.push({ colId: col.colId, field: col.field, font, width, lineHeight, padding });
    }
    return out;
  }

  /** Run autoHeight measurement over the rowIds in `visIds`. Uses the
   *  worker's OffscreenCanvas when available; otherwise batches into a
   *  `measureTextRequest` fallback. Writes contributions to the store and
   *  posts a `heightsChanged` push with the updated rows. The push only
   *  fires when at least one resolved height changed.
   *
   *  This runs OUT-OF-BAND from the `getViewport` response so the first
   *  chunk lands fast; the heights settle one rAF later when this finishes. */
  async function runAutoHeightPass(visIds: string[], rowStartArg: number, rowEndArg: number): Promise<void> {
    if (!state) return;
    const cols = autoHeightCols();
    if (cols.length === 0) return;
    const rowStart = Math.max(0, rowStartArg);
    const rowEnd = Math.min(visIds.length, rowEndArg);
    if (rowEnd <= rowStart) return;

    const gridRH = state.store.getGridRowHeight();
    const measure = workerCanMeasure() ? null : 'fallback';
    // Per-font measurer cache — building one per font avoids re-setting
    // ctx.font inside the inner loop, which is a non-trivial CSS-shorthand
    // parse per call.
    const measurers = new Map<string, ((s: string) => number)>();
    const getMeasurer = (font: string) => {
      if (measure === 'fallback') return null;
      let m = measurers.get(font);
      if (!m) {
        m = offscreenMeasurer(font) ?? undefined;
        if (m) measurers.set(font, m);
      }
      return m ?? null;
    };

    const pendingItems: MeasureTextItem[] = [];
    const pendingMeta: PendingMeasure[] = [];
    let anyChanged = false;
    const initialHeights = new Float32Array(rowEnd - rowStart);
    for (let i = rowStart; i < rowEnd; i++) {
      initialHeights[i - rowStart] = state.store.effectiveShippedHeight(visIds[i]!);
    }

    for (let i = rowStart; i < rowEnd; i++) {
      const rowId = visIds[i];
      if (rowId === undefined) continue;
      const row = state.store.getById(rowId);
      if (!row) continue;
      for (const col of cols) {
        const raw = (row as Record<string, unknown>)[col.field];
        const text = raw == null ? '' : String(raw);
        // Empty cells contribute nothing — measuring an empty string still
        // produces `lineHeight + 2 * padding`, which can exceed the grid
        // baseline (e.g. lineHeight 32 + padding 4 = 40 vs baseline 30) and
        // silently bump every empty row. Skip to keep autoHeight strictly
        // content-driven.
        if (text === '') {
          // Drop any stale contribution from a prior populated value so a
          // cleared cell shrinks back to baseline.
          state.store.clearAutoHeightContribution(rowId, col.colId, gridRH);
          continue;
        }
        const key = measureKey(col.font, col.width, text);
        const cached = state.measureCache.get(key);
        if (cached !== undefined) {
          state.store.setAutoHeightContribution(rowId, col.colId, cached, gridRH);
          continue;
        }
        const m = getMeasurer(col.font);
        if (m) {
          const h = wrapTextToHeight(text, col.width, col.lineHeight, col.padding, m);
          state.measureCache.set(key, h);
          state.store.setAutoHeightContribution(rowId, col.colId, h, gridRH);
        } else {
          pendingMeta.push({ rowId, colId: col.colId, cacheKey: key, itemIndex: pendingItems.length });
          pendingItems.push({
            text, width: col.width, font: col.font,
            lineHeight: col.lineHeight, padding: col.padding,
          });
        }
      }
    }

    if (pendingItems.length > 0) {
      const batchId = state.nextBatchId++;
      const heights = await new Promise<Float32Array>((resolve) => {
        state!.pendingFallbacks.set(batchId, resolve);
        post({ type: 'measureTextRequest', batchId, items: pendingItems });
      });
      for (const meta of pendingMeta) {
        const h = heights[meta.itemIndex];
        if (h === undefined) continue;
        state.measureCache.set(meta.cacheKey, h);
        state.store.setAutoHeightContribution(meta.rowId, meta.colId, h, gridRH);
      }
    }

    // Emit one chunk-aligned heights buffer for the whole range. Main applies
    // the delta to its Fenwick index keyed by global visible-row index.
    const finalHeights = new Float32Array(rowEnd - rowStart);
    for (let i = rowStart; i < rowEnd; i++) {
      const h = state.store.effectiveShippedHeight(visIds[i]!);
      finalHeights[i - rowStart] = h;
      if (h !== initialHeights[i - rowStart]) anyChanged = true;
    }
    if (anyChanged) {
      post(
        { type: 'heightsChanged', rowStart, heights: finalHeights },
        [finalHeights.buffer],
      );
    }
  }

  return {
    handle(req: WorkerRequest): void {
      // Cycle 7 / Task 8 — the request pipeline is async because the
      // external filter round-trip (main runs the predicate, ships
      // survivors back) is interleaved into `buildVisibleAsync`.
      // `host.handle` stays fire-and-forget at the call site; errors
      // post through the same `error` envelope.
      void handleAsync(req).catch((err) => {
        post({ id: (req as { id: number }).id, type: 'error', error: String((err as Error).message ?? err) });
      });
    },
  };

  /** Cycle 19 / Task 6 — the helper bag threaded through every handler
   *  as `HandlerCtx.helpers`. Each entry is a bound reference to the
   *  matching closure defined above (so `state` is captured
   *  identically); we build it lazily inside `handleAsync` after
   *  `state` is confirmed non-null so the dispatcher can `assert state`
   *  once and hand it down to every handler. */
  function buildHelpers(): WorkerHelpers {
    return {
      buildCandidates,
      runExternalFilter,
      buildVisibleAsync,
      runPostSortRows,
      visibleAsync,
      isGroupingActive,
      isPivotActive,
      effectiveExpandedKeys,
      currentGroupKeys,
      collectGroupDescendantRowIds,
      buildGroupMetaLookup,
      computeStickyAncestors,
      invalidateAndCount,
      stageFlashesForUpdates: (updates) => stageFlashesForUpdates(state!, updates),
      autoHeightCols,
      runAutoHeightPass,
    };
  }

  async function handleAsync(req: WorkerRequest): Promise<void> {
      try {
        if (req.type === 'init') {
          initHost(req.payload, req.id);
          return;
        }

        if (!state) {
          post({ id: req.id, type: 'error', error: 'not initialized' });
          return;
        }

        // Cycle 19 / Task 6 — typed dispatch table. The giant switch
        // that used to live here has moved into `worker/handlers/*.ts`;
        // this lookup routes each `WorkerRequest['type']` to the
        // domain handler that owns it. Missing keys are impossible in
        // the type system (`DispatchTable` is exhaustive over the
        // request union minus `init`), but a runtime guard here keeps
        // the branch defensive against protocol drift.
        const handler = dispatchTable[req.type as Exclude<WorkerRequest['type'], 'init'>];
        if (!handler) {
          post({ id: req.id, type: 'error', error: `unknown request type: ${(req as WorkerRequest).type}` });
          return;
        }
        const ctx: HandlerCtx = { state, post, helpers: buildHelpers() };
        await handler(ctx, req as never);
        return;

      } catch (err) {
        post({ id: (req as { id: number }).id, type: 'error', error: String((err as Error).message ?? err) });
      }
  }
}

// ---------------------------------------------------------------------------
// Auto-wire the actual Worker global when running inside a Worker context.
// ---------------------------------------------------------------------------
// Use a conditional that avoids issues in Node test environments where `self`
// may not exist or may not be a DedicatedWorkerGlobalScope.
if (
  typeof self !== 'undefined' &&
  typeof (self as any).postMessage === 'function' &&
  // Distinguish Worker global from window (window.postMessage exists too but
  // window has `document`; workers do not).
  typeof (self as any).document === 'undefined'
) {
  const _self = self as unknown as {
    onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
    postMessage(msg: any, transfer?: any[]): void;
  };

  const host = createWorkerHost((msg, xfer) => {
    if (xfer && xfer.length > 0) {
      _self.postMessage(msg, xfer);
    } else {
      _self.postMessage(msg);
    }
  });

  _self.onmessage = (e: MessageEvent<WorkerRequest>) => host.handle(e.data);
}
