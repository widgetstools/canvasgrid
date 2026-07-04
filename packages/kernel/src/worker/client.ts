import type {
  WorkerRequest, WorkerResponse, WorkerPush, WorkerInitPayload, ViewportRequest, ViewportChunk,
  WorkerColumn, MeasureTextItem, AutosizeColumnRequest, StickyAncestor, WorkerCalcProgram,
} from './protocol';
import { normalizeViewportChunk } from './protocol';
export type { StickyAncestor };
import type { TransactionResult, SortModel, FilterModel, GroupModel, SelectionRange } from '../types';
import type { PivotModel } from './passes/pivotPass';

export interface WorkerClientHandlers {
  /** Cycle 15 / Task 7 — `groupKeys` is present when grouping is
   *  active; carries the current composite-key set so main's mirror
   *  for `getExpandedKeys()` stays in lockstep through transactions
   *  that add / remove groups. Absent under ungrouped grids — main
   *  ignores it on the cheap path. */
  onModelUpdated: (visibleCount: number, groupKeys?: string[]) => void;
  onAsyncTransactionsFlushed: (results: TransactionResult[]) => void;
  onError: (error: string) => void;
  /** Cycle 5 / Task 8 — worker has measured a chunk of autoHeight rows and
   *  is shipping back the updated per-row heights for the Fenwick index.
   *  `rowStart` is the global visible-row index of `heights[0]`. */
  onHeightsChanged?: (rowStart: number, heights: Float32Array) => void;
  /** Cycle 5 / Task 8 — main-thread fallback for `OffscreenCanvas.measureText`.
   *  Main runs the wrap algorithm against a real `<canvas>` context and posts
   *  back via `WorkerClient.measureTextResponse(batchId, heights)`. */
  onMeasureTextRequest?: (batchId: number, items: MeasureTextItem[]) => void;
  /** Cycle 7 / Task 8 — worker has reached the external-filter step of its
   *  pipeline and is shipping the candidate rowIds (post-column-filter,
   *  post-quick-filter, minus alwaysPass rows) up for the main thread to
   *  evaluate against `options.doesExternalFilterPass`. Reply with the
   *  surviving subset via `WorkerClient.externalFilterResult(callId, surviving)`.
   *  The worker holds the rest of the pipeline open on `callId` until the
   *  result lands; firing twice with different callIds is OK (each pipeline
   *  request gets its own callId). */
  onExternalFilterCandidates?: (rowIds: string[], callId: number) => void;
  /** Cycle 8 / Task 4 — worker has reached the post-sort step and is
   *  shipping the post-`SortPass` rowId order up for the main thread to
   *  feed through `options.postSortRows`. Reply with the (possibly
   *  re-ordered) rowId array via
   *  `WorkerClient.postSortRowsResult(callId, reordered)`. The worker
   *  holds the rest of the pipeline open on `callId` until the result
   *  lands. */
  onPostSortRowsCandidates?: (rowIds: string[], callId: number) => void;
}

export interface WorkerLike {
  postMessage(msg: unknown, transfer?: ArrayBuffer[]): void;
  addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
  /** Optional — when present, WorkerClient.destroy() removes the message
   *  listener before terminate(). Real Web Workers expose it; test mocks
   *  may omit it (the listener closure is GC'd with the mock anyway). */
  removeEventListener?(type: 'message', cb: (e: { data: unknown }) => void): void;
  terminate(): void;
}

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; }

