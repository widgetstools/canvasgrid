import type {
  WorkerRequest, WorkerResponse, WorkerPush, WorkerInitPayload, MeasureTextItem,
} from './protocol';
import { collectViewportTransferables } from './protocol';
import {
  RowStore, FilterPass, SortPass, AggPass, ViewportSlicer, TransactionQueue,
  QuickFilterPass,
} from './dataPipeline';
import type { TransactionResult } from '../types';
import type { WorkerColumn } from './protocol';
import {
  MeasureCache, measureKey, offscreenMeasurer, workerCanMeasure, wrapTextToHeight,
} from './measureText';
import { measureColumnWidths, type AutosizeColumnSpec } from './autosize';

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
  sort: SortPass;
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
    // Cycle 7 / Task 7 — QuickFilterPass runs BEFORE FilterPass. A null
    // return means no quick-filter constraint, so we skip the intersection
    // entirely.
    const quickIds = state.quickFilter.apply();
    let ids = state.filter.apply();
    if (quickIds !== null) {
      const allow = new Set(quickIds);
      ids = ids.filter((id) => allow.has(id));
    }
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
        const r = store.apply(tx);
        all.push(r);
        // Aggregate cache must drop any row that just mutated so the next
        // QuickFilterPass.apply rebuilds against current values.
        for (const a of r.add)    touched.add(a.rowId);
        for (const u of r.update) touched.add(u.rowId);
        for (const x of r.remove) touched.add(x.rowId);
      }
      state!.quickFilter.invalidateRows(touched);
      state!.visibleCache = null;
      post({ type: 'modelUpdated', visibleCount: invalidateAndCount() });
      return all;
    });

    state = {
      store,
      filter:      new FilterPass(store, payload.columns),
      quickFilter: new QuickFilterPass(store, payload.columns),
      sort:        new SortPass(store, payload.columns),
      agg:         new AggPass(store, payload.columns),
      slicer:      new ViewportSlicer(store, payload.columns),
      queue,
      columns: payload.columns,
      visibleCache: null,
      measureCache: new MeasureCache(1024),
      pendingFallbacks: new Map(),
      nextBatchId: 1,
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
            state.visibleCache = null;
            const visibleCount = invalidateAndCount();
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount });
            break;
          }

          case 'applyTransaction': {
            const { add, update, remove, async: isAsync, heightsByRowId } = req.payload;
            if (isAsync) {
              state.queue.push({ add: add as any[], update: update as any[], remove, heightsByRowId });
              post({ id: req.id, type: 'transactionFlushed', results: { add: [], update: [], remove: [] } });
            } else {
              const results = state.store.apply({ add: add as any[], update: update as any[], remove, heightsByRowId });
              // Cycle 7 / Task 7 — sync transactions also need the quick
              // filter aggregate cache invalidated for the touched rows.
              const touched = new Set<string>();
              for (const a of results.add)    touched.add(a.rowId);
              for (const u of results.update) touched.add(u.rowId);
              for (const x of results.remove) touched.add(x.rowId);
              state.quickFilter.invalidateRows(touched);
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
            state.quickFilter.setColumns(cols);
            state.sort.setColumns(cols);
            state.agg.setColumns(cols);
            state.slicer.setColumns(cols);
            state.visibleCache = null;
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: invalidateAndCount() });
            break;
          }

          case 'setQuickFilter': {
            const { terms, cacheQuickFilter, colIds } = req.payload;
            state.quickFilter.setCacheEnabled(cacheQuickFilter);
            state.quickFilter.setColIds(colIds);
            state.quickFilter.setTerms(terms);
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

          case 'getRowByIndex': {
            const ids = visible();
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
            const ids = visible();
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
