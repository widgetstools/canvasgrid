// Cycle 19 / Task 6 — worker-side state interface.
//
// Extracted from `worker.ts` so the per-domain handler modules
// (`worker/handlers/*.ts`) + the dispatch primitives (`dispatch.ts`)
// can reference the same `State` shape without importing `worker.ts`
// (which imports the handlers back).
//
// The interface is unchanged from the pre-Task-6 shape — this is a
// pure type-move. The concrete object is still constructed inside
// `worker.ts::initHost`.

import type {
  RowStore, FilterPass, SortPass, AggPass, GroupPass, ViewportSlicer,
  TransactionQueue, QuickFilterPass, DistinctValuesPass, PivotPass,
} from './dataPipeline';
import type { GroupPassOutput } from './passes/groupPass';
import type { PivotPassOutput } from './passes/pivotPass';
import type { WorkerColumn } from './protocol';
import type { MeasureCache } from './measureText';
import type { ComparatorRegistry } from './comparatorRegistry';
import type { AggFuncRegistry } from './aggFuncRegistry';

export interface State {
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
  /** Cycle 15 / Task 1 — hierarchical row grouping. */
  group: GroupPass;
  /** Cycle 15 / Task 1 — last `GroupPass.apply` result. */
  groupOutput: GroupPassOutput | null;
  /** Cycle 18 / Task 3 — pivot engine. */
  pivot: PivotPass;
  /** Cycle 18 / Task 3 — post-filter (pre-sort) rowId set. */
  pivotInputIds: readonly string[] | null;
  /** Cycle 18 / Task 8d — last `PivotPass.apply` result. */
  pivotOut: PivotPassOutput | null;
  /** Cycle 15 / Task 8 — snapshot of the rowId array fed into the most
   *  recent `GroupPass.apply`. */
  groupInputIds: readonly string[] | null;
  /** Cycle 15 / Task 8 — when true every `groupKeysSnapshot` reply
   *  carries the parallel `groupDescendants: string[][]` array. */
  emitGroupDescendants: boolean;
  /** Cycle 15 / Task 7 — persistent expanded-key set. `null` is the
   *  "default = every group expanded" sentinel. */
  expandedKeys: Set<string> | null;
  /** Cycle 15 / Task 10 — `showOpenedGroup` option captured at init. */
  showOpenedGroup: boolean;
  /** Cycle 15.5 / Task 4 — `groupHideOpenParents` option captured at init. */
  groupHideOpenParents: boolean;
  /** Cycle 8 / Task 3 — named comparators. */
  comparators: ComparatorRegistry;
  /** Cycle 14 / Task 3 — named column-aggregation registry. */
  aggFuncs: AggFuncRegistry;
  agg: AggPass;
  slicer: ViewportSlicer;
  queue: TransactionQueue;
  columns: WorkerColumn[];
  visibleCache: string[] | null;
  /** Cache of `(font|width|text)` → wrapped-text-height. Bounded LRU. */
  measureCache: MeasureCache;
  /** Pending fallback batches keyed by `batchId`. */
  pendingFallbacks: Map<number, (heights: Float32Array) => void>;
  nextBatchId: number;
  /** Cycle 7 / Task 8 — external-filter round-trip flag. */
  externalFilterPresent: boolean;
  /** Cycle 7 / Task 8 — rowIds that bypass every filter. */
  alwaysPassIds: Set<string>;
  /** Cycle 7 / Task 8 — pending external-filter round-trips. */
  pendingExternalFilters: Map<number, (surviving: string[]) => void>;
  /** Cycle 7 / Task 8 — monotonic counter for external-filter callIds. */
  nextExternalFilterCallId: number;
  /** Cycle 8 / Task 4 — post-sort round-trip flag. */
  postSortRowsPresent: boolean;
  /** Cycle 8 / Task 4 — pending post-sort round-trips. */
  pendingPostSortRows: Map<number, (reordered: string[]) => void>;
  /** Cycle 8 / Task 4 — monotonic counter for post-sort callIds. */
  nextPostSortRowsCallId: number;
  /** Cycle 4 / Task 11 — cell-flash diffs. */
  enableCellChangeFlash: boolean;
  /** Cycle 4 / Task 11 — staged changed-field set per rowId. */
  pendingFlashes: Map<string, Set<string>>;
}
