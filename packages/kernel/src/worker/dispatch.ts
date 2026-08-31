// Cycle 19 / Task 6 — worker dispatch primitives.
//
// The worker used to embed a 900-line `switch (req.type)` inside a single
// `handleAsync` closure. This module exposes the seam that lets each
// domain (data pipeline, filter, sort, group, pivot, viewport service,
// clipboard, export) live in its own handler module while sharing the
// same worker-side state + post channel + helper closures.
//
// The dispatcher is fire-and-forget at the `onmessage` boundary. A
// per-handler try/catch inside `handleAsync` funnels any thrown error
// through the same `error` envelope every case used to reach for.
//
// `HandlerCtx` bundles:
//   • `state`        — the mutable `State` shared by every handler.
//   • `post`         — the reply / push channel back to main.
//   • `helpers`      — bound references to the helper closures worker.ts
//                      still owns (buildVisibleAsync, invalidateAndCount,
//                      isGroupingActive, currentGroupKeys, …). Handlers
//                      call these instead of re-implementing pipeline
//                      logic inline.
//
// Keeping the helpers in `worker.ts` (rather than moving each into its
// own module) means the seam preserves the invariance-critical closure
// over `state` — every helper reads / writes the same object the
// dispatcher passes down.

import type {
  WorkerRequest,
  WorkerResponse,
  WorkerPush,
  StickyAncestor,
  WorkerColumn,
} from './protocol';
import type { GroupNode } from './passes/groupPass';
import type { VisibleRowEntry } from './viewportSlicer';

export type Postable = WorkerResponse | WorkerPush;
export type PostFn = (msg: Postable, transfer?: ArrayBuffer[]) => void;

/** State the handlers mutate. Preserved as a plain-object interface so
 *  the property-access idiom the pre-extraction switch relied on
 *  (`state.store`, `state.filter`, …) stays valid. The concrete shape
 *  lives on `worker.ts` (imported into each handler via `HandlerCtx`). */
export type WorkerStateHandle = import('./workerState').State;

export interface AutoHeightCol {
  colId: string;
  field: string;
  font: string;
  width: number;
  lineHeight: number;
  padding: number;
}

/** Handler-facing view of the worker's helper closures. Each handler
 *  reaches into this bag to run the pipeline steps it needs — no
 *  handler re-implements pipeline logic inline. */
export interface WorkerHelpers {
  /** Union of column + quick filter survivors (pre-external filter). */
  buildCandidates(): string[];
  /** Ships `candidates` to main, awaits the `externalFilterResult`
   *  reply, resolves with the surviving rowIds. */
  runExternalFilter(candidates: string[]): Promise<string[]>;
  /** Full pipeline pass — quick + column + external filter → group →
   *  sort → pivot → alwaysPass rescue. Returns the current visible
   *  rowId order. Recomputes `state.groupOutput` + `state.pivotOut` +
   *  `state.groupInputIds` + `state.pivotInputIds` as side effects. */
  buildVisibleAsync(): Promise<string[]>;
  /** Post-sort round-trip. Ships `ids` to main, awaits
   *  `postSortRowsResult`, resolves with the re-ordered list. */
  runPostSortRows(ids: string[]): Promise<string[]>;
  /** Cached `buildVisibleAsync` — returns `state.visibleCache` when
   *  present. */
  visibleAsync(): Promise<string[]>;
  /** Race fix (HIGH) — resolves once no `buildVisibleAsync` pass is
   *  currently in flight (`state.visibleCachePromise` is null), looping
   *  in case a new build starts before this settles. `setGroupModel` /
   *  `setSortModel` / `setFilterModel` await this BEFORE mutating their
   *  pass object so a build already mid-read of group/sort/filter state
   *  never resumes into a hybrid stale/fresh pass. */
  awaitPipelineIdle(): Promise<void>;
  /** True when the most recent `buildVisibleAsync` produced a group
   *  tree the slicer should walk over. */
  isGroupingActive(): boolean;
  /** True when the most recent `PivotPass.apply` produced non-bypassed
   *  cross-tab output. */
  isPivotActive(): boolean;
  /** Effective expanded-keys set. Materialises the default-all sentinel
   *  from `groupOutput.flatOrder` when `state.expandedKeys` is null. */
  effectiveExpandedKeys(): Set<string>;
  /** Every composite group key in the current tree, flatOrder order. */
  currentGroupKeys(): string[];
  /** Per-key descendant leaf rowIds, parallel to `currentGroupKeys()`. */
  collectGroupDescendantRowIds(): string[][];
  /** Flatten the `GroupNode` tree into a `key → meta` lookup the slicer
   *  reads when packing the chunk's group-row slots. */
  buildGroupMetaLookup(
    roots: readonly GroupNode[],
    columns: readonly WorkerColumn[],
    expandedKeys: ReadonlySet<string>,
  ): Map<string, { value: string; childCount: number; isExpanded: boolean; colId: string }>;
  /** Sticky ancestor band above `rowStart`. Walks `visibleOrder[0..rowStart)`. */
  computeStickyAncestors(
    visibleOrder: readonly VisibleRowEntry[],
    rowStart: number,
    metaLookup: ReadonlyMap<string, { value: string; childCount: number; isExpanded: boolean; colId: string }>,
  ): StickyAncestor[];
  /** Rebuild `state.visibleCache` then return `visibleCount` (row count
   *  after grouping expansion is applied). */
  invalidateAndCount(): Promise<number>;
  /** Recount after an expansion change only — reuses the built group tree
   *  instead of re-running the pipeline. See worker.ts. */
  countAfterExpansionChange(): Promise<number>;
  /** Diff `updates` against the pre-apply store and stage per-row-field
   *  flashes into `state.pendingFlashes`. */
  stageFlashesForUpdates(updates: unknown[]): void;
  /** Columns eligible for the autoHeight pass (variable-height cells). */
  autoHeightCols(): AutoHeightCol[];
  /** Out-of-band autoHeight measurement pass. Fires `heightsChanged`
   *  when any measured height differs from the current row-height
   *  index. Fire-and-forget from the viewport reply site. */
  runAutoHeightPass(
    visIds: string[],
    rowStartArg: number,
    rowEndArg: number,
  ): Promise<void>;
}

