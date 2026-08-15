// Cycle 19 / Task 3 — owns the worker-coordination subsystem extracted from
// VelocityGrid: the WorkerClient instance + its handler wiring, the viewport-fetch
// dispatch that ViewportManager forwards into (Task 2 deliberately left this
// in VelocityGrid as `handleViewportChunk` — Task 3 absorbs the worker-call half
// here and surfaces the main-side chunk-reply mutation as the
// `onViewportChunk` deps callback), and the worker-side method surface
// (setRowData / applyTransaction / setSortModel / … pure pass-throughs).
//
// VelocityGrid is the thin consumer: `this.workerCoord.requestViewport(...)` for
// the viewport seam, `this.workerCoord.applyTransaction(...)` for the
// transaction queue interface, and the various model setters reach the
// worker through this surface. Methods whose worker call is wrapped in
// significant main-side logic (resolving heightsByRowId, updating the
// rowDataById cache, recomputeAlwaysPass, recomputeViewport, persistent
// selection rebuilds) stay in VelocityGrid and call into the coordinator only
// for the worker-side bit.
//
// The async-batch flushing timer (`asyncTransactionWaitMillis` /
// conflate / throttle) lives inside the worker `TransactionQueue`.
// `flushAsyncTransactions()` force-drains that queue.

import type { WorkerLike, WorkerClientHandlers } from '../worker/client';
import { WorkerClient } from '../worker/client';
import type {
  WorkerColumn, WorkerInitPayload, ViewportChunk, AutosizeColumnRequest,
  MeasureTextItem, StickyAncestor, WorkerCalcProgram,
} from '../worker/protocol';
import type {
  TransactionResult, SortModel, FilterModel, GroupModel, SelectionRange,
} from '../types';
import type { PivotModel } from '../worker/passes/pivotPass';

export interface WorkerCoordinatorDeps {
  /** Worker pushed a `modelUpdated` (sync transaction, async-tx flush, set
   *  model swap, etc.). `groupKeys` is present when grouping is active so
   *  VelocityGrid's `expandedKeys` mirror stays in lockstep. */
  onModelUpdated(visibleCount: number, groupKeys?: string[], expandedKeys?: string[] | null): void;
  /** Worker flushed a batch of async transactions; `results` carries one
   *  TransactionResult per buffered `applyTransactionAsync` call. */
  onAsyncTransactionsFlushed(results: TransactionResult[]): void;
  /** Worker measured a chunk of autoHeight rows; main updates the Fenwick
   *  index + chunk.heights mirror. `rowStart` is the global visible-row
   *  index of `heights[0]`. */
  onHeightsChanged(rowStart: number, heights: Float32Array): void;
  /** Worker is asking main to run `measureText` for a batch of items
   *  (Safari 15.4–16.3 + Firefox 100–104 fallback when OffscreenCanvas
   *  measureText is unavailable). Reply via `measureTextResponse`. */
  onMeasureTextRequest(batchId: number, items: MeasureTextItem[]): void;
  /** Worker reached the external-filter step and is shipping candidate
   *  rowIds for `options.doesExternalFilterPass` evaluation. Reply via
   *  `externalFilterResult(callId, surviving)`. */
  onExternalFilterCandidates(rowIds: string[], callId: number): void;
  /** Worker reached the post-sort step and is shipping the SortPass'd
   *  rowId order for `options.postSortRows` evaluation. Reply via
   *  `postSortRowsResult(callId, reordered)`. */
  onPostSortRowsCandidates(rowIds: string[], callId: number): void;
  /** A-L1 (production hardening) — worker-level error surface: a genuine
   *  `error` / `messageerror` event from the underlying Worker, or an
   *  `init()` watchdog trip. Logged by VelocityGrid as
   *  `[velocity-grid] worker error: …`. Previously dead wiring — nothing
   *  ever invoked this. */
  onError(error: Error, context: 'error' | 'messageerror' | 'init-timeout'): void;

