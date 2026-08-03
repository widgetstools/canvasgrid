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
import type { CalcProgramStore } from './passes/calcPass';
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
  /** SSRM mode — sparse hydrate is active. */
  ssrmActive: boolean;
  /**
   * When true with `ssrmActive`, `buildVisibleAsync` runs the full CSRM
   * pipeline (filter → group → pivot → sort → agg) over hydrated store
   * rows instead of returning raw `ssrmOrder`. Used so SSRM can host
   * grouping, subtotals, pivot, client sort/filter, etc. after the book
   * (or route) is fully hydrated.
   */
  ssrmClientPipeline: boolean;
  /** Sparse visible order; `''` = unloaded placeholder slot. */
  ssrmOrder: string[];
  ssrmRowCount: number;
  /**
   * A sparse hydrate carried `__ssrm` group rows. Gates the sticky-ancestor
   * scan on the sparse path — the worker group model is never shipped there
   * (GroupPass stays off; the host owns grouping), so `state.group` can't
   * be the signal. Reset on `reset` hydrates and on leaving SSRM.
   */
  ssrmGroupMetaSeen: boolean;
  /** Sparse SSRM v2 — host-computed grand totals keyed by FIELD (skeleton
   *  root aggregates). When set, getViewport ships these as `chunk.totals`
   *  instead of AggPass output (which only sees hydrated rows). */
  ssrmGrandTotals: Record<string, unknown> | null;
  /** AG `groupMaintainOrder` — sorts never re-order group rows. */
  groupMaintainOrder: boolean;
  /** AG `groupAggFiltering` — filters evaluate group aggregates. */
  groupAggFiltering: boolean;
  /** AG parity — `groupDefaultExpanded` seeded against an EMPTY tree (the
   *  group model landed before any data). The next non-empty tree build
   *  re-seeds the defaults. */
  pendingDefaultExpandSeed: boolean;
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
  /** Damage-region rendering (Task 3) — rowIds touched by a transaction
   *  since the last slice that included them, staged for the next
   *  `getViewport`'s `ViewportChunk.touchedRows`. Drained per-rowId in the
   *  `getViewport` handler the same way `pendingFlashes` drains per-field
   *  (mirrors its lifecycle line-for-line); wiped wholesale wherever
   *  `pendingFlashes` is wiped wholesale (e.g. `setRowData`). Unlike
   *  `pendingFlashes` this is NOT gated by `enableCellChangeFlash` — damage
   *  tracking is independent of the cell-flash feature. */
  pendingTouched: Set<string>;
  /** Cycle 21d / Task 10 — calculated-column program store. Always
   *  constructed (no-program = inert); CalcPass stages gate on
   *  `calc.hasProgram()` so absent programs cost nothing. */
  calc: CalcProgramStore;
}