export class WorkerClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  // Cycle 25 / Task 9 — push coalescing. Multiple modelUpdated /
  // heightsChanged / asyncTransactionsFlushed messages that arrive
  // inside one RAF window are collapsed into one downstream dispatch:
  //  • modelUpdated: latest visibleCount + groupKeys wins
  //  • heightsChanged: appended in order (each range is distinct)
  //  • asyncTransactionsFlushed: results lists concatenated
  // Request-bearing pushes (measureTextRequest, externalFilterCandidates,
  // postSortRowsRequest) bypass the queue — the worker is awaiting a
  // synchronous reply on their callId/batchId.
  private flushScheduled = false;
  private pendingModelUpdated: { visibleCount: number; groupKeys?: string[] } | null = null;
  private pendingHeights: Array<{ rowStart: number; heights: Float32Array }> = [];
  private pendingTxnResults: TransactionResult[] = [];
  private destroyed = false;
  private readonly messageHandler: (e: { data: unknown }) => void;

  constructor(private worker: WorkerLike, private handlers: WorkerClientHandlers) {
    this.messageHandler = (e) => {
      if (this.destroyed) return;
      this.onMessage(e.data as WorkerResponse | WorkerPush);
    };
    worker.addEventListener('message', this.messageHandler);
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: () => void) => queueMicrotask(cb);
    raf(() => this.flushPushQueue());
  }

  private flushPushQueue(): void {
    this.flushScheduled = false;
    // Late-arriving RAF after destroy() — pending queues were already
    // cleared, but bail explicitly so we don't dispatch into stale handlers.
    if (this.destroyed) return;
    const model = this.pendingModelUpdated;
    const heights = this.pendingHeights;
    const txn = this.pendingTxnResults;
    this.pendingModelUpdated = null;
    this.pendingHeights = [];
    this.pendingTxnResults = [];
    if (model) this.handlers.onModelUpdated(model.visibleCount, model.groupKeys);
    if (heights.length) {
      const cb = this.handlers.onHeightsChanged;
      if (cb) for (const h of heights) cb(h.rowStart, h.heights);
    }
    if (txn.length) this.handlers.onAsyncTransactionsFlushed(txn);
  }

  private onMessage(msg: WorkerResponse | WorkerPush): void {
    if ('id' in msg) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.type === 'error') pending.reject(new Error(msg.error));
      else                       pending.resolve(msg);
      return;
    }
    if (msg.type === 'modelUpdated') {
      this.pendingModelUpdated = { visibleCount: msg.visibleCount, groupKeys: msg.groupKeys };
      this.scheduleFlush();
    } else if (msg.type === 'asyncTransactionsFlushed') {
      for (const r of msg.results) this.pendingTxnResults.push(r);
      this.scheduleFlush();
    } else if (msg.type === 'heightsChanged') {
      this.pendingHeights.push({ rowStart: msg.rowStart, heights: msg.heights });
      this.scheduleFlush();
    } else if (msg.type === 'measureTextRequest') {
      this.handlers.onMeasureTextRequest?.(msg.batchId, msg.items);
    } else if (msg.type === 'externalFilterCandidates') {
      this.handlers.onExternalFilterCandidates?.(msg.rowIds, msg.callId);
    } else if (msg.type === 'postSortRowsRequest') {
      this.handlers.onPostSortRowsCandidates?.(msg.rowIds, msg.callId);
    }
  }

  /** Cycle 5 / Task 8 — return main-thread measureText results to the
   *  worker. Sends transferables for the heights array to avoid a copy. */
  measureTextResponse(batchId: number, heights: Float32Array): Promise<void> {
    const id = this.nextId++;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(), reject });
      this.worker.postMessage(
        { id, type: 'measureTextResponse', payload: { batchId, heights } },
        [heights.buffer as ArrayBuffer],
      );
    });
  }

  private send<T>(req: Omit<WorkerRequest, 'id'>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject });
      this.worker.postMessage({ ...req, id });
    });
  }

  init(payload: WorkerInitPayload): Promise<void> {
    return this.send<{ type: 'ready' }>({ type: 'init', payload }).then(() => {});
  }

  setRowData(rows: unknown[], heightsByRowId?: Map<string, number>): Promise<{ count: number; visibleCount: number; groupKeys?: string[] }> {
    return this.send<{ count: number; visibleCount: number; groupKeys?: string[] }>({
      type: 'setRowData', payload: { rows, heightsByRowId },
    });
  }

  applyTransaction(payload: {
    add?: unknown[]; update?: unknown[]; remove?: string[];
    async: boolean; heightsByRowId?: Map<string, number>;
  }): Promise<TransactionResult> {
    return this.send<{ results: TransactionResult }>({ type: 'applyTransaction', payload })
      .then((r) => r.results);
  }

  setSortModel(s: SortModel): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({ type: 'setSortModel', payload: s });
  }

  setFilterModel(f: FilterModel): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({ type: 'setFilterModel', payload: f });
  }

  /** Cycle 15 / Task 1 — replace the worker's row-group model. The
   *  worker re-runs the pipeline (filter → group → sort) and resolves
   *  with the new visible row count. Unknown / duplicate colIds in
   *  `rowGroupCols` are rejected by the worker and surface as a
   *  rejected promise.
   *
   *  Cycle 15 / Task 7 — also resolves with `groupKeys`: the list of
   *  every composite group key in the new tree so the main-side
   *  mirror can materialise its `expandedKeys` snapshot for
   *  `getExpandedKeys()`. Empty when grouping bypasses
   *  (`rowGroupCols.length === 0`).
   *
   *  Cycle 15 / Task 9 — `expandedKeys` carries the materialised
   *  starting set the worker installed under
   *  `groupDefaultExpanded` / `groupDefaultExpandedKeys`. `null`
   *  means "the worker is at the default-all sentinel" (option
   *  absent OR `'all'` AND no explicit keys override) — main treats
   *  it as the existing all-expanded mirror state. */
  setGroupModel(g: GroupModel): Promise<{
    visibleCount: number;
    groupKeys: string[];
    groupDescendants: string[][];
    expandedKeys: string[] | null;
  }> {
    return this.send<{
      visibleCount: number;
      groupKeys?: string[];
      groupDescendants?: string[][];
      expandedKeys?: string[] | null;
    }>({
      type: 'setGroupModel', payload: g,
    }).then((r) => ({
      visibleCount: r.visibleCount,
      groupKeys: r.groupKeys ?? [],
      groupDescendants: r.groupDescendants ?? [],
      expandedKeys: r.expandedKeys ?? null,
    }));
  }

  /** Cycle 18 / Task 3 — install / replace the worker's pivot model.
   *  The worker re-runs `PivotPass` on the next `getViewport`; an empty
   *  model deactivates pivot. Unknown / fieldless colIds surface as a
   *  rejected promise (mirrors `setGroupModel`). Resolves with the
   *  current visible row count (pivot does not change row visibility). */
  setPivotModel(model: PivotModel): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({ type: 'setPivotModel', payload: model });
  }

  /** Cycle 18 / Task 8a — set the cap on the synthesized pivot column
   *  count. `undefined` reverts to the default (5000). The cap is
   *  enforced inside `PivotPass.apply`; if exceeded, the chunk carries
   *  `pivotMaxColumnsReached` and pivot output is empty (bypassed). */
  setPivotMaxGeneratedColumns(cap: number | undefined): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({
      type: 'setPivotMaxGeneratedColumns',
      payload: cap,
    });
  }

  /** Cycle 18 / Task 8c — flip the strict-order flag. `true` =
   *  always re-sort alphanumerically. `false` (AG default) =
   *  preserve prior order + append new keys at the end. */
  setStrictPivotColumnOrder(strict: boolean): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({
      type: 'setStrictPivotColumnOrder',
      payload: strict,
    });
  }

  /** Cycle 15 / Task 7 — replace the worker's persistent expanded-keys
   *  set. `keys === null` reverts to the all-expanded default; an
   *  empty array collapses everything; any other array is the
   *  explicit set. Resolves with the post-set visible row count AND
   *  the full list of current composite group keys so the main-side
   *  mirror can materialise / refresh its snapshot.
   *
   *  Cycle 15 / Task 8 — also returns `groupDescendants` (parallel to
   *  `groupKeys`) when the worker has been switched to emit them via
   *  `setEmitGroupDescendants(true)`. Empty array when descendant
   *  emission is off. */
  setExpandedKeys(keys: string[] | null): Promise<{
    visibleCount: number;
    groupKeys: string[];
    groupDescendants: string[][];
  }> {
    return this.send<{ visibleCount: number; groupKeys?: string[]; groupDescendants?: string[][] }>({
      type: 'setExpandedKeys', payload: { keys },
    }).then((r) => ({
      visibleCount: r.visibleCount,
      groupKeys: r.groupKeys ?? [],
      groupDescendants: r.groupDescendants ?? [],
    }));
  }

  /** Cycle 15 / Task 8 — flip the worker's per-snapshot descendant
   *  emission. When `enabled: true`, every subsequent
   *  `groupKeysSnapshot` reply carries `groupDescendants: string[][]`
   *  parallel to `groupKeys` so main can populate the
   *  `GroupMembershipResolver` for tri-state selection. Resolves with
   *  a fresh snapshot so the toggle-on call itself primes the cache. */
  setEmitGroupDescendants(enabled: boolean): Promise<{
    visibleCount: number;
    groupKeys: string[];
    groupDescendants: string[][];
  }> {
    return this.send<{ visibleCount: number; groupKeys?: string[]; groupDescendants?: string[][] }>({
      type: 'setEmitGroupDescendants', payload: { enabled },
    }).then((r) => ({
      visibleCount: r.visibleCount,
      groupKeys: r.groupKeys ?? [],
      groupDescendants: r.groupDescendants ?? [],
    }));
  }

  /** Cycle 7 / Task 8 — toggle the external-filter round-trip. When
   *  `present: true`, every subsequent pipeline pass (setFilterModel,
   *  setQuickFilter, applyTransaction, refilter, …) pauses between
   *  column+quick filters and sort to push candidate rowIds to main via
   *  `onExternalFilterCandidates` and waits for `externalFilterResult`
   *  to deliver the survivors. Resolves with the post-toggle visible
   *  row count. */
  setExternalFilterPresent(present: boolean): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({
      type: 'setExternalFilterPresent', payload: { present },
    });
  }

  /** Cycle 7 / Task 8 — replace the worker's alwaysPass rowId set wholesale.
   *  Rows in this set bypass every filter (column / quick / external) and
   *  are unconditionally included in the visible set. Main computes the
   *  set by running `options.alwaysPassFilter` against its row-data cache
   *  and reships after every data mutation. Resolves with the post-update
   *  visible row count. */
  setAlwaysPassRowIds(rowIds: string[]): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({
      type: 'setAlwaysPassRowIds', payload: { rowIds },
    });
  }

  /** Cycle 7 / Task 8 — main-side reply to `onExternalFilterCandidates`.
   *  `callId` must echo the value the worker pushed; `surviving` is the
   *  rowIds that passed `options.doesExternalFilterPass`. The worker
   *  matches `callId` to the in-flight pipeline and resumes. Returns a
   *  Promise that resolves once the worker acknowledges the result
   *  (the original pipeline reply lands separately on the original
   *  request's promise). */
  externalFilterResult(callId: number, surviving: string[]): Promise<void> {
    return this.send<{ visibleCount: number }>({
      type: 'externalFilterResult', payload: { callId, surviving },
    }).then(() => {});
  }

  /** Cycle 7 / Task 8 — re-run the filter pipeline against the current
   *  model. Used by `CGridApi.onFilterChanged(source)` after the app
   *  mutates external-filter state without changing the column / quick /
   *  sort model. Resolves with the post-pipeline visible row count. */
  refilter(): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({ type: 'refilter', payload: {} });
  }

  /** Cycle 7 / Task 9 — request the column's distinct stringified value
   *  set. Cached worker-side per colId; invalidated whenever a
   *  transaction lands on any column. Backs the set-filter popup's
   *  checkbox list.
   *  Cycle 21d / Task 13 — optional `limit` truncates the reply; the
   *  worker-side cache always holds the full set. */
  getDistinctValues(colId: string, limit?: number): Promise<string[]> {
    return this.send<{ values: string[] }>({
      type: 'getDistinctValues', payload: { colId, limit },
    }).then((r) => r.values);
  }

  /** Cycle 4 / Task 11 (cell-flash patch) — runtime mutation for the
   *  worker's `enableCellChangeFlash` flag. Flipping off wipes any
   *  staged pendingFlashes so a stale entry from before the toggle
   *  doesn't paint. */
  setEnableCellChangeFlash(enabled: boolean): Promise<void> {
    return this.send<{ visibleCount: number }>({
      type: 'setEnableCellChangeFlash', payload: { enabled },
    }).then(() => {});
  }

  /** Cycle 4 / Task 11 (cell-flash patch) — programmatic cell flash.
   *  Worker resolves the string rowIds against its RowStore (drops
   *  unknowns silently), expands empty colIds to "every column with a
   *  field", and stages the (rowId, field) pairs into pendingFlashes.
   *  The flash actually paints on the next viewport reply. */
  flashCells(rowIds: string[], colIds: string[]): Promise<void> {
    return this.send<{ visibleCount: number }>({
      type: 'flashCells', payload: { rowIds, colIds },
    }).then(() => {});
  }

  /** Cycle 8 / Task 3 — register a named comparator. `source` is the
   *  function's `Function.prototype.toString()` form; the worker
   *  reconstructs the callable via `new Function(...)`. Sort runs
   *  worker-side so the registration MUST round-trip the worker before
   *  the next `setSortModel` is honored. Resolves once the worker
   *  acknowledges the registration. */
  registerComparator(name: string, source: string): Promise<void> {
    return this.send<{ visibleCount: number }>({
      type: 'registerComparator', payload: { name, source },
    }).then(() => {});
  }

  /** Cycle 14 / Task 3 — replace the worker's custom agg-func registry
   *  wholesale. Each entry's `source` is the original function's
   *  `Function.prototype.toString()` form (main side has already
   *  rebuilt + probed it to screen for closures over external scope
   *  — see `cgrid.ts` `serializeAggFunc`). The worker rebuilds via
   *  `new Function(...)`; built-in names (`sum / avg / …`) stay
   *  pre-registered and remain visible unless an entry here shadows
   *  them. AggPass reads through the registry on every viewport
   *  request so the new resolutions take effect on the next paint
   *  without a column-metadata reship. */
  setAggFuncs(funcs: Array<{ name: string; source: string }>): Promise<void> {
    return this.send<{ visibleCount: number }>({
      type: 'setAggFuncs', payload: { funcs },
    }).then(() => {});
  }

  /** Cycle 21d / Task 10 — install / replace (or remove, with null) the
   *  worker's calculated-column program. Sources are reconstructed
   *  worker-side via `new Function` (setAggFuncs precedent); a
   *  reconstruction failure rejects this promise via the error envelope. */
  setCalcProgram(program: WorkerCalcProgram | null): Promise<void> {
    return this.send<{ visibleCount: number }>({
      type: 'setCalcProgram', payload: program,
    }).then(() => {});
  }

  /** Cycle 8 / Task 4 — toggle the post-sort round-trip on the worker.
   *  When `present: true`, every subsequent pipeline pass pauses after
   *  the `SortPass` to push the sorted rowIds to main via
   *  `onPostSortRowsCandidates` and waits for `postSortRowsResult` to
   *  deliver the re-ordered array. When `false`, the pipeline runs
   *  end-to-end with zero round-trip overhead. Resolves with the
   *  post-toggle visible row count. */
  setPostSortRowsPresent(present: boolean): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({
      type: 'setPostSortRowsPresent', payload: { present },
    });
  }

  /** Cycle 8 / Task 4 — main-side reply to `onPostSortRowsCandidates`.
   *  `callId` must echo the value the worker pushed; `reordered` is the
   *  rowIds in the order `options.postSortRows` returned. The worker
   *  matches `callId` to the in-flight pipeline and resumes. The
   *  original pipeline reply lands separately on the original request's
   *  promise. */
  postSortRowsResult(callId: number, reordered: string[]): Promise<void> {
    return this.send<{ visibleCount: number }>({
      type: 'postSortRowsResult', payload: { callId, reordered },
    }).then(() => {});
  }

  /** Cycle 7 / Task 7 — ship parsed quick-filter terms (or `null` to
   *  clear) to the worker. `colIds` narrows the aggregate to a subset
   *  of worker columns (used to honor `includeHiddenColumnsInQuickFilter:
   *  false` — main passes only the visible colIds). `cacheQuickFilter`
   *  toggles the worker's per-row aggregate cache. Resolves with the
   *  new visible row count after `QuickFilterPass` + `FilterPass` run. */
  setQuickFilter(payload: {
    terms: string[] | null;
    cacheQuickFilter: boolean;
    colIds: string[] | null;
  }): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({ type: 'setQuickFilter', payload });
  }

  getViewport(req: ViewportRequest): Promise<{ chunk: ViewportChunk; stickyAncestors?: StickyAncestor[] }> {
    return this.send<{ chunk: ViewportChunk; stickyAncestors?: StickyAncestor[] }>({ type: 'getViewport', payload: req })
      .then((r) => ({ chunk: normalizeViewportChunk(r.chunk), stickyAncestors: r.stickyAncestors }));
  }

  /** Push updated column metadata into the worker so filter/sort/agg/slicer
   *  passes pick up new fields, aggFuncs, types, etc. Resolves with the new
   *  visible row count after the column swap re-runs the pipeline. */
  updateColumns(columns: WorkerColumn[]): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({ type: 'updateColumns', payload: { columns } });
  }

  /** Resolve a row's current index in the worker's visible (filter + sort)
   *  order. Returns -1 when the rowId is unknown or has been filtered out.
   *  Used by `ensureRowVisible(rowId)` + `setFocusedCell(rowId, ...)`. */
  getRowIndexForId(rowId: string): Promise<number> {
    return this.send<{ index: number }>({ type: 'getRowIndexForId', payload: { rowId } })
      .then((r) => r.index);
  }

  /** Resolve a visible-order row index back to its rowId and full row object.
   *  Returns `{ rowId: null, data: null }` for indices outside the current
   *  visible window. Used by the editor commit pathway to load `data` before
   *  invoking `valueSetter` and posting the update back. */
  getRowByIndex(rowIndex: number): Promise<{ rowId: string | null; data: unknown | null }> {
    return this.send<{ rowId: string | null; data: unknown | null }>({
      type: 'getRowByIndex', payload: { rowIndex },
    }).then((r) => ({ rowId: r.rowId, data: r.data }));
  }

  /** Cycle 6 / Task 4 — autosize the listed columns. Resolves with the
   *  measured widths (already padding-included and min/max-clamped). When
   *  `skipHeader` is false (default) the header label is included in the
   *  max. `maxSampleSize` overrides the worker's default head 2,500 +
   *  tail 2,500 cap. */
  autosizeColumns(
    columns: AutosizeColumnRequest[],
    skipHeader: boolean,
    maxSampleSize?: number,
  ): Promise<Record<string, number>> {
    return this.send<{ widths: Record<string, number> }>({
      type: 'autosize',
      payload: { columns, skipHeader, maxSampleSize },
    }).then((r) => r.widths);
  }

  /** Autosize formatted-measurement support — fetch the RAW cell values
   *  of the autosize sample window (head + tail of the visible set) for
   *  the listed field columns. Main formats + measures them with the
   *  document's fonts so the resolved widths fit the painted text. */
  autosizeSampleValues(
    colIds: string[],
    maxSampleSize?: number,
  ): Promise<{ values: Record<string, unknown[]>; rowCount: number }> {
    return this.send<{ values: Record<string, unknown[]>; rowCount: number }>({
      type: 'autosizeSample',
      payload: { colIds, maxSampleSize },
    }).then((r) => ({ values: r.values, rowCount: r.rowCount }));
  }

  /** Batched variant of `getRowIndexForId`. Returns one index per input id,
   *  in the same order. Indices are -1 for unknown / filtered ids. Used by
   *  `setSelectedRowIds([...])` and by the modelUpdated rebuild path. */
  getRowIndicesForIds(rowIds: string[]): Promise<Int32Array> {
    if (rowIds.length === 0) return Promise.resolve(new Int32Array(0));
    return this.send<{ indices: Int32Array }>({ type: 'getRowIndicesForIds', payload: { rowIds } })
      .then((r) => r.indices);
  }

  /** Cycle 10 / Task 3 — TSV / CSV encode the supplied cell ranges off
   *  the main thread. The worker resolves `range.rowStart..rowEnd`
   *  against its visible row order, reads cells via `RowStore` +
   *  `WorkerColumn.field`, and returns a single string ready for
   *  `navigator.clipboard.writeText`. `delimiter` overrides the default
   *  tab (apps that ship `clipboardDelimiter: ','` get CSV). */
  clipboardSerialize(ranges: SelectionRange[], delimiter: string): Promise<string> {
    return this.send<{ tsv: string }>({
      type: 'clipboardSerialize', payload: { ranges, delimiter },
    }).then((r) => r.tsv);
  }

  /** Cycle 10 / Task 4 — parse a TSV / CSV payload into a `string[][]`
   *  off the main thread. `text` is the raw clipboard payload from
   *  `navigator.clipboard.readText`; `delimiter` matches
   *  `CGridOptions.clipboardDelimiter` (default `\t`). The main thread
   *  uses the result to assemble a focus-anchored
   *  `applyTransaction({ update: [...] })`. */
  clipboardDeserialize(text: string, delimiter: string): Promise<string[][]> {
    return this.send<{ rows: string[][] }>({
      type: 'clipboardDeserialize', payload: { text, delimiter },
    }).then((r) => r.rows);
  }

  /** Cycle 20 / Task 3 — full-data export. Walks all visible rows in
   *  the worker, serializes to CSV / XLSX bytes, returns an
   *  ArrayBuffer (transferred — zero copy from worker to main). */
  exportData(payload: {
    format: 'csv' | 'xlsx';
    headerNames: Record<string, string>;
    types: Record<string, 'text' | 'number'>;
    options: Record<string, unknown>;
    selectedRowIds?: string[];
  }): Promise<ArrayBuffer> {
    return this.send<{ buffer: ArrayBuffer }>({
      type: 'exportData', payload,
    }).then((r) => r.buffer);
  }

  /** Cycle 20 / Task 4 — fetch the full visible row set so callbacks
   *  (main-only functions) can run before serialization. */
  getExportRows(payload: { selectedRowIds?: string[] } = {}): Promise<Array<Record<string, unknown>>> {
    return this.send<{ rows: Array<Record<string, unknown>> }>({
      type: 'getExportRows', payload,
    }).then((r) => r.rows);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Remove the message listener BEFORE terminate(). Two reasons:
    // (1) real Workers may flush queued messages around terminate; we don't
    //     want late deliveries hitting the now-stale handlers closure.
    // (2) the listener arrow function captures `this` (and transitively the
    //     handlers / CGrid instance) — explicit removal lets GC reclaim the
    //     graph immediately rather than waiting for the Worker itself.
    this.worker.removeEventListener?.('message', this.messageHandler);
    this.worker.terminate();
    this.pending.forEach((p) => p.reject(new Error('worker terminated')));
    this.pending.clear();
    // Clear the queued-push state so any late-arriving callback that
    // somehow survives can't re-emit stale data.
    this.pendingModelUpdated = null;
    this.pendingHeights = [];
    this.pendingTxnResults = [];
  }
}
