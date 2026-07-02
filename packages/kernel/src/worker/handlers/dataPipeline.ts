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

export type DataPipelineRequest = Extract<WorkerRequest, {
  type:
    | 'setRowData'
    | 'applyTransaction'
    | 'updateColumns'
    | 'setEnableCellChangeFlash'
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
    case 'setRowData': {
      state.store.setAll(req.payload.rows as unknown[], req.payload.heightsByRowId);
      // Cycle 7 / Task 8 — a full data replace invalidates any
      // alwaysPass set computed against the previous data.
      state.alwaysPassIds.clear();
      // Cycle 7 / Task 9 — a full data replace also invalidates
      // the per-column distinct caches.
      state.distinct.invalidateRows([]);
      // Cycle 4 / Task 11 — wipe pendingFlashes.
      state.pendingFlashes.clear();
      state.visibleCache = null;
      const visibleCount = await helpers.invalidateAndCount();
      // Cycle 15 / Task 7 — ride the groupKeys snapshot back on the
      // same reply so `knownGroupKeys` stays in sync.
      const groupKeys = helpers.isGroupingActive() ? helpers.currentGroupKeys() : undefined;
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount, groupKeys });
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
        const results = state.store.apply({ add: add as unknown[], update: update as unknown[], remove, heightsByRowId });
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
        post({ id: req.id, type: 'transactionFlushed', results });
        const visCount = await helpers.invalidateAndCount();
        const groupKeys = helpers.isGroupingActive() ? helpers.currentGroupKeys() : undefined;
        post({ type: 'modelUpdated', visibleCount: visCount, groupKeys });
      }
      return;
    }

    case 'setSortModel': {
      state.sort.setModel(req.payload);
      state.visibleCache = null;
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
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await helpers.invalidateAndCount() });
      return;
    }

    case 'setPostSortRowsPresent': {
      // Cycle 8 / Task 4 — flip the post-sort round-trip on or off.
      state.postSortRowsPresent = req.payload.present === true;
      state.visibleCache = null;
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
            error: `[cgrid] failed to deserialise aggFunc '${entry.name}': ${
              String((err as Error).message ?? err)
            }`,
          });
          return;
        }
        if (typeof fn !== 'function') {
          post({
            id: req.id,
            type: 'error',
            error: `[cgrid] aggFunc '${entry.name}' did not deserialise to a function`,
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
          error: `[cgrid] failed to deserialise comparator '${name}': ${
            String((err as Error).message ?? err)
          }`,
        });
        return;
      }
      if (typeof fn !== 'function') {
        post({
          id: req.id,
          type: 'error',
          error: `[cgrid] comparator '${name}' did not deserialise to a function`,
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
