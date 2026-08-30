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
  onModelUpdated: (visibleCount: number, groupKeys?: string[], expandedKeys?: string[] | null) => void;
  onAsyncTransactionsFlushed: (results: TransactionResult[]) => void;
  /** A-L1 (production hardening) — the worker's `error` / `messageerror`
   *  event, or a watchdog trip on `init()` never getting a `ready` reply.
   *  Every in-flight `pending` request is rejected with `error` BEFORE
   *  this fires (except `'init-timeout'`, which does not reject `init()` —
   *  the worker may still be alive and just slow; it's a loud diagnostic,
   *  not a teardown). Previously dead wiring — nothing ever invoked this. */
  onError: (error: Error, context: 'error' | 'messageerror' | 'init-timeout') => void;
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
  /** A-L1 (production hardening) — loud-failure hooks, wired as PROPERTY
   *  assignments (the `AbstractWorker` / `Worker` IDL attributes real Web
   *  Workers support natively) rather than `addEventListener('error' |
   *  'messageerror', …)`. Deliberate: dozens of existing kernel/ext test
   *  doubles implement only `{addEventListener, postMessage, terminate}`
   *  and route EVERY `addEventListener` registration through one shared
   *  'message'-shaped dispatch channel (they only ever emulate the
   *  message channel). Registering the new hooks that way would fire
   *  WorkerClient's error handler on every ordinary worker reply across
   *  the whole suite. Property assignment is a no-op for those doubles
   *  (nothing reads the property) while working correctly on a real
   *  Worker. Optional so minimal test stubs can omit them entirely. */
  onerror?: ((e: { message?: string; error?: unknown }) => void) | null;
  onmessageerror?: ((e: { data?: unknown }) => void) | null;
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
  /** A-L2 — handles for the rAF/timer race in `scheduleFlush`. Whichever
   *  fires first flushes; `flushPushQueue` cancels the loser. */
  private flushRaf: number | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingModelUpdated: { visibleCount: number; groupKeys?: string[]; expandedKeys?: string[] | null } | null = null;
  private pendingHeights: Array<{ rowStart: number; heights: Float32Array }> = [];
  private pendingTxnResults: TransactionResult[] = [];
  private destroyed = false;
  private readonly messageHandler: (e: { data: unknown }) => void;
  private readonly errorHandler: (e: { message?: string; error?: unknown }) => void;
  private readonly messageErrorHandler: (e: { data?: unknown }) => void;

  /** A-L1 — worker `init()` never got a `ready` reply within this window
   *  (CSP block, bundler failure, or an unhandled exception before the
   *  worker's own message loop starts — none of which reliably fire a
   *  Worker `error` event across browsers) trips a loud diagnostic. Does
   *  NOT reject `init()`'s promise — the worker may still be alive and
   *  just slow; this is a floor so the failure is never silent, not a
   *  teardown. */
  private static readonly INIT_TIMEOUT_MS = 10_000;

  /** A-L2 — ceiling on how long a coalesced push batch may sit unflushed
   *  when the frame callback never arrives (hidden / background tab).
   *  Deliberately well above one frame so a foreground grid always
   *  dispatches on the rAF, exactly as before. */
  private static readonly PUSH_FLUSH_FALLBACK_MS = 50;

  constructor(private worker: WorkerLike, private handlers: WorkerClientHandlers) {
    this.messageHandler = (e) => {
      if (this.destroyed) return;
      this.onMessage(e.data as WorkerResponse | WorkerPush);
    };
    worker.addEventListener('message', this.messageHandler);

    this.errorHandler = (e) => {
      if (this.destroyed) return;
      const detail = typeof e?.message === 'string' && e.message ? e.message : 'unknown error';
      const err = e?.error instanceof Error ? e.error : new Error(`VelocityGrid worker error: ${detail}`);
      this.failPending(err);
      this.handlers.onError(err, 'error');
    };
    worker.onerror = this.errorHandler;

    this.messageErrorHandler = () => {
      if (this.destroyed) return;
      const err = new Error('VelocityGrid worker sent a message that could not be deserialized (messageerror)');
      this.failPending(err);
      this.handlers.onError(err, 'messageerror');
    };
    worker.onmessageerror = this.messageErrorHandler;
  }

  /** Reject every in-flight request with `err` and clear `pending`. Shared
   *  by the error/messageerror hooks and `destroy()`. The promises
   *  themselves already carry an internal silent `.catch` attached at
   *  creation time (see `send`) — rejecting them here never surfaces as a
   *  Node `unhandledRejection` even if the original caller hasn't (or
   *  never will) attach its own handler. */
  private failPending(err: Error): void {
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    // A-L2 (production hardening) — `requestAnimationFrame` is SUSPENDED
    // while a tab is hidden/backgrounded. Scheduling the flush on the frame
    // alone meant `pendingTxnResults` / `pendingHeights` grew unbounded for
    // as long as the tab stayed in the background (hours, on a live
    // blotter) and then dispatched as one giant stale batch on refocus.
    //
    // Fix: race the frame against a wall-clock timer; first one wins and
    // `flushPushQueue` cancels the loser. When the document is ALREADY
    // hidden, skip rAF entirely — registering it there just parks a
    // callback that may never run.
    //
    // The no-rAF environment keeps its original `queueMicrotask` path
    // untouched (worker/node/test hosts flush immediately there; there is
    // no suspension to defend against, and a 50ms timer would be a
    // behaviour change for every such caller).
    if (typeof requestAnimationFrame !== 'function') {
      queueMicrotask(() => this.flushPushQueue());
      return;
    }
    const hidden = typeof document !== 'undefined'
      && (document as { visibilityState?: string }).visibilityState === 'hidden';
    if (!hidden) {
      this.flushRaf = requestAnimationFrame(() => {
        this.flushRaf = null;
        this.flushPushQueue();
      });
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPushQueue();
    }, WorkerClient.PUSH_FLUSH_FALLBACK_MS);
    // Node-only: don't hold the process open for the fallback timer.
    (this.flushTimer as unknown as { unref?: () => void }).unref?.();
  }

  /** A-L2 — drop whichever of the rAF / timer pair did not fire. */
  private cancelFlushSchedule(): void {
    if (this.flushRaf !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.flushRaf);
      this.flushRaf = null;
    }
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private flushPushQueue(): void {
    this.flushScheduled = false;
    this.cancelFlushSchedule();
    // Late-arriving RAF after destroy() — pending queues were already
    // cleared, but bail explicitly so we don't dispatch into stale handlers.
    if (this.destroyed) return;
    const model = this.pendingModelUpdated;
    const heights = this.pendingHeights;
    const txn = this.pendingTxnResults;
    this.pendingModelUpdated = null;
    this.pendingHeights = [];
    this.pendingTxnResults = [];
    if (model) this.handlers.onModelUpdated(model.visibleCount, model.groupKeys, model.expandedKeys);
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
      this.pendingModelUpdated = {
        visibleCount: msg.visibleCount,
        groupKeys: msg.groupKeys,
        // Coalescing keeps the latest push's fields, but a seed-bearing
        // expandedKeys must survive a later seed-less push in the same
        // RAF window — it is a one-shot signal.
        expandedKeys: msg.expandedKeys !== undefined
          ? msg.expandedKeys
          : this.pendingModelUpdated?.expandedKeys,
      };
      this.scheduleFlush();
    } else if (msg.type === 'asyncTransactionsFlushed') {
      for (const r of msg.results) {
        this.warnIfAny(r.warnings);
        this.pendingTxnResults.push(r);
      }
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
    const p = new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(), reject });
      this.worker.postMessage(
        { id, type: 'measureTextResponse', payload: { batchId, heights } },
        [heights.buffer as ArrayBuffer],
      );
    });
    // See `send`'s comment — internal-only, prevents an unhandled rejection
    // when `destroy()` / the error hooks bulk-reject before a caller has
    // (or ever will have) attached its own handler.
    p.catch(() => {});
    return p;
  }

  /** Surfaces per-row skip warnings (RowStore's malformed-row tolerance —
   *  see `setRowData` / `applyTransaction` / the `asyncTransactionsFlushed`
   *  push) so a silently-skipped row is never truly silent, even when the
   *  host app doesn't inspect the response's `warnings` field itself. */
  private warnIfAny(warnings: string[] | undefined): void {
    if (warnings && warnings.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[velocity-grid]', warnings.join('\n'));
    }
  }

  private send<T>(req: Omit<WorkerRequest, 'id'>): Promise<T> {
    const id = this.nextId++;
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject });
      this.worker.postMessage({ ...req, id });
    });
    // A-L1 — swallow rejections on this internal reference so bulk-fail
    // paths (destroy(), worker error/messageerror) never register as an
    // unhandled rejection just because the caller hasn't attached its own
    // `.then`/`.catch` yet (or a fire-and-forget caller never will). `p` is
    // the SAME object returned below, so real callers still observe the
    // rejection normally — this only marks `p` itself as "handled" from
    // Node's perspective, it never swallows the reason.
    p.catch(() => {});
    return p;
  }

  init(payload: WorkerInitPayload): Promise<void> {
    const p = this.send<{ type: 'ready' }>({ type: 'init', payload }).then(() => {});
    const timer = setTimeout(() => {
      if (this.destroyed) return;
      const err = new Error(
        'VelocityGrid worker failed to initialize within 10s — likely a worker load failure '
        + '(CSP / bundler / network) or an unhandled exception during worker startup.',
      );
      // eslint-disable-next-line no-console
      console.error('[velocity-grid]', err.message);
      this.handlers.onError(err, 'init-timeout');
    }, WorkerClient.INIT_TIMEOUT_MS);
    // Node-only: don't hold the process open for the watchdog. No-op (and
    // absent) in browsers, where it doesn't matter either way.
    (timer as unknown as { unref?: () => void }).unref?.();
    p.then(() => clearTimeout(timer), () => clearTimeout(timer));
    return p;
  }

  setRowData(rows: unknown[], heightsByRowId?: Map<string, number>): Promise<{ count: number; visibleCount: number; groupKeys?: string[]; expandedKeys?: string[] | null }> {
    return this.send<{ count: number; visibleCount: number; groupKeys?: string[]; warnings?: string[] }>({
      type: 'setRowData', payload: { rows, heightsByRowId },
    }).then((r) => {
      this.warnIfAny(r.warnings);
      return r;
    });
  }

  ssrmHydrate(payload: {
    rowCount: number;
    startRow: number;
    rows: unknown[];
    reset?: boolean;
  }): Promise<{ count: number; visibleCount: number }> {
    return this.send<{ count: number; visibleCount: number }>({
      type: 'ssrmHydrate',
      payload,
    });
  }

  /** B-L2 — drop LRU-evicted SSRM rows from the worker store. See the
   *  protocol's `ssrmEvict` doc for the slot-reset semantics. */
  ssrmEvict(rowIds: string[]): Promise<{ count: number; visibleCount: number }> {
    return this.send<{ count: number; visibleCount: number }>({
      type: 'ssrmEvict',
      payload: { rowIds },
    });
  }

  ssrmSetClientPipeline(enabled: boolean): Promise<{ count: number; visibleCount: number; groupKeys?: string[]; expandedKeys?: string[] | null }> {
    return this.send<{ count: number; visibleCount: number; groupKeys?: string[]; expandedKeys?: string[] | null }>({
      type: 'ssrmSetClientPipeline',
      payload: { enabled },
    });
  }

  ssrmSetGrandTotals(totals: Record<string, unknown> | null): Promise<{ count: number; visibleCount: number }> {
    return this.send<{ count: number; visibleCount: number }>({
      type: 'ssrmSetGrandTotals',
      payload: { totals },
    });
  }

  ssrmSetPivotResult(
    result: import('./protocol').SsrmPivotResult | null,
  ): Promise<{ count: number; visibleCount: number }> {
    return this.send<{ count: number; visibleCount: number }>({
      type: 'ssrmSetPivotResult',
      payload: { result },
    });
  }

  applyTransaction(payload: {
    add?: unknown[]; update?: unknown[]; remove?: string[];
    async: boolean; heightsByRowId?: Map<string, number>;
  }): Promise<TransactionResult> {
    return this.send<{ results: TransactionResult }>({ type: 'applyTransaction', payload })
      .then((r) => {
        this.warnIfAny(r.results.warnings);
        return r.results;
      });
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
   *  model. Used by `VelocityGridApi.onFilterChanged(source)` after the app
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

  setAsyncTransactionOptions(opts: {
    waitMillis?: number;
    conflate?: boolean;
    throttleMillis?: number;
  }): Promise<void> {
    return this.send<{ visibleCount: number }>({
      type: 'setAsyncTransactionOptions', payload: opts,
    }).then(() => {});
  }

  flushAsyncTransactions(): Promise<void> {
    return this.send<{ visibleCount: number }>({
      type: 'flushAsyncTransactions', payload: {},
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
   *  — see `core/aggFuncSerialization.ts`). The worker rebuilds via
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
   *  `VelocityGridOptions.clipboardDelimiter` (default `\t`). The main thread
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
    //     handlers / VelocityGrid instance) — explicit removal lets GC reclaim the
    //     graph immediately rather than waiting for the Worker itself.
    this.worker.removeEventListener?.('message', this.messageHandler);
    // A-L1 — same rationale for the loud-failure hooks: drop the
    // references before terminate() so nothing can fire into a destroyed
    // client, and GC isn't held up by a Worker→WorkerClient reference cycle.
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate();
    // `failPending` rejects via the pre-attached internal `.catch` (see
    // `send`) — never an unhandled rejection even if the original caller
    // hasn't attached its own handler yet.
    this.failPending(new Error('worker terminated'));
    // Clear the queued-push state so any late-arriving callback that
    // somehow survives can't re-emit stale data.
    // A-L2 — and cancel the pending frame / fallback timer outright.
    this.cancelFlushSchedule();
    this.flushScheduled = false;
    this.pendingModelUpdated = null;
    this.pendingHeights = [];
    this.pendingTxnResults = [];
  }
}
