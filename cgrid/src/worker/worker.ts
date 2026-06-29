import type {
  WorkerRequest, WorkerResponse, WorkerPush, WorkerInitPayload, MeasureTextItem,
  StickyAncestor,
} from './protocol';
import { collectViewportTransferables } from './protocol';
import {
  RowStore, FilterPass, SortPass, AggPass, GroupPass, ViewportSlicer, TransactionQueue,
  QuickFilterPass, DistinctValuesPass, diffRowFields, PivotPass,
} from './dataPipeline';
import type { GroupNode, GroupPassOutput } from './passes/groupPass';
import type { PivotModel } from './passes/pivotPass';
import {
  computeGroupVisibleOrder, computeGroupVisibleRowCount, sliceGroupedViewport,
  type VisibleRowEntry,
} from './viewportSlicer';
import { ComparatorRegistry } from './comparatorRegistry';
import { AggFuncRegistry, type IAggFunc } from './aggFuncRegistry';
import type { TransactionResult } from '../types';
import type { WorkerColumn } from './protocol';
import {
  MeasureCache, measureKey, offscreenMeasurer, workerCanMeasure, wrapTextToHeight,
} from './measureText';
import { measureColumnWidths, type AutosizeColumnSpec } from './autosize';
import { serializeRanges, deserializeTsv } from './passes/clipboardPass';

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

interface State {
  store: RowStore;
  filter: FilterPass;
  /** Cycle 7 / Task 7 — runs before `filter` in the pipeline. `apply()`
   *  returns `null` when no terms are set so the buildVisible composer
   *  can short-circuit and skip the intersection. */
  quickFilter: QuickFilterPass;
  /** Cycle 7 / Task 9 — distinct-value derivation for the set-filter
   *  popup. Cached per-colId; invalidated through the same transaction
   *  hook `QuickFilterPass.invalidateRows` plugs into. */
  distinct: DistinctValuesPass;
  sort: SortPass;
  /** Cycle 15 / Task 1 — hierarchical row grouping. Runs AFTER quick /
   *  column / external / alwaysPass filters and BEFORE SortPass.
   *  Stores the built tree on `groupOutput`; downstream consumers
   *  (Task 2 slicer, Task 10 sort, Task 11 group totals) read from it.
   *  When the model is empty the output's `bypassed: true` lets every
   *  consumer short-circuit. */
  group: GroupPass;
  /** Cycle 15 / Task 1 — last `GroupPass.apply` result. Recomputed on
   *  every `buildVisibleAsync`. `null` until the first build runs. */
  groupOutput: GroupPassOutput | null;
  /** Cycle 18 / Task 3 — pivot engine. Runs in the `getViewport` handler
   *  (like `AggPass`) when a non-empty pivot model is installed, reading
   *  `pivotInputIds` + `groupOutput`. Bypasses (ships no pivot fields)
   *  when no pivot/value columns are set. */
  pivot: PivotPass;
  /** Cycle 18 / Task 3 — post-filter (pre-sort) rowId set captured on
   *  every `buildVisibleAsync`. `PivotPass.apply` scans these for key
   *  discovery + grand-total aggregation; for the per-group cross-tabs
   *  it uses `groupInputIds` (which `GroupNode.childIndices` index into)
   *  when grouping is active. `null` until the first build runs. */
  pivotInputIds: readonly string[] | null;
  /** Cycle 18 / Task 8d — last `PivotPass.apply` result. Computed inside
   *  `buildVisibleAsync` BEFORE `SortPass.applyGrouped` so a sort entry
   *  targeting a pivot-result column can re-order the row groups by the
   *  aggregate value. The chunk-emit site reads this back instead of
   *  recomputing — PivotPass output is sort-invariant (keyed by group
   *  key strings, not node order), so caching is safe. `null` until the
   *  first build with an active pivot model runs. */
  pivotOut: import('./passes/pivotPass').PivotPassOutput | null;
  /** Cycle 15 / Task 8 — snapshot of the rowId array fed into the most
   *  recent `GroupPass.apply` (the post-filter, pre-sort set). Captured
   *  alongside `groupOutput` so we can translate a `GroupNode`'s
   *  `childIndices` (indices into this array) back to string rowIds
   *  without re-running the filter pipeline. Used by
   *  `collectGroupDescendantRowIds` to populate the `groupKeysSnapshot`
   *  reply's `groupDescendants` field for tri-state selection. */
  groupInputIds: readonly string[] | null;
  /** Cycle 15 / Task 8 — when true, every `groupKeysSnapshot` reply
   *  carries the parallel `groupDescendants: string[][]` array
   *  populated from the current `groupOutput` + `groupInputIds`. Off
   *  by default to keep the reply small for the common case
   *  (`groupSelectsChildren: false`). Main flips it on via
   *  `setEmitGroupDescendants(true)` at init when the option lands. */
  emitGroupDescendants: boolean;
  /** Cycle 15 / Task 7 — persistent expanded-key set the slicer + meta
   *  lookup honor. `null` is the "default = every group expanded"
   *  sentinel (matches the Task 4 mount behaviour). A non-null set is
   *  the explicit list of expanded composite group keys; anything not
   *  in the set is collapsed. Mutated by the `setExpandedKeys`
   *  protocol message; read by `effectiveExpandedKeys()` everywhere
   *  the pipeline needs to know what's visible. */
  expandedKeys: Set<string> | null;
  /** Cycle 15 / Task 10 — `showOpenedGroup` option captured at init.
   *  When `true`, the grouped slicer populates `groupValue[i]` for
   *  data rows with their leaf-parent group's formatted value so the
   *  `'group'` renderer can paint a muted echo. Off by default;
   *  flipping mid-flight isn't supported (init-only — matches the
   *  `groupDefaultExpanded` pattern). The flag is also read in the
   *  `getViewport` handler so the slicer receives it per call. */
  showOpenedGroup: boolean;
  /** Cycle 15.5 / Task 4 — `groupHideOpenParents` option captured at
   *  init. When `true`, expanded parent group rows are skipped in
   *  `computeGroupVisibleOrder`; children appear in the parent's slot.
   *  The sticky band suppresses automatically (no hidden parent to pin).
   *  Init-only; off by default. */
  groupHideOpenParents: boolean;
  /** Cycle 8 / Task 3 — named comparators registered via
   *  `registerComparator`. `SortPass.apply` looks up each sorted column's
   *  `comparator` (a string name on the `WorkerColumn`) against this
   *  registry; unknown names fall back to the built-in `compare()`. */
  comparators: ComparatorRegistry;
  /** Cycle 14 / Task 3 — named column-aggregation registry. Built-ins
   *  (`sum / avg / min / max / count / first / last`) pre-registered;
   *  custom funcs arrive via `setAggFuncs`. Owned here so a `setAggFuncs`
   *  message and the next `AggPass.apply` see the same Map instance. */
  aggFuncs: AggFuncRegistry;
  agg: AggPass;
  slicer: ViewportSlicer;
  queue: TransactionQueue;
  columns: WorkerColumn[];
  visibleCache: string[] | null;
  /** Cache of `(font|width|text)` → wrapped-text-height. Bounded LRU. */
  measureCache: MeasureCache;
  /** Pending fallback batches keyed by `batchId`. Resolves when main posts
   *  back the matching `measureTextResponse`. */
  pendingFallbacks: Map<number, (heights: Float32Array) => void>;
  nextBatchId: number;
  /** Cycle 7 / Task 8 — when true, `buildVisibleAsync` pauses after
   *  applying column + quick filters to push the candidate rowIds to
   *  main, then resumes with the surviving subset. When false the
   *  pipeline runs end-to-end synchronously. */
  externalFilterPresent: boolean;
  /** Cycle 7 / Task 8 — rowIds that bypass every filter (column / quick /
   *  external). Main computes the set by running `alwaysPassFilter`
   *  against its row-data cache and ships via `setAlwaysPassRowIds`. */
  alwaysPassIds: Set<string>;
  /** Cycle 7 / Task 8 — pending external-filter round-trips keyed by
   *  `callId`. The promise resolves when main posts back
   *  `externalFilterResult` for the same callId. */
  pendingExternalFilters: Map<number, (surviving: string[]) => void>;
  /** Cycle 7 / Task 8 — monotonic counter for external-filter callIds. */
  nextExternalFilterCallId: number;
  /** Cycle 8 / Task 4 — when true, `buildVisibleAsync` pauses after
   *  `SortPass.apply` to push the sorted rowIds to main and awaits a
   *  re-ordered array. When false, the pipeline runs end-to-end with
   *  zero round-trip overhead. */
  postSortRowsPresent: boolean;
  /** Cycle 8 / Task 4 — pending post-sort round-trips keyed by `callId`.
   *  The promise resolves when main posts back `postSortRowsResult` for
   *  the same callId. */
  pendingPostSortRows: Map<number, (reordered: string[]) => void>;
  /** Cycle 8 / Task 4 — monotonic counter for post-sort callIds. */
  nextPostSortRowsCallId: number;
  /** Cycle 4 / Task 11 (cell-flash patch) — when true, the worker
   *  computes per-row diffs on `applyTransaction.update` and stages
   *  the changed (rowId, field) pairs in `pendingFlashes`. Runtime-
   *  mutable via the `setEnableCellChangeFlash` message; off by
   *  default so apps that don't use flash pay zero diff overhead. */
  enableCellChangeFlash: boolean;
  /** Cycle 4 / Task 11 (cell-flash patch) — staged changed-field set
   *  per rowId, drained into the next `ViewportSlicer.slice` call
   *  (which packs the matching bits into the chunk's `flashMask`).
   *  Populated by both `applyTransaction.update` diffs AND
   *  programmatic `flashCells` requests. Cleared after every slice
   *  so each flash fires exactly once. */
  pendingFlashes: Map<string, Set<string>>;
}

