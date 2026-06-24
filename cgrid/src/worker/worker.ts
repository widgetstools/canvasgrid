import type {
  WorkerRequest, WorkerResponse, WorkerPush, WorkerInitPayload,
} from './protocol';
import { collectViewportTransferables } from './protocol';
import {
  RowStore, FilterPass, SortPass, AggPass, ViewportSlicer, TransactionQueue,
} from './dataPipeline';
import type { TransactionResult } from '../types';
import type { WorkerColumn } from './protocol';

interface State {
  store: RowStore;
  filter: FilterPass;
  sort: SortPass;
  agg: AggPass;
  slicer: ViewportSlicer;
  queue: TransactionQueue;
  columns: WorkerColumn[];
  visibleCache: string[] | null;
}

type Postable = WorkerResponse | WorkerPush;
type PostFn = (msg: Postable, transfer?: ArrayBuffer[]) => void;

export interface WorkerHost {
  handle(req: WorkerRequest): void;
}

export function createWorkerHost(post: PostFn): WorkerHost {
  let state: State | null = null;

  function buildVisible(): string[] {
    if (!state) return [];
    let ids = state.filter.apply();
    ids = state.sort.apply(ids);
    return ids;
  }

  function visible(): string[] {
    if (!state) return [];
    if (!state.visibleCache) {
      state.visibleCache = buildVisible();
    }
    return state.visibleCache;
  }

  function invalidateAndCount(): number {
    if (!state) return 0;
    state.visibleCache = buildVisible();
    return state.visibleCache.length;
  }

  function initHost(payload: WorkerInitPayload, id: number): void {
    const store = new RowStore(payload.rowIdField);

    const queue = new TransactionQueue({
      waitMs: 50,
      onFlush: (results: TransactionResult[]) => {
        post({ type: 'asyncTransactionsFlushed', results });
      },
    });

    queue.setFlushFn((txs) => {
      const all: TransactionResult[] = [];
      for (const tx of txs) all.push(store.apply(tx));
      state!.visibleCache = null;
      post({ type: 'modelUpdated', visibleCount: invalidateAndCount() });
      return all;
    });

    state = {
      store,
      filter: new FilterPass(store, payload.columns),
      sort:   new SortPass(store, payload.columns),
      agg:    new AggPass(store, payload.columns),
      slicer: new ViewportSlicer(store, payload.columns),
      queue,
      columns: payload.columns,
      visibleCache: null,
    };

    post({ id, type: 'ready' });
  }

  return {
    handle(req: WorkerRequest): void {
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
            state.store.setAll(req.payload.rows as any[]);
            state.visibleCache = null;
            const visibleCount = invalidateAndCount();
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount });
            break;
          }

          case 'applyTransaction': {
            const { add, update, remove, async: isAsync } = req.payload;
            if (isAsync) {
              state.queue.push({ add: add as any[], update: update as any[], remove });
              post({ id: req.id, type: 'transactionFlushed', results: { add: [], update: [], remove: [] } });
            } else {
              const results = state.store.apply({ add: add as any[], update: update as any[], remove });
              state.visibleCache = null;
              post({ id: req.id, type: 'transactionFlushed', results });
              post({ type: 'modelUpdated', visibleCount: invalidateAndCount() });
            }
            break;
          }

          case 'setSortModel': {
            state.sort.setModel(req.payload);
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: invalidateAndCount() });
            break;
          }

          case 'setFilterModel': {
            state.filter.setModel(req.payload);
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: invalidateAndCount() });
            break;
          }

          case 'setGroupModel': {
            // Foundation scope: no real grouping — respond with current counts only.
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: visible().length });
            break;
          }

          case 'updateColumns': {
            // Swap column metadata in place across every pass so an in-flight
            // filter/sort model stays applied against the new columns.
            const cols = req.payload.columns;
            state.columns = cols;
            state.filter.setColumns(cols);
            state.sort.setColumns(cols);
            state.agg.setColumns(cols);
            state.slicer.setColumns(cols);
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: invalidateAndCount() });
            break;
          }

          case 'getRowIndexForId': {
            const ids = visible();
            const idx = ids.indexOf(req.payload.rowId);
            post({ id: req.id, type: 'rowIndex', index: idx });
            break;
          }

          case 'getRowIndicesForIds': {
            // Build a one-shot lookup table so an N-id batch is O(visible + N)
            // instead of O(visible * N). Critical when the selection set is
            // large (e.g. selectAll over a million rows).
            const ids = visible();
            const lookup = new Map<string, number>();
            for (let i = 0; i < ids.length; i++) lookup.set(ids[i]!, i);
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
            const visIds = visible();
            const chunk = state.slicer.slice(visIds, req.payload);
            // Wire AggPass: compute grand-total aggregations over all visible rows.
            const aggResult = state.agg.apply(visIds);
            if (Object.keys(aggResult.totals).length > 0) {
              chunk.totals = aggResult.totals;
            }
            post(
              { id: req.id, type: 'viewport', chunk },
              collectViewportTransferables(chunk) as ArrayBuffer[],
            );
            break;
          }
        }
      } catch (err) {
        post({ id: (req as { id: number }).id, type: 'error', error: String((err as Error).message ?? err) });
      }
    },
  };
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