/** Everything a handler needs from the worker-host closure. Passed to
 *  every dispatched handler as its first argument. */
export interface HandlerCtx {
  state: WorkerStateHandle;
  post: PostFn;
  helpers: WorkerHelpers;
}

/** Generic handler shape. `T` narrows to the specific request variant
 *  each handler cares about — the dispatcher looks up the handler by
 *  `req.type` so the narrowing is safe at call-time. */
export type Handler<T extends WorkerRequest = WorkerRequest> = (
  ctx: HandlerCtx,
  req: T,
) => Promise<void> | void;

/** Dispatch table type. Keys are `WorkerRequest['type']` values (except
 *  `'init'` which is handled by `worker.ts` directly before the
 *  dispatcher runs). Values are the corresponding handler function. */
export type DispatchTable = {
  [K in Exclude<WorkerRequest['type'], 'init'>]: Handler<Extract<WorkerRequest, { type: K }>>;
};

// ── Domain handler imports ──────────────────────────────────────────────────
import { handleDataPipeline } from './handlers/dataPipeline';
import { handleFilter } from './handlers/filter';
import { handleGroup } from './handlers/group';
import { handlePivot } from './handlers/pivot';
import { handleViewport } from './handlers/viewport';
import { handleClipboard } from './handlers/clipboard';
import { handleExport } from './handlers/export';

/** Static dispatch table wiring each `WorkerRequest['type']` to the
 *  domain handler that owns it. `init` is handled by `worker.ts` before
 *  the dispatcher runs (see `handleAsync` there). Every other
 *  request type routes to exactly one handler here.
 *
 *  Each entry casts through `Handler` so the domain function's narrower
 *  request-union parameter stays compatible with the dispatch table's
 *  wide type — the dispatcher looks up by `req.type` and passes the
 *  narrowed request through, so the narrowing is safe at call-time. */
export const dispatchTable: DispatchTable = {
  // ── Data pipeline domain ──────────────────────────────────────────────────
  setRowData: handleDataPipeline as Handler,
  ssrmHydrate: handleDataPipeline as Handler,
  ssrmEvict: handleDataPipeline as Handler,
  ssrmSetClientPipeline: handleDataPipeline as Handler,
  ssrmSetGrandTotals: handleDataPipeline as Handler,
  ssrmSetPivotResult: handleDataPipeline as Handler,
  applyTransaction: handleDataPipeline as Handler,
  updateColumns: handleDataPipeline as Handler,
  setEnableCellChangeFlash: handleDataPipeline as Handler,
  setAsyncTransactionOptions: handleDataPipeline as Handler,
  flushAsyncTransactions: handleDataPipeline as Handler,
  flashCells: handleDataPipeline as Handler,
  setAggFuncs: handleDataPipeline as Handler,
  setCalcProgram: handleDataPipeline as Handler,
  registerComparator: handleDataPipeline as Handler,
  setSortModel: handleDataPipeline as Handler,
  setPostSortRowsPresent: handleDataPipeline as Handler,
  postSortRowsResult: handleDataPipeline as Handler,

  // ── Filter domain ─────────────────────────────────────────────────────────
  setFilterModel: handleFilter as Handler,
  setQuickFilter: handleFilter as Handler,
  setExternalFilterPresent: handleFilter as Handler,
  setAlwaysPassRowIds: handleFilter as Handler,
  externalFilterResult: handleFilter as Handler,
  refilter: handleFilter as Handler,
  getDistinctValues: handleFilter as Handler,

  // ── Group domain ──────────────────────────────────────────────────────────
  setGroupModel: handleGroup as Handler,
  setExpandedKeys: handleGroup as Handler,
  setEmitGroupDescendants: handleGroup as Handler,

  // ── Pivot domain ──────────────────────────────────────────────────────────
  setStrictPivotColumnOrder: handlePivot as Handler,
  setPivotMaxGeneratedColumns: handlePivot as Handler,
  setPivotModel: handlePivot as Handler,

  // ── Viewport service domain ───────────────────────────────────────────────
  getViewport: handleViewport as Handler,
  getRowIndexForId: handleViewport as Handler,
  getRowByIndex: handleViewport as Handler,
  getRowIndicesForIds: handleViewport as Handler,
  autosize: handleViewport as Handler,
  autosizeSample: handleViewport as Handler,
  measureTextResponse: handleViewport as Handler,

  // ── Clipboard domain ──────────────────────────────────────────────────────
  clipboardDeserialize: handleClipboard as Handler,
  clipboardSerialize: handleClipboard as Handler,

  // ── Export domain ─────────────────────────────────────────────────────────
  exportData: handleExport as Handler,
  getExportRows: handleExport as Handler,
} as DispatchTable;
