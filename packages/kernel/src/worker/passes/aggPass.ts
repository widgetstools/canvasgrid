/**
 * Cycle 14 / Task 3 — column-totals aggregation pass.
 *
 * Reads each column's aggFunc declaration (`'sum' | 'p99' | ['p99',
 * 'avg'] | …`), resolves it against the worker's `AggFuncRegistry`, and
 * applies the matched function to the filtered column values. Emits one
 * `chunk.totals[colId]` entry per column whose aggFunc resolves.
 *
 * **Where the math lives.** The numeric built-ins (`sum / avg / min /
 * max / count`) delegate to `aggMath.aggregate()` via the registry —
 * the single source of truth shared with the status panel's
 * `agAggregationComponent` (Cycle 13 / Task 3). Custom functions are
 * arbitrary `IAggFunc` callables that take `{ values, colId }` and
 * return whatever single value the totals cell renderer should display.
 *
 * **Performance.** One pass per column over the filtered row set, no
 * allocation per row beyond the values array fed into the registered
 * function. The totals computation is amortised against the existing
 * data pass that the worker already runs per `getViewport`. No extra
 * worker round-trip per scroll — `chunk.totals` rides the same
 * viewport reply that ships `numericCols` + `textCols`.
 *
 * **Lifecycle.** Constructed once at worker init, reused thereafter.
 * `setColumns` swaps the column list (used by `updateColumns`), and the
 * registry instance is owned by the worker State so a `setAggFuncs`
 * message takes effect on the very next `apply`.
 */

import type { RowStore } from '../dataPipeline';
import type { WorkerColumn } from '../protocol';
import type { AggFuncRegistry } from '../aggFuncRegistry';
import type { GroupNode, GroupPassOutput } from './groupPass';
import { readWorkerCellValue } from '../readCellValue';

interface AggCol {
  colId: string;
  field: string;
  col: WorkerColumn;
  /** Carried verbatim from the WorkerColumn — single name or fallback
   *  list. Resolved against the registry on every `apply` so a runtime
   *  `setAggFuncs` flip lights up without a column-metadata reship. */
  agg: string | string[];
}

/** A-P1 — the inputs a memoized aggregation result was computed from.
 *  Every one of them is either an object identity the producer replaces
 *  wholesale on change, or a monotonic revision its owner bumps on every
 *  mutation, so an equal key provably implies an equal result. */
interface AggCacheKey {
  /** Row-data revision (`RowStore.revision()`). */
  storeRev: number;
  /** Registered-aggFunc revision (`AggFuncRegistry.revision()`). */
  registryRev: number;
  /** `AggPass.setColumns` revision — the resolved `aggCols` list. */
  colsRev: number;
}

export class AggPass<TRow = any> {
  private aggCols: AggCol[] = [];
  /** A-P1 — bumped by `setColumns` (see `AggCacheKey`). */
  private colsRev = 0;
  /**
   * A-P1 (production hardening) — memo for the grand-total pass.
   *
   * `getViewport` called `apply(visIds)` unconditionally on EVERY viewport
   * fetch, so a pure scroll over an idle 1M-row grid re-read every visible
   * row per column per frame. The result is a pure function of
   * (`inputIds` contents, store row data, resolved agg columns, registry),
   * so a key over the input array's identity plus the three revision
   * counters is exact.
   *
   * Why identity is sound for `inputIds`: the pipeline REPLACES
   * `state.visibleCache` / `state.groupInputIds` with a fresh array on
   * every rebuild. The one array the worker mutates in place is
   * `state.ssrmOrder` (sparse SSRM hydrate / evict) — and every in-place
   * slot write there is accompanied by a `store.setAll` / `store.apply`
   * (or, when it is not, only rewrites slots whose ids the store does not
   * hold, which contribute nothing to the aggregate either way), so
   * `storeRev` covers it.
   */
  private grandCache: { inputIds: readonly string[]; key: AggCacheKey; result: { totals: Record<string, unknown> } } | null = null;
  /** A-P1 — memo for the per-group pass. Same key discipline as
   *  `grandCache`, plus the `GroupPassOutput` identity (the pipeline
   *  replaces it wholesale on every build — `worker.ts` `buildVisibleAsync`
   *  assigns `state.groupOutput` from `GroupPass.apply` /
   *  `SortPass.applyGrouped` and never mutates it in place). */
  private groupCache: {
    inputIds: readonly string[];
    groupOutput: GroupPassOutput;
    key: AggCacheKey;
    result: { groupTotals: Record<string, Record<string, unknown>> };
  } | null = null;

