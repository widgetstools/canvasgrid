// Cycle 19 / Task 6 — data-pipeline handler.
//
// Owns the row-lifecycle + column-metadata + sort + comparator + flash
// slice of the worker protocol:
//   setRowData, applyTransaction, updateColumns,
//   setEnableCellChangeFlash, flashCells,
//   setAggFuncs, registerComparator,
//   setSortModel, setPostSortRowsPresent, postSortRowsResult.
//
// Each case body was moved verbatim from `worker.ts`; the switch shape
// is preserved so the response envelope + control flow is byte-for-byte
// identical to the pre-extraction dispatcher.
//
// Cycle 21d / Task 10 — setCalcProgram joins this handler (it owns the
// sibling `new Function` reconstruction messages: setAggFuncs,
// registerComparator).

import type { HandlerCtx } from '../dispatch';
import type { WorkerRequest } from '../protocol';
import type { IAggFunc } from '../aggFuncRegistry';
import { readSsrmRowMeta } from '../../core/ssrmRowMeta';

export type DataPipelineRequest = Extract<WorkerRequest, {
  type:
    | 'setRowData'
    | 'ssrmHydrate'
    | 'ssrmEvict'
    | 'ssrmSetClientPipeline'
    | 'ssrmSetGrandTotals'
    | 'applyTransaction'
    | 'updateColumns'
    | 'setEnableCellChangeFlash'
    | 'setAsyncTransactionOptions'
    | 'flushAsyncTransactions'
    | 'flashCells'
    | 'setAggFuncs'
    | 'setCalcProgram'
    | 'registerComparator'
    | 'setSortModel'
    | 'setPostSortRowsPresent'
    | 'postSortRowsResult';
}>;

