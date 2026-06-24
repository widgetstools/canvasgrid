import type {
  WorkerRequest, WorkerResponse, WorkerPush, WorkerInitPayload, ViewportRequest, ViewportChunk,
  WorkerColumn,
} from './protocol';
import type { TransactionResult, SortModel, FilterModel } from '../types';

export interface WorkerClientHandlers {
  onModelUpdated: (visibleCount: number) => void;
  onAsyncTransactionsFlushed: (results: TransactionResult[]) => void;
  onError: (error: string) => void;
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

  setRowData(rows: unknown[]): Promise<{ count: number; visibleCount: number }> {
    return this.send<{ count: number; visibleCount: number }>({ type: 'setRowData', payload: { rows } });
  }

  applyTransaction(payload: { add?: unknown[]; update?: unknown[]; remove?: string[]; async: boolean }): Promise<TransactionResult> {
    return this.send<{ results: TransactionResult }>({ type: 'applyTransaction', payload })
      .then((r) => r.results);
  }

  setSortModel(s: SortModel): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({ type: 'setSortModel', payload: s });
  }

  setFilterModel(f: FilterModel): Promise<{ visibleCount: number }> {
    return this.send<{ visibleCount: number }>({ type: 'setFilterModel', payload: f });
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