  constructor(
    private store: RowStore<TRow>,
    columns: WorkerColumn[],
    private registry: AggFuncRegistry,
  ) {
    this.setColumns(columns);
  }

  setColumns(columns: WorkerColumn[]): void {
    this.colsRev++;
    this.aggCols = [];
    for (const col of columns) {
      if (col.aggFunc && (col.field || col.valueGetter)) {
        this.aggCols.push({ colId: col.colId, field: col.field ?? col.colId, agg: col.aggFunc, col });
      }
    }
  }

  /** A-P1 — snapshot the revision triple the memos key on. */
  private cacheKey(): AggCacheKey {
    return {
      storeRev: this.store.revision(),
      registryRev: this.registry.revision(),
      colsRev: this.colsRev,
    };
  }

  private static keyEq(a: AggCacheKey, b: AggCacheKey): boolean {
    return a.storeRev === b.storeRev
      && a.registryRev === b.registryRev
      && a.colsRev === b.colsRev;
  }

  /** Apply each column's aggFunc to its filtered values and return the
   *  per-column totals. Columns whose aggFunc fails to resolve (unknown
   *  name, all entries unregistered) emit no entry — the totals row
   *  paints the cell empty for that column. */
  apply(inputIds: readonly string[]): { totals: Record<string, unknown> } {
    // A-P1 — serve the memo when nothing this pass reads has changed.
    const key = this.cacheKey();
    const cached = this.grandCache;
    if (cached !== null && cached.inputIds === inputIds && AggPass.keyEq(cached.key, key)) {
      return cached.result;
    }
    const totals: Record<string, unknown> = {};
    for (const { colId, col, agg } of this.aggCols) {
      const fn = this.registry.resolve(agg);
      if (!fn) continue;
      const values: unknown[] = [];
      for (const id of inputIds) {
        const row = this.store.getById(id);
        if (!row) continue;
        values.push(readWorkerCellValue(row, col));
      }
      let result: unknown;
      try {
        result = fn({ values, colId });
      } catch {
        // A misbehaving custom aggFunc should NOT bring down the whole
        // viewport pass — leave the column's totals entry empty so the
        // totals row paints the cell blank and the rest of the chunk
        // still ships.
        continue;
      }
      // `undefined` would be dropped by structured-clone across
      // postMessage; normalise to `null` so the chunk.totals record is
      // round-trip safe.
      totals[colId] = result === undefined ? null : result;
    }
    const out = { totals };
    this.grandCache = { inputIds, key, result: out };
    return out;
  }

