import type {
  WorkerRequest, WorkerResponse, WorkerPush, WorkerInitPayload, ViewportRequest, ViewportChunk,
  WorkerColumn, MeasureTextItem, AutosizeColumnRequest,
} from './protocol';
import type { TransactionResult, SortModel, FilterModel } from '../types';

export interface WorkerClientHandlers {
  onModelUpdated: (visibleCount: number) => void;
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
}

export interface WorkerLike {
  postMessage(msg: unknown, transfer?: ArrayBuffer[]): void;
  addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
  terminate(): void;
}

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; }

export class WorkerClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private worker: WorkerLike, private handlers: WorkerClientHandlers) {
    worker.addEventListener('message', (e) => this.onMessage(e.data as WorkerResponse | WorkerPush));
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
    if (msg.type === 'modelUpdated') this.handlers.onModelUpdated(msg.visibleCount);
    else if (msg.type === 'asyncTransactionsFlushed') this.handlers.onAsyncTransactionsFlushed(msg.results);
    else if (msg.type === 'heightsChanged') {
      this.handlers.onHeightsChanged?.(msg.rowStart, msg.heights);
    } else if (msg.type === 'measureTextRequest') {
      this.handlers.onMeasureTextRequest?.(msg.batchId, msg.items);
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

  setRowData(rows: unknown[], heightsByRowId?: Map<string, number>): Promise<{ count: number; visibleCount: number }> {
    return this.send<{ count: number; visibleCount: number }>({
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

  getViewport(req: ViewportRequest): Promise<ViewportChunk> {
    return this.send<{ chunk: ViewportChunk }>({ type: 'getViewport', payload: req }).then((r) => r.chunk);
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

  /** Batched variant of `getRowIndexForId`. Returns one index per input id,
   *  in the same order. Indices are -1 for unknown / filtered ids. Used by
   *  `setSelectedRowIds([...])` and by the modelUpdated rebuild path. */
  getRowIndicesForIds(rowIds: string[]): Promise<Int32Array> {
    if (rowIds.length === 0) return Promise.resolve(new Int32Array(0));
    return this.send<{ indices: Int32Array }>({ type: 'getRowIndicesForIds', payload: { rowIds } })
      .then((r) => r.indices);
  }

  destroy(): void {
    this.worker.terminate();
    this.pending.forEach((p) => p.reject(new Error('worker terminated')));
    this.pending.clear();
  }
}