type Postable = WorkerResponse | WorkerPush;
type PostFn = (msg: Postable, transfer?: ArrayBuffer[]) => void;

export interface WorkerHost {
  handle(req: WorkerRequest): void;
}

export function createWorkerHost(post: PostFn): WorkerHost {
  let state: State | null = null;

  function buildCandidates(): string[] {
    if (!state) return [];
    // Cycle 7 / Task 7 — QuickFilterPass runs BEFORE FilterPass. A null
    // return means no quick-filter constraint, so we skip the intersection
    // entirely.
    const quickIds = state.quickFilter.apply();
    let ids = state.filter.apply();
    if (quickIds !== null) {
      const allow = new Set(quickIds);
      ids = ids.filter((id) => allow.has(id));
    }
    return ids;
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
    let ids = buildCandidates();
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
      }, state.pivotOut ?? undefined);
    } else {
      ids = state.sort.apply(ids);
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
    if (!state.visibleCache) {
      state.visibleCache = await buildVisibleAsync();
    }
    return state.visibleCache;
  }

  /** Cycle 15 / Task 4 — true when the most recent `buildVisibleAsync`
   *  produced a group tree the slicer should walk over (instead of
   *  emitting the flat post-sort row order). Reads the latest
   *  `state.groupOutput` set inside `buildVisibleAsync`. */
  function isGroupingActive(): boolean {
    return !!state?.groupOutput && !state.groupOutput.bypassed;
  }

  /** Cycle 15 / Task 7 — resolve the effective expanded-keys set for the
   *  next pipeline pass. When `state.expandedKeys` is non-null the API
   *  has been driven explicitly (collapseAll / setExpanded /
   *  collapse-and-toggle); use it verbatim. When it is `null` the grid
   *  is in the "default = every group expanded" mode (Task 4 mount,
   *  Task 7 `expandAll`); derive the all-keys set from the current
   *  `flatOrder` so the slicer + meta lookup paint with chevrons in
   *  the down/expanded state for every group. */
  function effectiveExpandedKeys(): Set<string> {
    if (state?.expandedKeys) return state.expandedKeys;
    const out = new Set<string>();
    if (!state?.groupOutput) return out;
    for (const e of state.groupOutput.flatOrder) {
      if (e.kind === 'group') out.add(e.key);
    }
    return out;
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
        let formatted: string;
        if (value === null || value === undefined) formatted = '';
        else if (colType === 'number' && typeof value === 'number') formatted = Number.isFinite(value) ? String(value) : '';
        else formatted = String(value);
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
      if (entry.kind === 'group') lastAtDepth.set(entry.depth, entry.key);
    }
    if (lastAtDepth.size === 0) return [];
    const result: StickyAncestor[] = [];
    for (const [depth, key] of [...lastAtDepth.entries()].sort((a, b) => a[0] - b[0])) {
      const meta = metaLookup.get(key);
      if (!meta || !meta.isExpanded) continue;
      result.push({ depth, key, colId: meta.colId, value: meta.value, childCount: meta.childCount, isExpanded: meta.isExpanded });
    }
    return result;
  }

  async function invalidateAndCount(): Promise<number> {
    if (!state) return 0;
    state.visibleCache = await buildVisibleAsync();
    if (isGroupingActive()) {
      return computeGroupVisibleRowCount(state.groupOutput!.flatOrder, effectiveExpandedKeys(), state.groupHideOpenParents);
    }
    return state.visibleCache.length;
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
      waitMs: 50,
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
        const r = store.apply(tx);
        all.push(r);
        // Aggregate cache must drop any row that just mutated so the next
        // QuickFilterPass.apply rebuilds against current values.
        for (const a of r.add)    touched.add(a.rowId);
        for (const u of r.update) touched.add(u.rowId);
        for (const x of r.remove) touched.add(x.rowId);
      }
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
      // Async transaction flush: the modelUpdated push lands one
      // microtask later once `buildVisibleAsync` resolves. Cycle 7 / Task 8
      // — when an external filter is active the await also covers the
      // candidates ↔ result round-trip with main.
      void invalidateAndCount().then((visibleCount) => {
        // Cycle 15 / Task 7 — when grouping is active, fan the
        // current composite keys back so main's `knownGroupKeys`
        // mirror tracks any group added / removed by this txn.
        const groupKeys = isGroupingActive() ? currentGroupKeys() : undefined;
        post({ type: 'modelUpdated', visibleCount, groupKeys });
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
    if (payload.groupRemoveSingleChildren === true) {
      group.setRemoveSingleChildren(true);
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
      agg:         new AggPass(store, payload.columns, aggFuncs),
      slicer:      new ViewportSlicer(store, payload.columns),
      queue,
      columns: payload.columns,
      visibleCache: null,
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
      // Cycle 15 / Task 10 — captured at init; threaded into
      // `sliceGroupedViewport` on every `getViewport` so data-row
      // `groupValue[i]` slots populate when the option is on.
      showOpenedGroup: payload.showOpenedGroup === true,
      groupHideOpenParents: payload.groupHideOpenParents === true,
    };

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

        switch (req.type) {
          case 'setRowData': {
            state.store.setAll(req.payload.rows as any[], req.payload.heightsByRowId);
            // Cycle 7 / Task 8 — a full data replace invalidates any
            // alwaysPass set computed against the previous data. Main
            // re-computes and ships a fresh set via `setAlwaysPassRowIds`
            // when it follows up with `setRowData`.
            state.alwaysPassIds.clear();
            // Cycle 7 / Task 9 — a full data replace also invalidates
            // the per-column distinct caches; the previous row set has
            // no relationship to the new one.
            state.distinct.invalidateRows([]);
            // Cycle 4 / Task 11 — wipe pendingFlashes: any cell from
            // the previous data set is no longer in the store, and
            // flashing the initial setRowData would create an
            // overwhelming "everything just changed" highlight wave.
            state.pendingFlashes.clear();
            state.visibleCache = null;
            const visibleCount = await invalidateAndCount();
            // Cycle 15 / Task 7 — a full data replace can change
            // the set of group keys (new tickers, dropped tickers).
            // Ride the groupKeys snapshot back on the same reply so
            // `knownGroupKeys` stays in sync without an extra
            // round-trip.
            const groupKeys = isGroupingActive() ? currentGroupKeys() : undefined;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount, groupKeys });
            break;
          }

          case 'applyTransaction': {
            const { add, update, remove, async: isAsync, heightsByRowId } = req.payload;
            if (isAsync) {
              state.queue.push({ add: add as any[], update: update as any[], remove, heightsByRowId });
              post({ id: req.id, type: 'transactionFlushed', results: { add: [], update: [], remove: [] } });
            } else {
              // Cycle 4 / Task 11 — diff updates BEFORE apply (need old
              // row values to compare). Skipped when the worker flag is
              // off (zero cost for apps that don't use flash).
              if (state.enableCellChangeFlash && update && update.length > 0) {
                stageFlashesForUpdates(state, update as unknown[]);
              }
              const results = state.store.apply({ add: add as any[], update: update as any[], remove, heightsByRowId });
              // Cycle 7 / Task 7 — sync transactions also need the quick
              // filter aggregate cache invalidated for the touched rows.
              const touched = new Set<string>();
              for (const a of results.add)    touched.add(a.rowId);
              for (const u of results.update) touched.add(u.rowId);
              for (const x of results.remove) touched.add(x.rowId);
              state.quickFilter.invalidateRows(touched);
              state.distinct.invalidateRows(touched);
              // Drop removed rows from the alwaysPass set so the worker
              // never surfaces a row that no longer exists.
              if (state.alwaysPassIds.size > 0 && remove) {
                for (const id of remove) state.alwaysPassIds.delete(id);
              }
              state.visibleCache = null;
              post({ id: req.id, type: 'transactionFlushed', results });
              const visCount = await invalidateAndCount();
              const groupKeys = isGroupingActive() ? currentGroupKeys() : undefined;
              post({ type: 'modelUpdated', visibleCount: visCount, groupKeys });
            }
            break;
          }

          case 'setSortModel': {
            state.sort.setModel(req.payload);
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await invalidateAndCount() });
            break;
          }

          case 'setFilterModel': {
            state.filter.setModel(req.payload);
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await invalidateAndCount() });
            break;
          }

          case 'setGroupModel': {
            // Cycle 15 / Task 1 — replace the group model; reject
            // unknown / duplicate colIds at the set-site so the worker
            // surfaces malformed input as an `error` envelope instead
            // of silently producing a malformed tree. Force a pipeline
            // re-run so the next `getViewport` sees the fresh tree.
            try {
              state.group.setModel(req.payload);
            } catch (err) {
              post({ id: req.id, type: 'error', error: String((err as Error).message ?? err) });
              break;
            }
            // Cycle 15 / Task 7 — a fresh group model invalidates any
            // composite keys main was tracking (a depth or grouping-
            // column swap rewrites every key). Reset to the
            // "default = all expanded" sentinel before the pipeline
            // runs; Task 9 below re-seeds the explicit set off the
            // freshly-built tree when the `groupDefaultExpanded` /
            // `groupDefaultExpandedKeys` options demand it.
            state.expandedKeys = null;
            state.visibleCache = null;
            // Build the visible cache (which populates `groupOutput`)
            // before we ask GroupPass to compute the default expansion
            // — Task 9's depth-bounded set needs the tree's roots.
            const visibleCount0 = await invalidateAndCount();
            // Cycle 15 / Task 9 — seed `state.expandedKeys` from the
            // default-expansion rule. `null` keeps the all-expanded
            // sentinel (cheap path); an explicit Set installs the
            // depth-bounded / explicit-keys override. When the seed
            // changes the set, a follow-up `invalidateAndCount()`
            // recomputes the visible row count against the new
            // collapsed view so main's `rowCount` mirror is honest
            // about the post-default visible total.
            const groupRoots = state.groupOutput?.roots ?? [];
            const defaultExpandedKeys = state.group.computeDefaultExpandedKeys(groupRoots);
            let visibleCount = visibleCount0;
            if (defaultExpandedKeys !== null) {
              state.expandedKeys = defaultExpandedKeys;
              visibleCount = await invalidateAndCount();
            }
            post({
              id: req.id,
              type: 'groupKeysSnapshot',
              count: state.store.size(),
              visibleCount,
              groupKeys: currentGroupKeys(),
              groupDescendants: state.emitGroupDescendants
                ? collectGroupDescendantRowIds()
                : undefined,
              // Cycle 15 / Task 9 — when the default-expansion rule
              // resolves to anything other than the all-expanded
              // sentinel, ship the materialised set so main's mirror
              // (`getExpandedKeys()` snapshot) reads the same view as
              // the next paint. `null` means "default-all sentinel,
              // no override" — the all-expanded path the
              // pre-Task-9 reply implicitly carried.
              expandedKeys: defaultExpandedKeys === null ? null : Array.from(defaultExpandedKeys),
            });
            break;
          }

          case 'setStrictPivotColumnOrder': {
            // Cycle 18 / Task 8c — push the strict-order flag into the
            // PivotPass. Cycle 18 / Task 8d — PivotPass now runs inside
            // `buildVisibleAsync` (before SortPass) so the cached
            // `state.pivotOut` is part of the visible-build output.
            // Invalidate the visible cache so the next viewport
            // rebuilds with the new flag.
            state.pivot.setStrictPivotColumnOrder(req.payload === true);
            const vc = await invalidateAndCount();
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: vc });
            break;
          }

          case 'setPivotMaxGeneratedColumns': {
            // Cycle 18 / Task 8a — push the cap into PivotPass. The next
            // `getViewport` honors the new cap; if it would breach, the
            // chunk carries `pivotMaxColumnsReached` and the main thread
            // fires the public event. Cycle 18 / Task 8d — PivotPass now
            // runs inside `buildVisibleAsync`; invalidate the cache so
            // the new cap propagates to the cached `state.pivotOut`.
            state.pivot.setMaxGeneratedColumns(req.payload as number | undefined);
            const vc = await invalidateAndCount();
            post({
              id: req.id,
              type: 'rowCount',
              count: state.store.size(),
              visibleCount: vc,
            });
            break;
          }

          case 'setPivotModel': {
            // Cycle 18 / Task 3 — install / replace the pivot model.
            // Reject unknown / fieldless colIds at the set-site (mirrors
            // setGroupModel) so malformed input surfaces as an `error`
            // envelope instead of a silently broken cross-tab. The pivot
            // model does NOT change which rows are visible (it's a column
            // transform), so the visible cache is untouched — the next
            // getViewport simply re-runs PivotPass against the cached
            // post-filter set. Resolves with the current visible count.
            try {
              state.pivot.setModel(req.payload as PivotModel);
            } catch (err) {
              post({ id: req.id, type: 'error', error: String((err as Error).message ?? err) });
              break;
            }
            post({
              id: req.id,
              type: 'rowCount',
              count: state.store.size(),
              visibleCount: await invalidateAndCount(),
            });
            break;
          }

          case 'setExpandedKeys': {
            // Cycle 15 / Task 7 — replace the persistent expanded set.
            // `null` means "revert to the all-expanded default" (used by
            // `expandAll()`); an array is the explicit set. We do NOT
            // validate keys against the current tree — stale keys from
            // a prior model are harmless (they just don't match any
            // group node and silently fall out). `visibleCache`
            // doesn't need invalidation: the cached flat ids stay
            // identical; only the group walk over `flatOrder` honours
            // the new set.
            state.expandedKeys = req.payload.keys === null
              ? null
              : new Set(req.payload.keys);
            const visibleCount = await invalidateAndCount();
            post({
              id: req.id,
              type: 'groupKeysSnapshot',
              count: state.store.size(),
              visibleCount,
              groupKeys: currentGroupKeys(),
              groupDescendants: state.emitGroupDescendants
                ? collectGroupDescendantRowIds()
                : undefined,
            });
            break;
          }

          case 'setEmitGroupDescendants': {
            // Cycle 15 / Task 8 — toggle the descendant-shipment flag.
            // When `true`, every `groupKeysSnapshot` reply carries the
            // parallel `groupDescendants: string[][]` array so the
            // main-thread `GroupMembershipResolver` can cascade
            // selection + compute tri-state. Resolves with the current
            // groupKeys + descendants so the toggle-on call itself
            // primes the main-side cache (no follow-up
            // `setGroupModel` needed). Idempotent — re-toggling to the
            // same value is fine.
            state.emitGroupDescendants = req.payload.enabled;
            post({
              id: req.id,
              type: 'groupKeysSnapshot',
              count: state.store.size(),
              visibleCount: await invalidateAndCount(),
              groupKeys: currentGroupKeys(),
              groupDescendants: state.emitGroupDescendants
                ? collectGroupDescendantRowIds()
                : undefined,
            });
            break;
          }

          case 'updateColumns': {
            // Swap column metadata in place across every pass so an in-flight
            // filter/sort model stays applied against the new columns.
            const cols = req.payload.columns;
            state.columns = cols;
            state.filter.setColumns(cols);
            state.quickFilter.setColumns(cols);
            state.distinct.setColumns(cols);
            state.sort.setColumns(cols);
            state.group.setColumns(cols);
            state.pivot.setColumns(cols);
            state.agg.setColumns(cols);
            state.slicer.setColumns(cols);
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await invalidateAndCount() });
            break;
          }

          case 'setQuickFilter': {
            const { terms, cacheQuickFilter, colIds } = req.payload;
            state.quickFilter.setCacheEnabled(cacheQuickFilter);
            state.quickFilter.setColIds(colIds);
            state.quickFilter.setTerms(terms);
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await invalidateAndCount() });
            break;
          }

          case 'setExternalFilterPresent': {
            // Cycle 7 / Task 8 — flip the round-trip on or off and
            // re-evaluate. The post-toggle visible count rides back on
            // the reply so the main thread can update `rowCount` in one
            // round-trip.
            state.externalFilterPresent = req.payload.present === true;
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await invalidateAndCount() });
            break;
          }

          case 'setAlwaysPassRowIds': {
            // Cycle 7 / Task 8 — replace the alwaysPass set wholesale.
            // Main runs `options.alwaysPassFilter` against its row-data
            // cache and ships the resolved id list whenever data changes.
            state.alwaysPassIds = new Set(req.payload.rowIds);
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await invalidateAndCount() });
            break;
          }

          case 'setPostSortRowsPresent': {
            // Cycle 8 / Task 4 — flip the post-sort round-trip on or off
            // and re-evaluate. Mirrors `setExternalFilterPresent` —
            // toggling forces a `buildVisibleAsync` so the next paint
            // honors the new pipeline shape.
            state.postSortRowsPresent = req.payload.present === true;
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await invalidateAndCount() });
            break;
          }

          case 'postSortRowsResult': {
            // Cycle 8 / Task 4 — main has run `options.postSortRows`
            // against its row-data cache and is shipping the re-ordered
            // ids back. Resolve the in-flight pipeline promise keyed by
            // callId; the awaiting `buildVisibleAsync` resumes and the
            // original pipeline request's reply (rowCount /
            // transactionFlushed / etc.) lands once it finishes.
            const { callId, reordered } = req.payload;
            const resolver = state.pendingPostSortRows.get(callId);
            if (resolver) {
              state.pendingPostSortRows.delete(callId);
              resolver(reordered);
            }
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: state.visibleCache?.length ?? 0 });
            break;
          }

          case 'externalFilterResult': {
            // Cycle 7 / Task 8 — main has run the per-row predicate over
            // the candidate set and is shipping the surviving ids back.
            // Resolve the in-flight pipeline promise keyed by callId.
            // No reply envelope; the original pipeline request's reply
            // (rowCount / transactionFlushed / etc.) lands once the
            // awaiting handler resumes. We still post a no-op reply
            // because every WorkerRequest carries an id the client's
            // `send` is waiting on — otherwise the pending Map would
            // leak.
            const { callId, surviving } = req.payload;
            const resolver = state.pendingExternalFilters.get(callId);
            if (resolver) {
              state.pendingExternalFilters.delete(callId);
              resolver(surviving);
            }
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: state.visibleCache?.length ?? 0 });
            break;
          }

          case 'setEnableCellChangeFlash': {
            // Cycle 4 / Task 11 — runtime mutation. Flipping off
            // wipes pendingFlashes too so a stale "flash on next view"
            // entry from before the toggle doesn't paint.
            state.enableCellChangeFlash = req.payload.enabled === true;
            if (!state.enableCellChangeFlash) state.pendingFlashes.clear();
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: state.visibleCache?.length ?? 0 });
            break;
          }

          case 'setAggFuncs': {
            // Cycle 14 / Task 3 — replace the custom agg-func layer
            // wholesale. Each entry's `source` is the original
            // function's `Function.prototype.toString()` form; the
            // worker rebuilds the callable via `new Function` in
            // strict-mode (mirrors `registerComparator` below).
            //
            // Main-side already screened for closures (it rebuilt + ran
            // the function against a probe input before shipping), so a
            // `ReferenceError` here would be a genuine app bug — surface
            // it as an error reply instead of silently dropping the
            // entry, so misbehaving funcs are loud.
            //
            // Re-running the pipeline isn't needed: the AggPass reads
            // through the registry on every `apply`, so the very next
            // `getViewport` already picks up the new resolutions. We
            // still bust `visibleCache` so a stale cached
            // `chunk.totals` (e.g. from a viewport that landed mid-flip)
            // doesn't paint — even though that's a defensive belt-and-
            // braces gesture (`visibleCache` doesn't hold the totals).
            const built: Record<string, IAggFunc> = {};
            for (const entry of req.payload.funcs) {
              let fn: unknown;
              try {
                fn = new Function(`"use strict"; return (${entry.source});`)();
              } catch (err) {
                post({
                  id: req.id,
                  type: 'error',
                  error: `[cgrid] failed to deserialise aggFunc '${entry.name}': ${
                    String((err as Error).message ?? err)
                  }`,
                });
                return;
              }
              if (typeof fn !== 'function') {
                post({
                  id: req.id,
                  type: 'error',
                  error: `[cgrid] aggFunc '${entry.name}' did not deserialise to a function`,
                });
                return;
              }
              built[entry.name] = fn as IAggFunc;
            }
            state.aggFuncs.replaceCustom(built);
            post({
              id: req.id,
              type: 'rowCount',
              count: state.store.size(),
              visibleCount: state.visibleCache?.length ?? 0,
            });
            break;
          }

          case 'registerComparator': {
            // Cycle 8 / Task 3 — reconstruct the app's comparator from
            // its `Function.prototype.toString()` form via `new Function`.
            // Wrapping the source in `return ( ... )` lets the function be
            // either a `function` expression or an arrow — `new Function`
            // evaluates the expression and we capture the resulting
            // callable. Strict mode is enabled inside the wrapper so the
            // reconstructed function does not accidentally pick up sloppy
            // semantics from the worker's global scope.
            const { name, source } = req.payload;
            let fn: unknown;
            try {
              fn = new Function(`"use strict"; return (${source});`)();
            } catch (err) {
              post({
                id: req.id,
                type: 'error',
                error: `[cgrid] failed to deserialise comparator '${name}': ${
                  String((err as Error).message ?? err)
                }`,
              });
              break;
            }
            if (typeof fn !== 'function') {
              post({
                id: req.id,
                type: 'error',
                error: `[cgrid] comparator '${name}' did not deserialise to a function`,
              });
              break;
            }
            state.comparators.register(name, fn as (a: unknown, b: unknown) => number);
            post({
              id: req.id,
              type: 'rowCount',
              count: state.store.size(),
              visibleCount: state.visibleCache?.length ?? 0,
            });
            break;
          }

          case 'flashCells': {
            // Cycle 4 / Task 11 — programmatic flash. Resolves string
            // rowIds against the store (drops unknowns silently);
            // expands empty colIds to "every column with a field".
            // Stages into pendingFlashes; the next viewport reply
            // ships the flashMask bits.
            const { rowIds, colIds } = req.payload;
            const fields = colIds.length === 0
              ? state.columns.filter((c) => c.field).map((c) => c.field!)
              : (() => {
                  const out: string[] = [];
                  for (const colId of colIds) {
                    const col = state.columns.find((c) => c.colId === colId);
                    if (col?.field) out.push(col.field);
                  }
                  return out;
                })();
            for (const rowId of rowIds) {
              if (state.store.getById(rowId) === undefined) continue;
              const existing = state.pendingFlashes.get(rowId);
              if (existing) {
                for (const f of fields) existing.add(f);
              } else {
                state.pendingFlashes.set(rowId, new Set(fields));
              }
            }
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: state.visibleCache?.length ?? 0 });
            break;
          }

          case 'getDistinctValues': {
            // Cycle 7 / Task 9 — derive (or read the cached) distinct
            // stringified value set for `colId`. One-pass hash over
            // `store.rows()` per colId; cached until a transaction
            // invalidates. Backs the set-filter popup's checkbox list.
            const values = state.distinct.getValues(req.payload.colId);
            post({ id: req.id, type: 'distinctValuesResult', values });
            break;
          }

          case 'refilter': {
            // Cycle 7 / Task 8 — re-run the pipeline against the current
            // model without changing column / quick / sort state. Wired
            // to `api.onFilterChanged(source)` so apps can re-trigger
            // after mutating external-filter state (e.g. a toolbar
            // checkbox).
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await invalidateAndCount() });
            break;
          }

          case 'getRowIndexForId': {
            const ids = await visibleAsync();
            const idx = ids.indexOf(req.payload.rowId);
            post({ id: req.id, type: 'rowIndex', index: idx });
            break;
          }

          case 'getRowByIndex': {
            const ids = await visibleAsync();
            const { rowIndex } = req.payload;
            if (rowIndex < 0 || rowIndex >= ids.length) {
              post({ id: req.id, type: 'row', rowId: null, data: null });
              break;
            }
            const rowId = ids[rowIndex]!;
            const data = state.store.getById(rowId);
            post({ id: req.id, type: 'row', rowId, data: data ?? null });
            break;
          }

          case 'getRowIndicesForIds': {
            // Build a one-shot lookup table so an N-id batch is O(visible + N)
            // instead of O(visible * N). Critical when the selection set is
            // large (e.g. selectAll over a million rows).
            //
            // When grouping is active the painter uses localRowIndex which is
            // the GROUPED display position (group headers + leaf rows counted
            // together).  The flat visibleAsync() result only includes leaf
            // rows (indices 0..N-1), so leaf-row IDs would get wrong positions
            // and selection highlighting would misfire.  Build the lookup from
            // the in-order grouped display sequence instead.
            const lookup = new Map<string, number>();
            if (isGroupingActive() && state?.groupOutput && state.groupInputIds) {
              const groupInputIds = state.groupInputIds;
              const visibleOrder = computeGroupVisibleOrder(
                state.groupOutput.flatOrder,
                effectiveExpandedKeys(),
                state.groupHideOpenParents,
              );
              for (let i = 0; i < visibleOrder.length; i++) {
                const entry = visibleOrder[i]!;
                if (entry.kind === 'row') {
                  const id = groupInputIds[entry.rowIndex];
                  if (id !== undefined) lookup.set(id, i);
                }
              }
            } else {
              const ids = await visibleAsync();
              for (let i = 0; i < ids.length; i++) lookup.set(ids[i]!, i);
            }
            const requested = req.payload.rowIds;
            const out = new Int32Array(requested.length);
            for (let i = 0; i < requested.length; i++) {
              const idx = lookup.get(requested[i]!);
              out[i] = idx === undefined ? -1 : idx;
            }
            post({ id: req.id, type: 'rowIndices', indices: out }, [out.buffer]);
            break;
          }

          case 'getViewport': {
            const visIds = await visibleAsync();
            // Cycle 4 / Task 11 — pass pendingFlashes to the slicer so
            // it can pack the flashMask. Drain ONLY the cells the slice
            // actually emitted (drop rowId entries whose visible cells
            // were all covered by this chunk's columns + rowStart/rowEnd
            // window) — flashes for off-window rows persist until those
            // rows are visible.
            const pending = state.enableCellChangeFlash ? state.pendingFlashes : undefined;
            // Cycle 15 / Task 4 — when grouping is active, walk the
            // collapse-aware visible order and emit a group-aware
            // chunk so the auto-group column reads chevron + value +
            // count for every group row. When grouping bypasses
            // (`rowGroupCols.length === 0`), fall through to the flat
            // slicer — same shape as Cycle 4.
            let chunk;
            let visibleSliceIds: string[];
            let stickyAncestors: StickyAncestor[] | undefined;
            if (isGroupingActive()) {
              const groupOutput = state.groupOutput!;
              const expandedKeys = effectiveExpandedKeys();
              const visibleOrder: VisibleRowEntry[] = computeGroupVisibleOrder(
                groupOutput.flatOrder, expandedKeys, state.groupHideOpenParents,
              );
              const colIndex = new Map<string, WorkerColumn>();
              for (const c of state.columns) colIndex.set(c.colId, c);
              const metaLookup = buildGroupMetaLookup(groupOutput.roots, state.columns, expandedKeys);
              chunk = sliceGroupedViewport(
                state.store, colIndex, visIds, visibleOrder, req.payload, pending,
                (key) => metaLookup.get(key),
                state.showOpenedGroup,
              );
              // Cycle 15 / Task 16 — compute sticky ancestors from the
              // ordered group tree above firstRow (O(rowStart) scan).
              stickyAncestors = computeStickyAncestors(visibleOrder, chunk.rowStart, metaLookup);
              // For flash drain below, we need the rowIds at each
              // emitted slot. Group slots carry no rowId — only data
              // entries do. Build a per-slot rowId array here so the
              // flash drain works identically to the flat path.
              visibleSliceIds = new Array<string>(chunk.rowCount);
              for (let r = 0; r < chunk.rowCount; r++) {
                const entry = visibleOrder[chunk.rowStart + r];
                if (!entry || entry.kind !== 'row') { visibleSliceIds[r] = ''; continue; }
                visibleSliceIds[r] = visIds[entry.rowIndex] ?? '';
              }
            } else {
              chunk = state.slicer.slice(visIds, req.payload, pending);
              visibleSliceIds = visIds.slice(chunk.rowStart, chunk.rowStart + chunk.rowCount);
            }
            if (pending !== undefined && chunk.flashMask !== undefined) {
              // Drain: clear the (rowId, field) entries we just flashed.
              // For each visible row in the chunk window, remove the
              // fields that correspond to this request's columns.
              const s = state;
              const colFields = req.payload.columns
                .map((colId) => s.columns.find((c) => c.colId === colId)?.field)
                .filter((f): f is string => f !== undefined);
              for (let r = 0; r < chunk.rowCount; r++) {
                const rowId = visibleSliceIds[r];
                if (!rowId) continue;
                const set = pending.get(rowId);
                if (!set) continue;
                for (const f of colFields) set.delete(f);
                if (set.size === 0) pending.delete(rowId);
              }
            }
            // Wire AggPass: compute grand-total aggregations over all visible rows.
            const aggResult = state.agg.apply(visIds);
            if (Object.keys(aggResult.totals).length > 0) {
              chunk.totals = aggResult.totals;
            }
            // Cycle 15 / Task 12 — per-group totals. Computed only when
            // grouping is active AND `groupIncludeFooter` is on (the
            // GroupPass flag mirrors the worker init payload). Reuses
            // the `state.groupInputIds` snapshot captured by
            // `buildVisibleAsync` so the `GroupNode.childIndices` ↔
            // rowId mapping stays consistent with the tree shape the
            // slicer just walked. `applyGroups` returns an empty
            // record on the bypass path (grouping inactive) so the
            // guard here is purely a perf shortcut — skip the call
            // entirely when there's nothing to compute.
            if (
              isGroupingActive()
              && state.group.getIncludeFooter()
              && state.groupInputIds !== null
              && state.groupOutput !== null
            ) {
              const groupAggResult = state.agg.applyGroups(
                state.groupInputIds,
                state.groupOutput,
              );
              if (Object.keys(groupAggResult.groupTotals).length > 0) {
                chunk.groupTotals = groupAggResult.groupTotals;
              }
            }
            // Cycle 18 / Task 3 + Task 8d — pivot cross-tab. PivotPass now
            // runs INSIDE `buildVisibleAsync` (before SortPass) so a
            // pivot-result-column sort can re-order the row groups by
            // the aggregate value. The cached `state.pivotOut` is read
            // here and shipped on the chunk; output is sort-invariant
            // (keyed by group key strings, not node order) so caching
            // is safe across re-sorts.
            const pivotOut = state.pivotOut;
            if (pivotOut !== null) {
              if (!pivotOut.bypassed) {
                chunk.pivotColumnTree = pivotOut.keyTree;
                chunk.pivotLeafPaths = pivotOut.leafPaths;
                chunk.pivotValues = pivotOut.values;
              }
              if (pivotOut.maxColumnsReached !== undefined) {
                // Cycle 18 / Task 8a — surface the breach to the main thread
                // so the public `pivotMaxColumnsReached` event fires. The
                // pivot output is empty (bypassed) when this is set.
                chunk.pivotMaxColumnsReached = { ...pivotOut.maxColumnsReached };
              }
            }
            post(
              { id: req.id, type: 'viewport', chunk, stickyAncestors },
              collectViewportTransferables(chunk) as ArrayBuffer[],
            );
            // AutoHeight pass — runs out-of-band so the first chunk lands
            // fast; the heights settle one rAF later via a `heightsChanged`
            // push that main applies to the Fenwick index. Cycle 5 / Task 8.
            const rowStart = chunk.rowStart;
            const rowEnd = chunk.rowStart + chunk.rowCount;
            void runAutoHeightPass(visIds, rowStart, rowEnd);
            break;
          }

          case 'autosize': {
            // Cycle 6 / Task 4 — measure widest visible text per column.
            // Uses the existing measureCache LRU so a previously-measured
            // (font, text) re-uses the cached width even when the autosize
            // pass is invoked back-to-back. Without OffscreenCanvas the
            // measurer factory returns a measurer that yields text.length
            // pixels per character — a coarse fallback that still produces
            // monotonic results; the main-thread offers no synchronous
            // alternative so a more accurate fallback would block the
            // worker on a round-trip per cell.
            const { columns, skipHeader, maxSampleSize } = req.payload;
            const ids = await visibleAsync();
            const fieldByColId = new Map<string, string | undefined>();
            for (const c of state.columns) fieldByColId.set(c.colId, c.field);
            const measureFor = (font: string) => {
              const off = offscreenMeasurer(font);
              if (off) return off;
              // Fallback when OffscreenCanvas.measureText is unavailable —
              // approximate width using character count. Coarse but bounded;
              // the alternative (round-tripping to main for every cell)
              // would blow the per-cycle perf budget.
              return (s: string) => s.length * 7;
            };
            const specs: AutosizeColumnSpec[] = columns.map((c) => {
              const field = fieldByColId.get(c.colId);
              return {
                colId: c.colId,
                headerName: c.headerName,
                font: c.font,
                padding: c.padding,
                headerPadding: c.headerPadding,
                minWidth: c.minWidth,
                maxWidth: c.maxWidth,
                textOf: (rowIndex) => {
                  if (!field) return '';
                  const rowId = ids[rowIndex];
                  if (rowId === undefined) return '';
                  const row = state!.store.getById(rowId) as Record<string, unknown> | undefined;
                  if (!row) return '';
                  const raw = row[field];
                  return raw == null ? '' : String(raw);
                },
              };
            });
            const widthsMap = measureColumnWidths({
              cols: specs,
              rowCount: ids.length,
              skipHeader,
              measureFor,
              cache: state.measureCache,
              maxSampleSize,
            });
            const widths: Record<string, number> = {};
            for (const [colId, w] of widthsMap.entries()) widths[colId] = w;
            post({ id: req.id, type: 'autosizeResult', widths });
            break;
          }

          case 'measureTextResponse': {
            // Fallback path: main has measured the previously-batched items.
            // Resolve the waiting promise so `runAutoHeightPass` can continue.
            const { batchId, heights } = req.payload;
            const resolver = state.pendingFallbacks.get(batchId);
            if (resolver) {
              state.pendingFallbacks.delete(batchId);
              resolver(heights);
            }
            post({ id: req.id, type: 'measureTextAck' });
            break;
          }

          case 'clipboardDeserialize': {
            // Cycle 10 / Task 4 — TSV / CSV parse off the main thread.
            // `text` is the raw payload from `navigator.clipboard.readText`;
            // we hand back the parsed 2D array so the main thread can
            // anchor it at the focused cell and build a single
            // `applyTransaction({ update })`. The parse is a pure
            // state-machine walk (no Worker-side state to read), so no
            // pipeline awaits are needed before replying.
            const { text, delimiter } = req.payload;
            const rows = deserializeTsv(text, delimiter);
            post({ id: req.id, type: 'clipboardDeserializeResult', rows });
            break;
          }

          case 'clipboardSerialize': {
            // Cycle 10 / Task 3 — TSV / CSV encode the supplied ranges
            // off the main thread. Resolve `visIds` once so per-range
            // row lookups are O(1), then build a sparse `rows` array
            // covering only the rowStart..rowEnd bands actually
            // requested (avoids materialising the full visible set when
            // the user is copying a small range out of a 1M-row grid).
            const { ranges, delimiter } = req.payload;
            const visIds = await visibleAsync();
            const rows: Array<Record<string, unknown> | undefined> = [];
            for (const r of ranges) {
              const end = Math.min(r.rowEnd, visIds.length - 1);
              for (let i = r.rowStart; i <= end; i++) {
                if (i < 0) continue;
                if (rows[i] !== undefined) continue;
                const rowId = visIds[i];
                if (rowId === undefined) continue;
                const data = state.store.getById(rowId);
                if (data !== undefined) rows[i] = data as Record<string, unknown>;
              }
            }
            const colsById = new Map<string, { field?: string }>();
            for (const c of state.columns) colsById.set(c.colId, { field: c.field });
            const tsv = serializeRanges(rows, colsById, ranges, delimiter);
            post({ id: req.id, type: 'clipboardSerializeResult', tsv });
            break;
          }
        }
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
