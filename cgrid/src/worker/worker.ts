import type {
  WorkerRequest, WorkerResponse, WorkerPush, WorkerInitPayload, MeasureTextItem,
} from './protocol';
import { collectViewportTransferables } from './protocol';
import {
  RowStore, FilterPass, SortPass, AggPass, ViewportSlicer, TransactionQueue,
  QuickFilterPass, DistinctValuesPass, diffRowFields,
} from './dataPipeline';
import { ComparatorRegistry } from './comparatorRegistry';
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
  /** Cycle 7 / Task 9 — distinct-value derivation for the set-filter
   *  popup. Cached per-colId; invalidated through the same transaction
   *  hook `QuickFilterPass.invalidateRows` plugs into. */
  distinct: DistinctValuesPass;
  sort: SortPass;
  /** Cycle 8 / Task 3 — named comparators registered via
   *  `registerComparator`. `SortPass.apply` looks up each sorted column's
   *  `comparator` (a string name on the `WorkerColumn`) against this
   *  registry; unknown names fall back to the built-in `compare()`. */
  comparators: ComparatorRegistry;
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
    ids = state.sort.apply(ids);
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

  async function invalidateAndCount(): Promise<number> {
    if (!state) return 0;
    state.visibleCache = await buildVisibleAsync();
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
        post({ type: 'modelUpdated', visibleCount });
      });
      return all;
    });

    const comparators = new ComparatorRegistry();
    state = {
      store,
      filter:      new FilterPass(store, payload.columns),
      quickFilter: new QuickFilterPass(store, payload.columns),
      distinct:    new DistinctValuesPass(store, payload.columns),
      sort:        new SortPass(store, payload.columns, comparators),
      comparators,
      agg:         new AggPass(store, payload.columns),
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
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount });
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
              post({ type: 'modelUpdated', visibleCount: await invalidateAndCount() });
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
            // Foundation scope: no real grouping — respond with current counts only.
            post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: (await visibleAsync()).length });
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
            const ids = await visibleAsync();
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
            const visIds = await visibleAsync();
            // Cycle 4 / Task 11 — pass pendingFlashes to the slicer so
            // it can pack the flashMask. Drain ONLY the cells the slice
            // actually emitted (drop rowId entries whose visible cells
            // were all covered by this chunk's columns + rowStart/rowEnd
            // window) — flashes for off-window rows persist until those
            // rows are visible.
            const pending = state.enableCellChangeFlash ? state.pendingFlashes : undefined;
            const chunk = state.slicer.slice(visIds, req.payload, pending);
            if (pending !== undefined && chunk.flashMask !== undefined) {
              // Drain: clear the (rowId, field) entries we just flashed.
              // For each visible row in the chunk window, remove the
              // fields that correspond to this request's columns.
              const s = state;
              const colFields = req.payload.columns
                .map((colId) => s.columns.find((c) => c.colId === colId)?.field)
                .filter((f): f is string => f !== undefined);
              for (let r = 0; r < chunk.rowCount; r++) {
                const rowId = visIds[chunk.rowStart + r]!;
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
