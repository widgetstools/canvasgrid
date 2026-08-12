// Cycle 19 / Task 6 — filter handler.
//
// Owns the filter model + quick / external / alwaysPass filter slice
// of the worker protocol:
//   setFilterModel, setQuickFilter,
//   setExternalFilterPresent, setAlwaysPassRowIds, externalFilterResult,
//   refilter, getDistinctValues.

import type { HandlerCtx } from '../dispatch';
import { invalidateVisibleModel } from '../visibleModel';
import type { WorkerRequest } from '../protocol';

export type FilterRequest = Extract<WorkerRequest, {
  type:
    | 'setFilterModel'
    | 'setQuickFilter'
    | 'setExternalFilterPresent'
    | 'setAlwaysPassRowIds'
    | 'externalFilterResult'
    | 'refilter'
    | 'getDistinctValues';
}>;

export async function handleFilter(
  ctx: HandlerCtx,
  req: FilterRequest,
): Promise<void> {
  const { state, post, helpers } = ctx;
  switch (req.type) {
    case 'setFilterModel': {
      state.filter.setModel(req.payload);
      invalidateVisibleModel(state);
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await helpers.invalidateAndCount() });
      return;
    }

    case 'setQuickFilter': {
      const { terms, cacheQuickFilter, colIds } = req.payload;
      state.quickFilter.setCacheEnabled(cacheQuickFilter);
      state.quickFilter.setColIds(colIds);
      state.quickFilter.setTerms(terms);
      invalidateVisibleModel(state);
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await helpers.invalidateAndCount() });
      return;
    }

    case 'setExternalFilterPresent': {
      // Cycle 7 / Task 8 — flip the round-trip on or off and re-evaluate.
      state.externalFilterPresent = req.payload.present === true;
      invalidateVisibleModel(state);
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await helpers.invalidateAndCount() });
      return;
    }

    case 'setAlwaysPassRowIds': {
      // Cycle 7 / Task 8 — replace the alwaysPass set wholesale.
      state.alwaysPassIds = new Set(req.payload.rowIds);
      invalidateVisibleModel(state);
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await helpers.invalidateAndCount() });
      return;
    }

    case 'externalFilterResult': {
      // Cycle 7 / Task 8 — main has run the per-row predicate. Resolve
      // the in-flight pipeline promise keyed by callId.
      const { callId, surviving } = req.payload;
      const resolver = state.pendingExternalFilters.get(callId);
      if (resolver) {
        state.pendingExternalFilters.delete(callId);
        resolver(surviving);
      }
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: state.visibleCache?.length ?? 0 });
      return;
    }

    case 'refilter': {
      // Cycle 7 / Task 8 — re-run the pipeline against the current
      // model without changing column / quick / sort state.
      invalidateVisibleModel(state);
      post({ id: req.id, type: 'rowCount', count: state.store.size(), visibleCount: await helpers.invalidateAndCount() });
      return;
    }

    case 'getDistinctValues': {
      // Cycle 7 / Task 9 — derive (or read the cached) distinct
      // stringified value set for `colId`.
      // Cycle 21d / Task 13 — `limit` truncates AFTER the cache walk:
      // the DistinctValuesPass cache keeps the full set so requests
      // with different limits reuse one derivation.
      const values = state.distinct.getValues(req.payload.colId);
      const limit = req.payload.limit;
      post({
        id: req.id,
        type: 'distinctValuesResult',
        values: limit !== undefined && limit < values.length ? values.slice(0, limit) : values,
      });
      return;
    }
  }
}