  /** Main-side chunk-reply handler — invoked after every successful
   *  `getViewport` round-trip the coordinator dispatched on behalf of
   *  ViewportManager. VelocityGrid does the column-state sync (pivot column
   *  materialisation), flash registry ingest, row-height index refresh,
   *  recomputeViewport + repaint, a11y refresh, `aggregationChanged`
   *  emission, and the `firstDataRendered` latch here.
   *
   *  Returned Promise is awaited by `ViewportManager.request` so the
   *  coalescing flag releases AFTER main-side mutation lands.
   *  Synchronous side effects are fine — the wrapper resolves
   *  immediately in that case. */
  onViewportChunk(
    opts: { rowStart: number; rowEnd: number; columns: string[] },
    chunk: ViewportChunk,
    stickyAncestors: StickyAncestor[],
  ): void | Promise<void>;

  /** Destroy guard — coordinator skips its `console.error` of a late
   *  worker rejection when VelocityGrid is already torn down. */
  isDestroyed(): boolean;
}

export class WorkerCoordinator {
  private client: WorkerClient;

  constructor(worker: WorkerLike, deps: WorkerCoordinatorDeps) {
    this.deps = deps;
    // Wire the worker handlers through VelocityGrid's deps. The arrow functions
    // capture `this.deps` not the closure-bound `deps` so a future swap (not
    // currently exposed) would light up; in practice deps is constructed
    // once per VelocityGrid and lives for the grid's lifetime.
    const handlers: WorkerClientHandlers = {
      onModelUpdated: (vc, gk, ek) => this.deps.onModelUpdated(vc, gk, ek),
      onAsyncTransactionsFlushed: (results) => this.deps.onAsyncTransactionsFlushed(results),
      onHeightsChanged: (rowStart, heights) => this.deps.onHeightsChanged(rowStart, heights),
      onMeasureTextRequest: (batchId, items) => this.deps.onMeasureTextRequest(batchId, items),
      onExternalFilterCandidates: (rowIds, callId) => this.deps.onExternalFilterCandidates(rowIds, callId),
      onPostSortRowsCandidates: (rowIds, callId) => this.deps.onPostSortRowsCandidates(rowIds, callId),
      onError: (err, context) => this.deps.onError(err, context),
    };
    this.client = new WorkerClient(worker, handlers);
  }

  /** Public read access to the underlying WorkerClient. Reserved for the
   *  short list of integration tests / debug surfaces that need the raw
   *  handle — production code routes through the coordinator surface. */
  get workerClient(): WorkerClient { return this.client; }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init(payload: WorkerInitPayload): Promise<void> {
    return this.client.init(payload);
  }

  destroy(): void {
    this.client.destroy();
  }

  // ── Viewport dispatch ────────────────────────────────────────────────────

  /** Fire `getViewport` for the velocity-expanded range ViewportManager
   *  computed and hand the resolved chunk + stickyAncestors back to VelocityGrid
   *  via `deps.onViewportChunk`. Returned Promise resolves AFTER the
   *  main-side mutation in `onViewportChunk` settles so ViewportManager's
   *  coalescing flag releases at the right moment.
   *
   *  `includeFlashMask: true` is set unconditionally — the worker only
   *  packs a mask when `enableCellChangeFlash` is on AND there are
   *  pending flash diffs, so the additional payload cost is zero when
   *  the feature is off. */
  async dispatchViewportRequest(opts: {
    rowStart: number;
    rowEnd: number;
    columns: string[];
    stickyBoundaryRow: number;
  }): Promise<void> {
    const { chunk, stickyAncestors } = await this.client.getViewport({
      rowStart: opts.rowStart, rowEnd: opts.rowEnd, columns: opts.columns,
      stickyBoundaryRow: opts.stickyBoundaryRow,
      includeFlashMask: true,
    });
    await this.deps.onViewportChunk(opts, chunk, stickyAncestors ?? []);
  }