export async function handleDataPipeline(
  ctx: HandlerCtx,
  req: DataPipelineRequest,
): Promise<void> {
  const { state, post, helpers } = ctx;
  switch (req.type) {
    case 'ssrmSetGrandTotals': {
      state.ssrmGrandTotals = req.payload.totals;
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: state.visibleCache?.length ?? 0 });
      return;
    }

    case 'ssrmSetClientPipeline': {
      state.ssrmClientPipeline = req.payload.enabled === true;
      if (!state.ssrmClientPipeline) {
        // Sparse path re-entered — CSRM-derived pipeline output is dead
        // state now. Left in place, `isGroupingActive()` stayed true and
        // every getViewport walked the stale tree over `ssrmOrder`
        // (setGroupModel can't rebuild it: buildVisibleAsync early-returns
        // on the sparse path).
        state.groupOutput = null;
        state.pivotOut = null;
        state.groupInputIds = null;
        state.pivotInputIds = null;
      }
      state.visibleCache = null;
      state.visibleCachePromise = null;
      const wasPendingSeed = state.pendingDefaultExpandSeed;
      const visibleCount = await helpers.invalidateAndCount();
      const groupKeys = helpers.isGroupingActive() ? helpers.currentGroupKeys() : undefined;
      const expandedKeys = wasPendingSeed && !state.pendingDefaultExpandSeed
        ? (state.expandedKeys === null ? null : Array.from(state.expandedKeys))
        : undefined;
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount, groupKeys, expandedKeys });
      return;
    }

    case 'setRowData': {
      // Leaving SSRM — CSRM full replace owns the store again.
      state.ssrmActive = false;
      state.slicer.setSsrmMetaEnabled(false);
      state.ssrmClientPipeline = false;
      state.ssrmOrder = [];
      state.ssrmRowCount = 0;
      state.ssrmGroupMetaSeen = false;
      state.ssrmGrandTotals = null;
      // A-C2 (production hardening) — a full data replace wipes main's row
      // mirror; drain-and-discard any pending async transaction so a queued
      // tick can't replay onto (and diverge) the replacement store.
      state.queue.discardPending();
      state.store.setAll(req.payload.rows as unknown[], req.payload.heightsByRowId);
      // Cycle 21d / Task 11 — full data replace invalidates the calc
      // value cache; next ensureStageA pass does a full recompute.
      state.calc.onSetRowData();
      // Cycle 7 / Task 8 — a full data replace invalidates any
      // alwaysPass set computed against the previous data.
      state.alwaysPassIds.clear();
      // Cycle 7 / Task 9 — a full data replace also invalidates
      // the per-column distinct caches.
      state.distinct.invalidateRows([]);
      // Cycle 4 / Task 11 — wipe pendingFlashes.
      state.pendingFlashes.clear();
      // Damage-region rendering (Task 3) — a full data replace invalidates
      // any staged touched-row bookkeeping the same way it invalidates
      // pendingFlashes (row identities from the old dataset are meaningless
      // against the new one).
      state.pendingTouched.clear();
      state.visibleCache = null;
      state.visibleCachePromise = null;
      const wasPendingSeed = state.pendingDefaultExpandSeed;
      const visibleCount = await helpers.invalidateAndCount();
      // Cycle 15 / Task 7 — ride the groupKeys snapshot back on the
      // same reply so `knownGroupKeys` stays in sync.
      const groupKeys = helpers.isGroupingActive() ? helpers.currentGroupKeys() : undefined;
      // AG parity 2026-07-21 — this load may have re-seeded the
      // groupDefaultExpanded defaults (model landed before data); ship
      // the seeded set so main's expansion mirror stays truthful.
      const expandedKeys = wasPendingSeed && !state.pendingDefaultExpandSeed
        ? (state.expandedKeys === null ? null : Array.from(state.expandedKeys))
        : undefined;
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount, groupKeys, expandedKeys });
      return;
    }

    case 'ssrmHydrate': {
      const { rowCount, startRow, rows, reset } = req.payload;
      state.ssrmActive = true;
      state.slicer.setSsrmMetaEnabled(true);
      state.ssrmRowCount = Math.max(0, rowCount | 0);
      const reallocated = !reset && state.ssrmOrder.length !== state.ssrmRowCount;
      if (reset || reallocated) {
        state.ssrmOrder = new Array<string>(state.ssrmRowCount).fill('');
        if (reset) {
          // A-C2 (production hardening) — same drain-and-discard as
          // setRowData: a reset hydrate wholesale-replaces the store, so any
          // queued async tick must not replay onto the fresh dataset.
          state.queue.discardPending();
          state.store.setAll([]);
          state.pendingFlashes.clear();
          state.pendingTouched.clear();
          state.calc.onSetRowData();
          state.ssrmGroupMetaSeen = false;
        }
      }
      const add: unknown[] = [];
      const update: unknown[] = [];
      let repointed = false;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row == null) continue;
        // Host-owned grouping ships group rows with `__ssrm` meta — flag
        // gates the sparse sticky-ancestor scan (see workerState doc).
        if (!state.ssrmGroupMetaSeen && readSsrmRowMeta(row)?.kind === 'group') {
          state.ssrmGroupMetaSeen = true;
        }
        const idx = startRow + i;
        if (idx < 0 || idx >= state.ssrmRowCount) continue;
        let id: string;
        try {
          id = state.store.getRowId(row);
        } catch {
          continue;
        }
        const prev = state.ssrmOrder[idx];
        state.ssrmOrder[idx] = id;
        if (state.store.getById(id)) update.push(row);
        else add.push(row);
        if (prev !== '' && prev !== id) repointed = true;
      }
      if (add.length || update.length) {
        // Soft-refresh hydrate must still stage flashes for value changes —
        // otherwise a sort-driven refresh silently kills Change flash.
        // Field-merge updates so column-window slices do not wipe prior fields.
        const mergedUpdate: unknown[] = [];
        for (const row of update) {
          let id: string;
          try {
            id = state.store.getRowId(row);
          } catch {
            continue;
          }
          const prev = state.store.getById(id) as Record<string, unknown> | undefined;
          const next = row as Record<string, unknown>;
          mergedUpdate.push(prev ? { ...prev, ...next } : row);
        }
        if (state.enableCellChangeFlash && mergedUpdate.length > 0) {
          helpers.stageFlashesForUpdates(mergedUpdate);
        }
        // Calc Stage A / PREV — capture pre-apply rows for updates, then
        // mark dirty so sparse SSRM viewports recompute calculated cols.
        if (mergedUpdate.length > 0 || add.length > 0) {
          state.calc.capturePrevForUpdates(state.store, mergedUpdate, []);
        }
        const results = state.store.apply({ add, update: mergedUpdate });
        state.calc.onTransaction(results);
      }
      // Orphan sweep — a reallocation (rowCount change) wipes every slot
      // and a re-point strands the previous id; rows no slot references
      // are unreachable for paint. Left in place they grew worker memory
      // for the life of a ticking blotter (every count change orphaned
      // the entire hydrated set).
      if (reallocated || repointed) {
        const referenced = new Set(state.ssrmOrder);
        const orphans: string[] = [];
        for (const row of state.store.rows()) {
          const id = state.store.getRowId(row);
          if (!referenced.has(id)) orphans.push(id);
        }
        if (orphans.length > 0) state.store.apply({ remove: orphans });
      }
      state.visibleCache = state.ssrmOrder;
      post({
        id: req.id,
        type: 'rowCount',
        count: state.store.size(),
        visibleCount: state.ssrmRowCount,
      });
      return;
    }

    case 'ssrmEvict': {
      // B-L2 (production hardening) — the v2 controller's LRU dropped these
      // leaf blocks. Before this message the worker store kept the rows
      // forever: the orphan sweep in `ssrmHydrate` only collects rows NO
      // `ssrmOrder` slot references, and an evicted block's slots still
      // pointed at their ids. Net effect on a long-lived blotter was
      // whole-book residency in the worker regardless of
      // `maxCachedLeafBlocks`.
      //
      // Reset every slot still pointing at an evicted id to '' — the same
      // sentinel a never-hydrated slot carries, so the band reads as "not
      // loaded" (blank, and refetched by the next `ensureRange`) rather than
      // as a slot pointing at a row the store no longer has. Deliberately
      // NOT relying on the "evicted rows are outside the loaded band by
      // construction" assumption: that holds for sane configurations but is
      // not guaranteed (a viewport spanning more than `maxCachedLeafBlocks`
      // blocks can evict in-band), and this shape is correct either way.
      const ids = req.payload.rowIds;
      if (ids.length > 0) {
        const evicted = new Set(ids);
        const order = state.ssrmOrder;
        for (let i = 0; i < order.length; i++) {
          const slot = order[i];
          if (slot !== undefined && slot !== '' && evicted.has(slot)) order[i] = '';
        }
        // Only remove rows the store actually holds; `apply` reports the
        // real removals and keeps the calc / flash bookkeeping in step.
        const present: string[] = [];
        for (const id of ids) if (state.store.getById(id) !== undefined) present.push(id);
        if (present.length > 0) {
          const results = state.store.apply({ remove: present });
          state.calc.onTransaction(results);
          state.quickFilter.invalidateRows(evicted);
          state.distinct.invalidateRows(evicted);
          for (const id of present) {
            state.alwaysPassIds.delete(id);
            state.pendingFlashes.delete(id);
          }
        }
      }
      post({
        id: req.id,
        type: 'rowCount',
        count: state.store.size(),
        visibleCount: state.ssrmRowCount,
      });
      return;
    }

    case 'applyTransaction': {
      const { add, update, remove, async: isAsync, heightsByRowId } = req.payload;
      if (isAsync) {
        state.queue.push({ add: add as unknown[], update: update as unknown[], remove, heightsByRowId });
        post({ id: req.id, type: 'transactionFlushed', results: { add: [], update: [], remove: [] } });
      } else {
        // Cycle 4 / Task 11 — diff updates BEFORE apply.
        if (state.enableCellChangeFlash && update && update.length > 0) {
          helpers.stageFlashesForUpdates(update as unknown[]);
        }
        // Cycle 21d / Task 11 — capture pre-apply rows for PREV([col]).
        // Same pre-apply tick point the flash diff uses — flash gates on
        // `enableCellChangeFlash`, PREV gates on the program's
        // `usesPrev` inside the hook itself.
        // Final review Fix 2 — also capture removed rows' pre-apply
        // snapshot for Stage B's delta path (see worker.ts's async
        // flush-fn sibling call site for the full rationale).
        if ((update && update.length > 0) || (remove && remove.length > 0)) {
          state.calc.capturePrevForUpdates(state.store, (update as unknown[]) ?? [], remove ?? []);
        }
        const results = state.store.apply({ add: add as unknown[], update: update as unknown[], remove, heightsByRowId });
        state.calc.onTransaction(results);
        // Cycle 7 / Task 7 — sync transactions need the quick filter
        // aggregate cache invalidated for the touched rows.
        const touched = new Set<string>();
        for (const a of results.add)    touched.add(a.rowId);
        for (const u of results.update) touched.add(u.rowId);
        for (const x of results.remove) touched.add(x.rowId);
        state.quickFilter.invalidateRows(touched);
        state.distinct.invalidateRows(touched);
        // Drop removed rows from the alwaysPass set.
        if (state.alwaysPassIds.size > 0 && remove) {
          for (const id of remove) state.alwaysPassIds.delete(id);
        }
        state.visibleCache = null;
        state.visibleCachePromise = null;
        post({ id: req.id, type: 'transactionFlushed', results });
        const wasPendingSeed = state.pendingDefaultExpandSeed;
        const visCount = await helpers.invalidateAndCount();
        const groupKeys = helpers.isGroupingActive() ? helpers.currentGroupKeys() : undefined;
        // AG parity — the first data may arrive via a transaction, not
        // setRowData; if this rebuild consumed the deferred
        // `groupDefaultExpanded` seed, ship the seeded set so main's
        // expansion mirror stays truthful (same rule as setRowData).
        const expandedKeys = wasPendingSeed && !state.pendingDefaultExpandSeed
          ? (state.expandedKeys === null ? null : Array.from(state.expandedKeys))
          : undefined;
        post({ type: 'modelUpdated', visibleCount: visCount, groupKeys, expandedKeys });
      }
      return;
    }

    case 'setSortModel': {
      state.sort.setModel(req.payload);
      state.visibleCache = null;
      state.visibleCachePromise = null;
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await helpers.invalidateAndCount() });
      return;
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
      state.visibleCachePromise = null;
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await helpers.invalidateAndCount() });
      return;
    }

    case 'setPostSortRowsPresent': {
      // Cycle 8 / Task 4 — flip the post-sort round-trip on or off.
      state.postSortRowsPresent = req.payload.present === true;
      state.visibleCache = null;
      state.visibleCachePromise = null;
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await helpers.invalidateAndCount() });
      return;
    }

    case 'postSortRowsResult': {
      // Cycle 8 / Task 4 — resolve the in-flight pipeline promise.
      const { callId, reordered } = req.payload;
      const resolver = state.pendingPostSortRows.get(callId);
      if (resolver) {
        state.pendingPostSortRows.delete(callId);
        resolver(reordered);
      }
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: state.visibleCache?.length ?? 0 });
      return;
    }

    case 'setEnableCellChangeFlash': {
      // Cycle 4 / Task 11 — runtime mutation.
      state.enableCellChangeFlash = req.payload.enabled === true;
      if (!state.enableCellChangeFlash) state.pendingFlashes.clear();
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: state.visibleCache?.length ?? 0 });
      return;
    }

    case 'setAsyncTransactionOptions': {
      const { waitMillis, conflate, throttleMillis } = req.payload;
      state.queue.setOptions({
        ...(waitMillis !== undefined ? { waitMs: waitMillis } : {}),
        ...(conflate !== undefined ? { conflate } : {}),
        ...(throttleMillis !== undefined ? { throttleMs: throttleMillis } : {}),
      });
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: state.visibleCache?.length ?? 0 });
      return;
    }

    case 'flushAsyncTransactions': {
      state.queue.flush();
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: state.visibleCache?.length ?? 0 });
      return;
    }

    case 'setAggFuncs': {
      // Cycle 14 / Task 3 — replace the custom agg-func layer wholesale.
      // Each entry's `source` is the original function's
      // `Function.prototype.toString()` form; the worker rebuilds the
      // callable via `new Function` in strict-mode.
      const built: Record<string, IAggFunc> = {};
      for (const entry of req.payload.funcs) {
        let fn: unknown;
        try {
          fn = new Function(`"use strict"; return (${entry.source});`)();
        } catch (err) {
          post({
            id: req.id,
            type: 'error',
            error: `[velocity-grid] failed to deserialise aggFunc '${entry.name}': ${
              String((err as Error).message ?? err)
            }`,
          });
          return;
        }
        if (typeof fn !== 'function') {
          post({
            id: req.id,
            type: 'error',
            error: `[velocity-grid] aggFunc '${entry.name}' did not deserialise to a function`,
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
      return;
    }

    case 'setCalcProgram': {
      // Cycle 21d / Task 10 — install / replace / remove the calc program.
      // Reconstruction + smoke eval happen inside CalcProgramStore.install;
      // failures surface through the same error envelope setAggFuncs uses.
      try {
        state.calc.install(req.payload);
      } catch (err) {
        post({ id: req.id, type: 'error', error: String((err as Error).message ?? err) });
        return;
      }
      // Program changes redefine cell values for calc columns — rebuild.
      state.visibleCache = null;
      state.visibleCachePromise = null;
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await helpers.invalidateAndCount() });
      return;
    }

    case 'registerComparator': {
      // Cycle 8 / Task 3 — reconstruct the app's comparator via
      // `new Function` in strict mode.
      const { name, source } = req.payload;
      let fn: unknown;
      try {
        fn = new Function(`"use strict"; return (${source});`)();
      } catch (err) {
        post({
          id: req.id,
          type: 'error',
          error: `[velocity-grid] failed to deserialise comparator '${name}': ${
            String((err as Error).message ?? err)
          }`,
        });
        return;
      }
      if (typeof fn !== 'function') {
        post({
          id: req.id,
          type: 'error',
          error: `[velocity-grid] comparator '${name}' did not deserialise to a function`,
        });
        return;
      }
      state.comparators.register(name, fn as (a: unknown, b: unknown) => number);
      post({
        id: req.id,
        type: 'rowCount',
        count: state.store.size(),
        visibleCount: state.visibleCache?.length ?? 0,
      });
      return;
    }

    case 'flashCells': {
      // Cycle 4 / Task 11 — programmatic flash.
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
      return;
    }
  }
}