  /** Cycle 15 / Task 12 — compute per-group totals over a `GroupPass`
   *  tree. Walks `roots` bottom-up: at each leaf group we read the
   *  descendant rowIds via the group's `childIndices` (which index
   *  into `inputIds` — the same post-filter rowId array the slicer
   *  references); at each non-leaf group we recurse into children
   *  and concatenate their descendant rowId lists.
   *
   *  Returns `groupTotals` keyed by `GroupNode.key` — the same
   *  composite key `flatOrder` footer entries carry and
   *  `chunk.groupKey[i]` ships to main. Each entry is the same
   *  `Record<colId, value>` shape as the grand-total `apply()`
   *  produces, so cgrid resolves a footer cell the same way it
   *  resolves a totals cell:
   *    `chunk.groupTotals[groupKey][colId]`.
   *
   *  **Cost.** One pass per leaf group over its `childIndices`
   *  (cheap — the indices are already there) plus the per-group
   *  rowId array materialisation. Non-leaf groups are computed by
   *  concatenating their descendants' rowId arrays via a tree walk
   *  (each leaf row index touched once per ancestor group, so
   *  `O(N × depth)` total). For 1 M rows × 3 cols × ~450 leaf
   *  groups the walk runs in single-digit ms — well under the
   *  worker's per-viewport budget. Cheaper than re-running the
   *  filter pipeline once per group.
   *
   *  **Bypass.** Returns an empty `groupTotals` map when
   *  `groupOutput.bypassed` is `true` (grouping inactive) OR when
   *  there are no resolved agg columns (every column's aggFunc
   *  failed to resolve). Both fast paths skip every allocation
   *  beyond the empty record. */
  applyGroups(
    inputIds: readonly string[],
    groupOutput: GroupPassOutput,
  ): { groupTotals: Record<string, Record<string, unknown>> } {
    // A-P1 — serve the memo when nothing this pass reads has changed. The
    // three trivial early-outs below stay uncached: they allocate one empty
    // record and do no per-row work, so memoizing them would buy nothing.
    const key = this.cacheKey();
    const cachedGroups = this.groupCache;
    if (
      cachedGroups !== null
      && cachedGroups.inputIds === inputIds
      && cachedGroups.groupOutput === groupOutput
      && AggPass.keyEq(cachedGroups.key, key)
    ) {
      return cachedGroups.result;
    }
    const groupTotals: Record<string, Record<string, unknown>> = {};
    if (groupOutput.bypassed) return { groupTotals };
    if (this.aggCols.length === 0) return { groupTotals };

    // Pre-resolve every column's agg function once. Columns whose agg
    // doesn't resolve simply contribute no entry to any group's totals
    // record (matches the grand-total `apply()` behaviour). Caching
    // outside the per-group loop keeps the registry untouched in the
    // hot path.
    const resolved: Array<{ colId: string; col: WorkerColumn; fn: (params: { values: unknown[]; colId: string; rowNode?: { data?: unknown; key?: string } }) => unknown }> = [];
    for (const ac of this.aggCols) {
      const fn = this.registry.resolve(ac.agg);
      if (!fn) continue;
      resolved.push({ colId: ac.colId, col: ac.col, fn });
    }
    if (resolved.length === 0) return { groupTotals };

    const computeFor = (groupKey: string, descendantIds: readonly string[]): void => {
      const totals: Record<string, unknown> = {};
      for (const { colId, col, fn } of resolved) {
        const values: unknown[] = [];
        for (const id of descendantIds) {
          const row = this.store.getById(id);
          if (!row) continue;
          values.push(readWorkerCellValue(row, col));
        }
        let result: unknown;
        try {
          // `IAggFuncParams.rowNode.key` carries the composite group key
          // — apps can dispatch per-group via this slot (e.g. a custom
          // `weightedSum` that needs to know which bucket it's
          // computing for). For grand totals (`groupKey === ''`)
          // `rowNode` is undefined, matching the grand-total path's
          // contract.
          result = fn({
            values,
            colId,
            rowNode: groupKey === '' ? undefined : { key: groupKey },
          });
        } catch {
          continue;
        }
        totals[colId] = result === undefined ? null : result;
      }
      groupTotals[groupKey] = totals;
    };

    // Materialise descendant rowIds per group via a bottom-up walk.
    // Leaf groups read directly from `childIndices`; non-leaf groups
    // concatenate their children's lists. We compute the totals for
    // each group as we exit its frame so the rowId arrays bubble up
    // naturally — single tree walk, every node's totals written exactly
    // once.
    const collectDescendantIds = (node: GroupNode): string[] => {
      if (node.childGroups.length === 0) {
        const idxs = node.childIndices;
        const out: string[] = new Array(idxs.length);
        for (let i = 0; i < idxs.length; i++) {
          out[i] = inputIds[idxs[i]!]!;
        }
        return out;
      }
      const out: string[] = [];
      for (const child of node.childGroups) {
        const childIds = collectDescendantIds(child);
        computeFor(child.key, childIds);
        for (const id of childIds) out.push(id);
      }
      return out;
    };
    for (const root of groupOutput.roots) {
      const rootIds = collectDescendantIds(root);
      computeFor(root.key, rootIds);
    }

    const out = { groupTotals };
    this.groupCache = { inputIds, groupOutput, key, result: out };
    return out;
  }
}