  // ── Transaction surface ──────────────────────────────────────────────────

  /** Force-drain the worker async transaction queue (ignores throttle). */
  flushAsyncTransactions(): void {
    void this.client.flushAsyncTransactions();
  }

  setAsyncTransactionOptions(opts: {
    waitMillis?: number;
    conflate?: boolean;
    throttleMillis?: number;
  }): Promise<void> {
    return this.client.setAsyncTransactionOptions(opts);
  }

  setRowData(
    rows: unknown[], heightsByRowId?: Map<string, number>,
  ): Promise<{ count: number; visibleCount: number; groupKeys?: string[]; expandedKeys?: string[] | null }> {
    return this.client.setRowData(rows, heightsByRowId);
  }

  ssrmHydrate(payload: {
    rowCount: number;
    startRow: number;
    rows: unknown[];
    reset?: boolean;
  }): Promise<{ count: number; visibleCount: number }> {
    return this.client.ssrmHydrate(payload);
  }

  /** B-L2 — propagate an SSRM v2 LRU eviction into the worker store. */
  ssrmEvict(rowIds: string[]): Promise<{ count: number; visibleCount: number }> {
    return this.client.ssrmEvict(rowIds);
  }

  ssrmSetClientPipeline(enabled: boolean): Promise<{ count: number; visibleCount: number; groupKeys?: string[]; expandedKeys?: string[] | null }> {
    return this.client.ssrmSetClientPipeline(enabled);
  }

  /** Sparse SSRM v2 — host-computed grand totals (field-keyed; null clears). */
  ssrmSetGrandTotals(totals: Record<string, unknown> | null): Promise<{ count: number; visibleCount: number }> {
    return this.client.ssrmSetGrandTotals(totals);
  }

  applyTransaction(payload: {
    add?: unknown[]; update?: unknown[]; remove?: string[];
    async: boolean; heightsByRowId?: Map<string, number>;
  }): Promise<TransactionResult> {
    return this.client.applyTransaction(payload);
  }

  // ── Pure pass-throughs (worker-only state) ───────────────────────────────

  setSortModel(s: SortModel): Promise<{ visibleCount: number }> {
    return this.client.setSortModel(s);
  }

  setFilterModel(f: FilterModel): Promise<{ visibleCount: number }> {
    return this.client.setFilterModel(f);
  }

  setGroupModel(g: GroupModel): Promise<{
    visibleCount: number;
    groupKeys: string[];
    groupDescendants: string[][];
    expandedKeys: string[] | null;
  }> {
    return this.client.setGroupModel(g);
  }

  setPivotModel(model: PivotModel): Promise<{ visibleCount: number }> {
    return this.client.setPivotModel(model);
  }

  setPivotMaxGeneratedColumns(cap: number | undefined): Promise<{ visibleCount: number }> {
    return this.client.setPivotMaxGeneratedColumns(cap);
  }

  setStrictPivotColumnOrder(strict: boolean): Promise<{ visibleCount: number }> {
    return this.client.setStrictPivotColumnOrder(strict);
  }

  setExpandedKeys(keys: string[] | null): Promise<{
    visibleCount: number; groupKeys: string[]; groupDescendants: string[][];
  }> {
    return this.client.setExpandedKeys(keys);
  }

  setEmitGroupDescendants(enabled: boolean): Promise<{
    visibleCount: number; groupKeys: string[]; groupDescendants: string[][];
  }> {
    return this.client.setEmitGroupDescendants(enabled);
  }

  setExternalFilterPresent(present: boolean): Promise<{ visibleCount: number }> {
    return this.client.setExternalFilterPresent(present);
  }

  setAlwaysPassRowIds(rowIds: string[]): Promise<{ visibleCount: number }> {
    return this.client.setAlwaysPassRowIds(rowIds);
  }

  externalFilterResult(callId: number, surviving: string[]): Promise<void> {
    return this.client.externalFilterResult(callId, surviving);
  }

  setPostSortRowsPresent(present: boolean): Promise<{ visibleCount: number }> {
    return this.client.setPostSortRowsPresent(present);
  }

  postSortRowsResult(callId: number, reordered: string[]): Promise<void> {
    return this.client.postSortRowsResult(callId, reordered);
  }

  setQuickFilter(payload: {
    terms: string[] | null; cacheQuickFilter: boolean; colIds: string[] | null;
  }): Promise<{ visibleCount: number }> {
    return this.client.setQuickFilter(payload);
  }

  setEnableCellChangeFlash(enabled: boolean): Promise<void> {
    return this.client.setEnableCellChangeFlash(enabled);
  }

  setAggFuncs(funcs: Array<{ name: string; source: string }>): Promise<void> {
    return this.client.setAggFuncs(funcs);
  }

  /** Cycle 21d / Task 10 — install / replace / remove (null) the worker's
   *  calc program. Passthrough to WorkerClient.setCalcProgram. */
  setCalcProgram(program: WorkerCalcProgram | null): Promise<void> {
    return this.client.setCalcProgram(program);
  }

  updateColumns(columns: WorkerColumn[]): Promise<{ visibleCount: number }> {
    return this.client.updateColumns(columns);
  }

  flashCells(rowIds: string[], colIds: string[]): Promise<void> {
    return this.client.flashCells(rowIds, colIds);
  }

  registerComparator(name: string, source: string): Promise<void> {
    return this.client.registerComparator(name, source);
  }

  getDistinctValues(colId: string, limit?: number): Promise<string[]> {
    return this.client.getDistinctValues(colId, limit);
  }

  getRowIndexForId(rowId: string): Promise<number> {
    return this.client.getRowIndexForId(rowId);
  }

  getRowIndicesForIds(rowIds: string[]): Promise<Int32Array> {
    return this.client.getRowIndicesForIds(rowIds);
  }

  getRowByIndex(rowIndex: number): Promise<{ rowId: string | null; data: unknown | null }> {
    return this.client.getRowByIndex(rowIndex);
  }

  autosizeColumns(
    columns: AutosizeColumnRequest[], skipHeader: boolean, maxSampleSize?: number,
  ): Promise<Record<string, number>> {
    return this.client.autosizeColumns(columns, skipHeader, maxSampleSize);
  }

  autosizeSampleValues(
    colIds: string[], maxSampleSize?: number,
  ): Promise<{ values: Record<string, unknown[]>; rowCount: number }> {
    return this.client.autosizeSampleValues(colIds, maxSampleSize);
  }

  clipboardSerialize(ranges: SelectionRange[], delimiter: string): Promise<string> {
    return this.client.clipboardSerialize(ranges, delimiter);
  }

  clipboardDeserialize(text: string, delimiter: string): Promise<string[][]> {
    return this.client.clipboardDeserialize(text, delimiter);
  }

  exportData(payload: {
    format: 'csv' | 'xlsx';
    headerNames: Record<string, string>;
    types: Record<string, 'text' | 'number'>;
    options: Record<string, unknown>;
    selectedRowIds?: string[];
  }): Promise<ArrayBuffer> {
    return this.client.exportData(payload);
  }

  getExportRows(payload: { selectedRowIds?: string[] } = {}): Promise<Array<Record<string, unknown>>> {
    return this.client.getExportRows(payload);
  }

  measureTextResponse(batchId: number, heights: Float32Array): Promise<void> {
    return this.client.measureTextResponse(batchId, heights);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private deps: WorkerCoordinatorDeps;
}

// Re-export the shapes external callers need so they can be imported through
// the coordinator module without reaching into ../worker/*. Keeps velocityGrid.ts'
// worker-protocol import surface narrow.
export type { WorkerLike } from '../worker/client';
