// Cycle 21d / Task 10 — worker-side calc program store.
//
// Owns the reconstruction of the calculated-column interpreter + delta
// aggregate factories shipped from @wellsfargo-starui/velocity-grid-calc's bridge as source text
// (Function.prototype.toString() forms) via the setCalcProgram protocol
// message. Reconstruction mirrors the setAggFuncs / registerComparator
// `new Function` idiom in handlers/dataPipeline.ts — same CSP caveat,
// same "source is static, never user input" trust boundary.
//
// Cycle 21d / Task 11 — CalcPass Stage A. Row-local calc columns
// (`prePass: []` — no aggregate dependency) are materialised into a
// per-column value cache BEFORE filter/sort/group/slice read them, so
// a calc column behaves like an ordinary (fieldless) `WorkerColumn` to
// every downstream pass via the `CalcValueSource` seam those passes
// consult. Stage B (aggregate-dependent calc columns) lands in Task 12
// and writes into the SAME `values` cache — Stage A only ever touches
// row-local columns (`prePass.length === 0`).
//
// Cycle 21d / Task 12 — CalcPass Stage B. Aggregate-dependent calc
// columns (`prePass.length > 0`) compute one scalar per SCOPE INSTANCE
// (all / visible / one-per-group / one-per-parent-group), then evaluate
// the per-row program with `aggSlots[spec.slot] = scope's finalized
// scalar`. Runs AFTER GroupPass (scopes are defined by the tree) and
// BEFORE SortPass (sort sees fresh Stage-B values) — see the `worker.ts`
// pipeline slot. Scope-key + per-scope data-version canonicalization
// mirrors `packages/calc/src/scopeKey.ts`'s `scopeKeyOf` / `DataVersionMap`
// semantics, reimplemented NATIVELY here (coordinator decision: no
// SCOPE_KEY_SOURCE/DATA_VERSION_MAP_SOURCE shipped over the wire — the
// kernel has zero runtime @wellsfargo-starui/velocity-grid-calc imports). Delta-aggregate state is
// cached per scope instance keyed `(fn, colId, scopeKey)` with the
// current row-group-colId signature folded into group/parent scope keys,
// so a regroup naturally orphans every stale group/parent entry; a
// wholesale `aggStates.clear()` on any non-'delta' pipeline cause (full
// recompute, program swap, setRowData) keeps those orphans from
// accumulating instead of relying on a prefix-bump sweep.

import type { RowStore } from '../dataPipeline';
import type { WorkerCalcProgram } from '../protocol';
import type { GroupNode, GroupPassOutput } from './groupPass';
import { escapeGroupKeySegment } from '../../core/ssrmRowMeta';

/** Cycle 21d / Task 11 — the seam FilterPass / SortPass / GroupPass /
 *  both slicers consult for fieldless calc columns. `CalcProgramStore`
 *  implements this; Task 12's Stage B writes into the same underlying
 *  value cache so the seam's shape never has to change. */
export interface CalcValueSource {
  isCalcCol(colId: string): boolean;
  valueAt(rowId: string, colId: string): unknown;
}

/** Sentinel passed to the interpreter for row-local (Stage A) columns —
 *  they have no prePass aggregate dependency, so `aggSlots` is always
 *  empty. Shared instance (never mutated) avoids a fresh allocation
 *  per row per pass. */
const EMPTY_SLOTS: ReadonlyArray<number | null> = [];

export type CalcInterpreter = (
  ast: unknown,
  row: Record<string, unknown>,
  aggSlots: ReadonlyArray<number | null>,
  prevLookup: ((colId: string) => unknown) | null,
) => unknown;

export type CalcAggregateFactory = () => {
  init(): unknown;
  addRow(state: unknown, value: unknown): unknown;
  removeRow(state: unknown, value: unknown): unknown;
  updateRow(state: unknown, oldValue: unknown, newValue: unknown): unknown;
  finalize(state: unknown): number | null;
};

/** Cycle 21d / Task 12 — one cached scope-instance's delta-aggregate
 *  state. `impl` is the reconstructed factory's instance methods
 *  (`{ init, addRow, removeRow, updateRow, finalize }` — the Task 5
 *  cross-task delta contract); `state` is whatever `impl.init()`
 *  returned, mutated in place by `addRow`/`removeRow`/`updateRow` per
 *  the factory's own convention (some factories return a NEW state,
 *  others mutate and return the same reference — Stage B always
 *  reassigns `entry.state = impl.xxxRow(...)` so both conventions work).
 *  `dataVersion` bumps on every delta touch; `finalized` is the memoized
 *  `impl.finalize(state)` scalar, recomputed only when a touch bumped
 *  the version.
 *
 *  **`impl: null` — the FIRST/LAST stub form.** FIRST/LAST are NOT
 *  registry factory impls by design (assembler addition — the registry
 *  has no entry for them), so their entries carry NO factory instance
 *  and NO delta state: `state` stays `null`, delta events only bump
 *  `dataVersion`, and `finalized` is always produced by `firstLastScan`
 *  (an O(scope) order-aware rescan) at every full rebuild AND every
 *  delta touch. */
interface AggStateEntry {
  state: unknown;
  impl: ReturnType<CalcAggregateFactory> | null;
  dataVersion: number;
  finalized: number | null;
}

/** FIRST/LAST are NOT delta-contract registry impls (assembler addition,
 *  spec cross-task contract) — Stage B computes them directly as a scan
 *  over the scope's rows in scope iteration order, skipping nulls.
 *  Recomputed on every version bump (O(scope) cost; no delta state).
 *  Case-insensitive match — the AggSpec's `fn` string ships verbatim
 *  from @wellsfargo-starui/velocity-grid-calc's transform output (Task 2's shippable set uses
 *  upper-case `FIRST`/`LAST`; tests here use lower-case for brevity). */
function isFirstLast(fn: string): 'first' | 'last' | null {
  const lower = fn.toLowerCase();
  return lower === 'first' || lower === 'last' ? lower : null;
}

/** Final review Fix 1 — parameterized lookup grammar: `NAME(p)`, mirroring
 *  `packages/calc/src/aggregates/registry.ts`'s `PARAM_NAME_RE` /
 *  `getAggregate` exactly (reimplemented natively here per the kernel's
 *  zero-runtime-@wellsfargo-starui/velocity-grid-calc-imports constraint). The transform emits
 *  parameterized fn strings like `'PERCENTILE(95)'`
 *  (`packages/calc/src/aggTransform.ts:151`), but `aggregateSources` ships
 *  the BASE factory name only (`'PERCENTILE'`) — the registry's arity
 *  convention (a rebuilt factory with `length >= 1` is parameterized) means
 *  the worker must parse the `(p)` suffix itself and call `factory(p)`. */
const PARAM_NAME_RE = /^([A-Za-z_][A-Za-z0-9_]*)\((-?\d+(?:\.\d+)?)\)$/;

/** Resolve `fn` (verbatim from the AggSpec — may be a bare name like
 *  `'SUM'`/`'MEDIAN'` or a parameterized `'NAME(p)'` like `'PERCENTILE(95)'`)
 *  against `factories` (keyed by BASE name only). Returns the constructed
 *  `Aggregate` impl, or `undefined` when unresolved (bare name not in
 *  `factories`, OR a `NAME(p)` suffix whose base name isn't in `factories`,
 *  OR a malformed/non-finite `p`). Mirrors `registry.ts#getAggregate`'s
 *  exact/parameterized dispatch, minus the `parameterized` flag the
 *  registry entry carries (the kernel has no such metadata over the wire —
 *  arity convention alone: a bare name always resolves via `factory()`
 *  zero-arg per the landed convention; a `NAME(p)` suffix always resolves
 *  via `factory(p)`). */
function resolveAggregateFactory(
  factories: Map<string, CalcAggregateFactory>,
  fn: string,
): ReturnType<CalcAggregateFactory> | undefined {
  const exact = factories.get(fn);
  if (exact !== undefined) return exact();
  const m = PARAM_NAME_RE.exec(fn);
  if (m === null) return undefined;
  const baseName = m[1] as string;
  const base = factories.get(baseName);
  if (base === undefined) return undefined;
  const p = Number(m[2] as string);
  if (!Number.isFinite(p)) return undefined;
  // `CalcAggregateFactory` is typed as a 0-arg `() => Aggregate` impl, but
  // the reconstructed function is the ORIGINAL factory source
  // (`new Function` round-trip of e.g. `makePercentile`) — parameterized
  // factories declare `(p)`, so call through with the parsed p (arity
  // convention landed in registry.ts / worker.ts's Task-10 precedent).
  return (base as unknown as (p: number) => ReturnType<CalcAggregateFactory>)(p);
}

export class CalcProgramStore implements CalcValueSource {
  private program: WorkerCalcProgram | null = null;
  private interp: CalcInterpreter | null = null;
  private factories = new Map<string, CalcAggregateFactory>();
  private colIndex = new Map<string, WorkerCalcProgram['columns'][number]>();
  /** colId → rowId → computed value. Shared with Task 12's Stage B
   *  writes — Stage A only ever writes row-local (`prePass: []`)
   *  columns; Stage B's aggregate-dependent columns land in the same
   *  map keyed by their own colId. */
  private values = new Map<string, Map<string, unknown>>();
  /** `'full'` — every row-local column needs recompute for every row
   *  (fresh install / setRowData). A `Set<string>` — only those rowIds
   *  are dirty (transaction add/update). Cleared to an empty `Set` at
   *  the end of every `ensureStageA` pass (tick-scoped consumption). */
  private stageADirty: 'full' | Set<string> = 'full';
  /** rowId → pre-apply row snapshot, captured by `capturePrevForUpdates`
   *  BEFORE `store.apply` runs. Consumed (and cleared) inside the
   *  `ensureStageA` pass that recomputes the just-updated rows — a
   *  documented divergence from `pendingFlashes` (which clears at
   *  slice/paint time): PREV is a compute-time concern, so it clears at
   *  the compute site instead. */
  private tickPrevRows = new Map<string, unknown>();
  /** Stage B's OWN pre-apply row snapshot — kept separate from
   *  `tickPrevRows` because Stage A (which runs FIRST in the same
   *  pipeline pass, per `worker.ts`'s `buildVisibleAsync`) consumes and
   *  clears `tickPrevRows` before Stage B ever runs. Populated
   *  unconditionally by `capturePrevForUpdates` whenever any installed
   *  column has `prePass.length > 0` (independent of Stage A's
   *  `usesPrev` gate) — the delta path needs the OLD row to detect a
   *  cross-group move (old group key vs new) and to feed `updateRow`'s
   *  `oldValue` argument. Consumed (and cleared) inside `ensureStageB`. */
  private tickPrevRowsB = new Map<string, unknown>();

  // ─── Stage B (Cycle 21d / Task 12) ─────────────────────────────────────

  /** `(fn, colId, scopeKey)` → cached delta-aggregate state. `scopeKey`
   *  already embeds the group signature for `'group'`/`'parent'` scopes
   *  (see `scopeKeyFor`), so a regroup's key change alone would orphan
   *  stale entries even without the wholesale clear below — the clear is
   *  belt-and-suspenders against orphan accumulation across many
   *  regroups in one session. */
  private aggStates = new Map<string, AggStateEntry>();
  /** `'delta'` — the pipeline pass immediately following an
   *  `onTransaction` call; `ensureStageB` reuses cached entries and only
   *  touches the transaction's affected scopes. Every other pass
   *  (`install`, `onSetRowData`, and the default after `ensureStageB`
   *  consumes a 'delta' pass) is `'full'` — full scope rebuild. */
  private pipelineCause: 'delta' | 'full' = 'full';
  /** rowId → leaf group key, as of the LAST `ensureStageB` full/delta
   *  walk — membership lookup for delta removes (pre-transaction
   *  membership) and for resolving a row's per-row scope during
   *  per-row eval. Empty when grouping is bypassed. */
  private rowScopeKey = new Map<string, string>();
  /** group key → parent group key, or `''` for a root group's parent
   *  (the visible/all set — see `parentScopeKeyFor`). Populated by the
   *  same tree walk that fills `rowScopeKey`. */
  private parentOfGroup = new Map<string, string>();
  /** Current row-group colId signature (`rowGroupCols.join('')`, `''`
   *  when bypassed) — folded into every `'group:'`/`'parent:'` scope key
   *  so a regroup naturally invalidates every group/parent cache entry
   *  (mirrors `packages/calc/src/scopeKey.ts`'s documented risk-table
   *  requirement without shipping that module's source). */
  private groupSignature = '';
  /** Last transaction's results, consumed by the very next `ensureStageB`
   *  delta pass then cleared — mirrors `stageADirty`'s tick-scoped
   *  consumption. `null` when there's no pending delta to apply. */
  private lastDelta: { add: string[]; update: string[]; remove: string[] } | null = null;
  /** Final review Fix 3 — the LAST completed `ensureStageB` pass's
   *  `postFilterIds`, as a Set — used to detect whether a delta-touched
   *  row's FILTER membership changed since that pass (entered or left
   *  the filtered/visible set). A pure add/removeRow delta can't
   *  correctly synthesize an enter/leave transition (the row's OLD
   *  contribution to 'visible'/group scopes was never fed in, so there's
   *  nothing to remove; conversely a row that leaves needs its
   *  contribution un-fed without ever having had an addRow paired to
   *  it). The robust-simple fix: when any touched row's membership
   *  changed, force this pass's `cause` to `'full'` — a bump + wholesale
   *  rebuild — rather than trying to synthesize the transition
   *  (documented tradeoff: O(scope) cost on a boundary-crossing tick,
   *  same cost class as a regroup). */
  private lastVisibleIds = new Set<string>();

  /** Install / replace / remove (null) the program. Reconstructs the
   *  interpreter + aggregate factories via `new Function` (the
   *  setAggFuncs precedent in handlers/dataPipeline.ts) and probe-calls
   *  the interpreter with (null, {}, [], null) so a source with free
   *  variables fails HERE (error envelope) instead of mid-pass. Throws
   *  on any reconstruction failure; the handler converts to `error`. */
  install(program: WorkerCalcProgram | null): void {
    if (program === null) {
      this.program = null;
      this.interp = null;
      this.factories.clear();
      this.colIndex.clear();
      this.resetCaches();
      return;
    }
    const interp = rebuild('calc interpreter', program.interpreterSource) as CalcInterpreter;
    // Smoke eval — CROSS-TASK CONTRACT: evaluateCalcAst(null, {}, [], null)
    // returns null and must not throw (free-variable screen).
    interp(null, {}, [], null);
    const factories = new Map<string, CalcAggregateFactory>();
    for (const entry of program.aggregateSources) {
      factories.set(entry.name, rebuild(`calc aggregate '${entry.name}'`, entry.source) as CalcAggregateFactory);
    }
    this.program = program;
    this.interp = interp;
    this.factories = factories;
    this.colIndex = new Map(program.columns.map((c) => [c.colId, c]));
    this.resetCaches(); // full Stage A/B recompute on next pipeline pass (Task 11)
  }

  hasProgram(): boolean { return this.program !== null; }
  isCalcCol(colId: string): boolean { return this.colIndex.has(colId); }
  columnFor(colId: string): WorkerCalcProgram['columns'][number] | undefined { return this.colIndex.get(colId); }
  interpreter(): CalcInterpreter | null { return this.interp; }
  aggregateFactory(name: string): CalcAggregateFactory | undefined { return this.factories.get(name); }

  /** `CalcValueSource` — read the cached value for `(rowId, colId)`.
   *  `undefined` when the column/row was never computed (no program,
   *  colId isn't a calc column, or the row hasn't been recomputed yet);
   *  callers coerce `undefined` to `null` where the interpreter
   *  contract expects it. */
  valueAt(rowId: string, colId: string): unknown {
    return this.values.get(colId)?.get(rowId);
  }

  /** Cycle 21d / Task 11 — CalcPass Stage A. Materialises every
   *  row-local (`prePass: []`) calc column's value for every dirty row.
   *  No-op unless a program is installed AND there's dirty work (an
   *  empty `Set` after a prior consumption pass, with no row-local
   *  columns to begin with, also short-circuits).
   *
   *  `fieldOf` resolves a DATA column's colId to its row field for the
   *  `prevLookup` closure — the worker's column index isn't available
   *  inside this store, so call sites thread it through from
   *  `state.columns`. A calc colId inside `prevLookup` resolves through
   *  this same value cache's PRE-recompute entry (captured per-row
   *  before the row's cache entry is overwritten), so `PREV([calcCol])`
   *  sees last tick's computed value, not this tick's. */
  ensureStageA(store: RowStore, fieldOf: (colId: string) => string | undefined): void {
    if (!this.hasProgram()) return;
    const rowLocalCols = this.program!.columns.filter((c) => c.prePass.length === 0);
    if (rowLocalCols.length === 0) {
      // Nothing row-local to compute — still drop the dirty marker so a
      // later program swap that DOES add row-local columns starts from
      // a clean full-recompute state instead of an empty Set masking it.
      // (install() already resets via resetCaches(), so this is
      // defensive rather than load-bearing.)
      return;
    }
    const dirty = this.stageADirty;
    if (dirty !== 'full' && dirty.size === 0) return;

    const interp = this.interp!;
    const hasPrevCapture = this.tickPrevRows.size > 0;
    const prevValueFor = (rowId: string, colId: string): unknown => {
      const dataField = fieldOf(colId);
      if (dataField !== undefined) {
        const oldRow = this.tickPrevRows.get(rowId);
        if (oldRow === undefined) return null;
        return (oldRow as Record<string, unknown>)[dataField] ?? null;
      }
      // Calc colId — resolve through this row's PRE-recompute cache
      // entry (captured just before we overwrite it below).
      return this.preRecomputeSnapshot?.get(rowId)?.get(colId) ?? null;
    };

    const computeRow = (rowId: string, row: unknown): void => {
      // Snapshot the row's pre-recompute calc values so `prevLookup`
      // resolving a CALC colId sees last-tick's value, not a partial
      // this-tick value from an earlier column in the same row pass.
      if (hasPrevCapture && this.tickPrevRows.has(rowId)) {
        const snap = new Map<string, unknown>();
        for (const col of rowLocalCols) snap.set(col.colId, this.values.get(col.colId)?.get(rowId));
        this.preRecomputeSnapshot = new Map([[rowId, snap]]);
      } else {
        this.preRecomputeSnapshot = undefined;
      }
      const prevLookup = hasPrevCapture ? (colId: string) => prevValueFor(rowId, colId) : null;
      for (const col of rowLocalCols) {
        let result: unknown;
        try {
          result = interp(col.ast, row as Record<string, unknown>, EMPTY_SLOTS, prevLookup);
        } catch {
          result = null; // errors → null cell (spec §5 risk row 1)
        }
        let colMap = this.values.get(col.colId);
        if (!colMap) {
          colMap = new Map();
          this.values.set(col.colId, colMap);
        }
        colMap.set(rowId, result);
      }
    };

    if (dirty === 'full') {
      for (const row of store.rows()) {
        computeRow(store.getRowId(row), row);
      }
    } else {
      for (const rowId of dirty) {
        const row = store.getById(rowId);
        if (row === undefined) continue; // removed before recompute — nothing to do
        computeRow(rowId, row);
      }
    }

    this.stageADirty = new Set(); // tick-scoped consumption
    this.tickPrevRows.clear();
    this.preRecomputeSnapshot = undefined;
  }

  /** Scratch used only WITHIN a single `ensureStageA` row's compute —
   *  lets `prevLookup` resolve a calc colId to last tick's value. */
  private preRecomputeSnapshot: Map<string, Map<string, unknown>> | undefined;

  /** Full data replace — every row-local column needs recompute for
   *  every (new) row on the next `ensureStageA` pass; the value cache
   *  and any pending PREV capture are stale against the new data. Stage
   *  B: a full replace invalidates every cached scope-instance state
   *  (membership is entirely stale) — `pipelineCause` stays/returns to
   *  `'full'` so the next `ensureStageB` rebuilds from scratch. */
  onSetRowData(): void {
    this.stageADirty = 'full';
    this.values.clear();
    this.tickPrevRows.clear();
    this.pipelineCause = 'full';
    this.lastDelta = null;
    this.aggStates.clear();
    this.rowScopeKey.clear();
    this.parentOfGroup.clear();
    this.lastVisibleIds.clear();
  }

  /** Union add/update rowIds into the dirty set (promoting `'full'`
   *  stays `'full'` — a pending full recompute already covers any
   *  newly-touched row). Evict removed rowIds from every column's
   *  value cache so a stale entry can't leak through `valueAt`. Stage B:
   *  marks the NEXT `ensureStageB` pass as `'delta'` and stashes the
   *  touched rowIds so it can feed `addRow`/`removeRow`/`updateRow` to
   *  just the affected scope instances instead of rebuilding every
   *  scope wholesale. */
  onTransaction(results: { add: Array<{ rowId: string }>; update: Array<{ rowId: string }>; remove: Array<{ rowId: string }> }): void {
    if (this.stageADirty !== 'full') {
      const dirty = this.stageADirty;
      for (const a of results.add) dirty.add(a.rowId);
      for (const u of results.update) dirty.add(u.rowId);
    }
    if (results.remove.length > 0) {
      for (const colMap of this.values.values()) {
        for (const r of results.remove) colMap.delete(r.rowId);
      }
    }
    this.pipelineCause = 'delta';
    const add = results.add.map((a) => a.rowId);
    const update = results.update.map((u) => u.rowId);
    const remove = results.remove.map((r) => r.rowId);
    if (this.lastDelta === null) {
      this.lastDelta = { add, update, remove };
    } else {
      // Multiple transactions before a pipeline pass consumes them —
      // union rather than overwrite (mirrors the Stage A dirty-Set
      // union above).
      this.lastDelta.add.push(...add);
      this.lastDelta.update.push(...update);
      this.lastDelta.remove.push(...remove);
    }
  }

  /** Snapshot the pre-apply row for every update AND every to-be-removed
   *  rowId, BEFORE `store.apply` runs. Updates feed a `usesPrev` calc
   *  column's old-value read; BOTH updates and removes feed Stage B's
   *  delta path (`applyDeltaToScopes`), which needs the OLD row's
   *  aggregate-source value to `removeRow`/`updateRow` the correct
   *  scalar out of a cached scope's state.
   *
   *  Final review Fix 2 — `removeIds` closes the delta-REMOVE-never-
   *  subtracts gap: prior to this fix, only `updates` were captured, so
   *  a removed row's `tickPrevRowsB` entry was always absent and
   *  `applyDeltaToScopes`'s remove branch fell back to
   *  `read(rowId)` — which resolves through `store.getById(rowId)`,
   *  already `undefined` POST-removal for a data-field column. The
   *  factory's `typeof value === 'number'` guard then no-ops
   *  `removeRow`, leaving the cached scalar stale until the next FULL
   *  rebuild (reviewer repro: SUM(all) stays 330 after removing rows
   *  worth 200, instead of settling to 130).
   *
   *  No-op when no installed column actually reads PREV AND no column
   *  has an aggregate dependency — avoids a snapshot walk on every
   *  transaction for programs that need neither. Mirrors
   *  `stageFlashesForUpdates`'s try/catch-skip on `getRowId` (a
   *  malformed update row shouldn't crash the capture pass). First
   *  capture wins within a tick — a row updated/removed twice in one
   *  batched transaction keeps the earliest (truest "old") snapshot. */
  capturePrevForUpdates(store: RowStore, updates: unknown[], removeIds: readonly string[] = []): void {
    if (!this.hasProgram()) return;
    const anyUsesPrev = this.program!.columns.some((c) => c.usesPrev);
    const anyAggCol = this.program!.columns.some((c) => c.prePass.length > 0);
    if (!anyUsesPrev && !anyAggCol) return;
    for (const newRow of updates) {
      let rowId: string;
      try { rowId = store.getRowId(newRow as never); } catch { continue; }
      const oldRow = store.getById(rowId);
      if (oldRow === undefined) continue;
      if (anyUsesPrev && !this.tickPrevRows.has(rowId)) this.tickPrevRows.set(rowId, oldRow); // first capture wins
      if (anyAggCol && !this.tickPrevRowsB.has(rowId)) this.tickPrevRowsB.set(rowId, oldRow); // first capture wins
    }
    // Removes only ever need Stage B's snapshot (`tickPrevRowsB`) — a
    // removed row is gone, so no future `ensureStageA` recompute will
    // ever read PREV for it; `tickPrevRows` stays update-only.
    if (anyAggCol) {
      for (const rowId of removeIds) {
        if (this.tickPrevRowsB.has(rowId)) continue; // first capture wins
        const oldRow = store.getById(rowId);
        if (oldRow === undefined) continue;
        this.tickPrevRowsB.set(rowId, oldRow);
      }
    }
  }

  private resetCaches(): void {
    this.stageADirty = 'full';
    this.values.clear();
    this.tickPrevRows.clear();
    this.preRecomputeSnapshot = undefined;
    this.pipelineCause = 'full';
    this.lastDelta = null;
    this.aggStates.clear();
    this.rowScopeKey.clear();
    this.parentOfGroup.clear();
    this.groupSignature = '';
    this.lastVisibleIds.clear();
  }

  // ─── Stage B: scope keys ────────────────────────────────────────────

  /** Mirrors `packages/calc/src/scopeKey.ts`'s `scopeKeyOf` — canonical
   *  cache key per scope kind. `'group'`/`'parent'` fold the CURRENT
   *  `groupSignature` in (spec §5 risk table: "scopeKey includes the
   *  group signature") so a regroup's key change alone orphans stale
   *  entries — we ALSO wholesale-clear on regroup below (belt-and-
   *  suspenders, see `ensureStageB`). `'parent'` at the root level
   *  resolves to the SAME key as `'visible'` — a root group's parent
   *  instance IS the visible/all-of-view instance (spec: "root groups'
   *  parent = the visible set"). */
  private scopeKeyFor(kind: 'all' | 'visible' | 'group', groupKey?: string): string {
    switch (kind) {
      case 'all': return 'all';
      case 'visible': return 'visible';
      case 'group': return `group:${this.groupSignature}|${groupKey ?? ''}`;
    }
  }

  private entryFor(fn: string, colId: string, scopeKey: string): AggStateEntry {
    const cacheKey = `${fn}|${colId}|${scopeKey}`;
    let entry = this.aggStates.get(cacheKey);
    if (entry === undefined) {
      if (isFirstLast(fn) !== null) {
        // FIRST/LAST bypass the factory path entirely (assembler
        // addition: NOT registry impls — no factory exists by design).
        // Stub entry: no impl, no delta state; `finalized` is always
        // produced by `firstLastScan` at rebuild/touch sites.
        entry = { state: null, impl: null, dataVersion: 0, finalized: null };
      } else {
        // Final review Fix 1 — `fn` may be a parameterized `NAME(p)`
        // string (e.g. 'PERCENTILE(95)') while `factories` is keyed by
        // BASE name only; `resolveAggregateFactory` implements the same
        // `NAME(p)` grammar as the calc registry's `getAggregate`.
        const impl = resolveAggregateFactory(this.factories, fn);
        if (impl === undefined) {
          throw new Error(`[velocity-grid] Stage B: unresolved aggregate function '${fn}' (colId '${colId}')`);
        }
        entry = { state: impl.init(), impl, dataVersion: 0, finalized: null };
      }
      this.aggStates.set(cacheKey, entry);
    }
    return entry;
  }

  /** Cycle 21d / Task 12 — CalcPass Stage B. No-op unless a program is
   *  installed AND at least one column has `prePass.length > 0`.
   *
   *  **Scope resolution** (spec §3, cross-task contract with Task 2's
   *  transform output):
   *   - `'all'` → every store row (`store.rows()`), regardless of
   *     filter/group state.
   *   - `'visible'` → `postFilterIds` — UNLESS grouping is active
   *     (`!groupOutput.bypassed`), in which case it's PROMOTED to
   *     `'group'` (spec Q4): a row's "visible" scalar becomes ITS
   *     group's scalar when grouping partitions the view. Implemented
   *     as a scope-kind rewrite before key resolution, documented here.
   *   - `'group'` → one instance per group node, membership from the
   *     `GroupPassOutput` tree walk (mirrors `AggPass.applyGroups`'
   *     bottom-up descendant materialisation).
   *   - `'parent'` → the parent group's instance; a ROOT group's parent
   *     is the `'visible'` (post-filter) instance — PCT_OF_PARENT at
   *     root equals PCT_OF_TOTAL-of-visible.
   *
   *  **Full vs delta.** Every scope instance is rebuilt from scratch
   *  (`impl = factory()`, stream `addRow` per member, `finalize`) when
   *  `pipelineCause !== 'delta'` OR the group signature changed since
   *  the last pass (a regroup changes MEMBERSHIP, not just which cache
   *  key addresses a group, so it forces a full rebuild regardless of
   *  the transaction cause). Otherwise (`pipelineCause === 'delta'`,
   *  same group signature) cached entries are reused and only the scopes
   *  touched by the transaction (`onTransaction`'s recorded rowIds) are
   *  fed `addRow`/`removeRow`/`updateRow` — the cache hit for every
   *  other scope instance.
   *
   *  **FIRST/LAST** (assembler addition — NOT a registry impl; the
   *  registry has no entry for them). Computed directly as a first/last
   *  NON-NULL scan over the scope's member rows in scope iteration order
   *  (store insertion for `'all'`, post-filter order for `'visible'`,
   *  group-bucket order for `'group'`/`'parent'`) — no delta state,
   *  O(scope) recompute on every touch (full rebuild OR delta touch).
   *
   *  **Per-row eval.** For every row the group tree / postFilterIds
   *  addresses, `aggSlots[spec.slot] = ` the row's resolved scope
   *  instance's finalized scalar, then `values[colId][rowId] =
   *  interp(ast, row, aggSlots, null)` (try/catch → null, matching Stage
   *  A; Stage B columns don't carry PREV — `usesPrev` columns are
   *  row-local per the compiler, Stage A's concern). Consumes
   *  `pipelineCause` + `lastDelta`, resetting to `'full'`/`null` at the
   *  end — tick-scoped consumption mirroring Stage A's dirty-Set clear. */
  ensureStageB(
    store: RowStore,
    groupOutput: GroupPassOutput,
    postFilterIds: readonly string[],
    fieldOf: (colId: string) => string | undefined,
  ): void {
    if (!this.hasProgram()) return;
    const aggCols = this.program!.columns.filter((c) => c.prePass.length > 0);
    if (aggCols.length === 0) return;

    const grouped = !groupOutput.bypassed;
    const newSignature = grouped ? groupSignatureOf(groupOutput) : '';
    const regrouped = newSignature !== this.groupSignature;
    this.groupSignature = newSignature;
    const delta = this.lastDelta;
    this.pipelineCause = 'full';
    this.lastDelta = null;

    // Final review Fix 3 — a delta-touched row whose FILTER membership
    // CHANGED since the last completed pass (entered or left the
    // filtered/visible set via an update) can't be correctly folded into
    // the delta path: the 'visible'/group scopes' cached state has
    // either never seen the row (entering) or still carries its old
    // contribution with no paired addRow to undo (leaving). Detect any
    // such crossing among this transaction's UPDATE rows (adds/removes
    // are membership-safe — see `chainFrom` below) and fall back to a
    // full-cause rebuild of this whole pass when found. Robust-simple
    // per the review: bump + wholesale rebuild, not a synthesized
    // enter/leave delta (documented tradeoff — same O(scope) cost class
    // as a regroup, only paid on a boundary-crossing tick).
    const postFilterSet = new Set(postFilterIds);
    let boundaryCrossed = false;
    if (delta !== null && !regrouped) {
      for (const rowId of delta.update) {
        if (this.lastVisibleIds.has(rowId) !== postFilterSet.has(rowId)) {
          boundaryCrossed = true;
          break;
        }
      }
    }
    const cause: 'delta' | 'full' = (delta !== null && !regrouped && !boundaryCrossed) ? 'delta' : 'full';

    const fieldReader = (colId: string): ((rowId: string) => unknown) => {
      const dataField = fieldOf(colId);
      if (dataField !== undefined) {
        return (rowId) => {
          const row = store.getById(rowId);
          return row === undefined ? undefined : (row as Record<string, unknown>)[dataField];
        };
      }
      // The aggregate source column is itself a row-local calc column —
      // Stage A already ran earlier in this pass, so `valueAt` is safe.
      return (rowId) => this.valueAt(rowId, colId);
    };

    interface ResolvedSpec {
      slot: number; fn: string; colId: string; kind: 'all' | 'visible' | 'group' | 'parent';
      read: (rowId: string) => unknown;
    }
    const specsByCol = new Map<string, ResolvedSpec[]>();
    const uniqueSpecs = new Map<string, { fn: string; colId: string; read: (rowId: string) => unknown }>();
    for (const col of aggCols) {
      const specs: ResolvedSpec[] = [];
      for (const spec of col.prePass) {
        let kind = spec.scope.kind as 'all' | 'visible' | 'group' | 'parent';
        if (kind === 'visible' && grouped) kind = 'group'; // spec Q4 promotion
        const read = fieldReader(spec.colId);
        specs.push({ slot: spec.slot, fn: spec.fn, colId: spec.colId, kind, read });
        uniqueSpecs.set(`${spec.fn}|${spec.colId}`, { fn: spec.fn, colId: spec.colId, read });
      }
      specsByCol.set(col.colId, specs);
    }

    // ── group membership walk (mirrors AggPass.applyGroups) ──
    const groupMemberIds = new Map<string, string[]>();
    if (grouped) {
      if (cause === 'full') {
        this.rowScopeKey.clear();
        this.parentOfGroup.clear();
      }
      const collectDescendantIds = (node: GroupNode): string[] => {
        if (node.childGroups.length === 0) {
          const idxs = node.childIndices;
          const out: string[] = new Array(idxs.length);
          for (let i = 0; i < idxs.length; i++) out[i] = postFilterIds[idxs[i]!]!;
          for (const id of out) this.rowScopeKey.set(id, node.key);
          groupMemberIds.set(node.key, out);
          return out;
        }
        const out: string[] = [];
        for (const child of node.childGroups) {
          this.parentOfGroup.set(child.key, node.key === '' ? '' : node.key);
          const childIds = collectDescendantIds(child);
          for (const id of childIds) out.push(id);
        }
        groupMemberIds.set(node.key, out);
        return out;
      };
      for (const root of groupOutput.roots) {
        this.parentOfGroup.set(root.key, ''); // root's parent = visible/all instance
        collectDescendantIds(root);
      }
    }

    // ── scope-instance compute ──
    const rebuildScope = (fn: string, colId: string, read: (rowId: string) => unknown, scopeKey: string, memberIds: readonly string[]): void => {
      const entry = this.entryFor(fn, colId, scopeKey);
      const firstLast = isFirstLast(fn);
      if (firstLast !== null) {
        // FIRST/LAST stub entry (impl === null) — no delta state to
        // stream; the scalar IS the order-aware scan.
        entry.dataVersion += 1;
        entry.finalized = firstLastScan(firstLast, memberIds, read);
        return;
      }
      const impl = entry.impl!;
      entry.state = impl.init();
      for (const id of memberIds) entry.state = impl.addRow(entry.state, read(id));
      entry.dataVersion += 1;
      entry.finalized = impl.finalize(entry.state);
    };

    // Scope-instance membership resolver — shared by the full-rebuild
    // path and the delta path's FIRST/LAST rescans ('all' rebuilt lazily
    // from the store, POST-transaction; 'visible' is this pass's fresh
    // postFilterIds; group keys resolve through this pass's fresh walk).
    let lazyAllIds: string[] | null = null;
    const memberIdsFor = (scopeKey: string): readonly string[] => {
      if (scopeKey === 'all') {
        if (lazyAllIds === null) {
          lazyAllIds = [];
          for (const row of store.rows()) lazyAllIds.push(store.getRowId(row));
        }
        return lazyAllIds;
      }
      if (scopeKey === 'visible') return postFilterIds;
      const groupPrefix = `group:${this.groupSignature}|`;
      if (scopeKey.startsWith(groupPrefix)) {
        return groupMemberIds.get(scopeKey.slice(groupPrefix.length)) ?? [];
      }
      return [];
    };

    if (cause === 'full') {
      this.aggStates.clear();
      for (const { fn, colId, read } of uniqueSpecs.values()) {
        rebuildScope(fn, colId, read, this.scopeKeyFor('all'), memberIdsFor('all'));
        rebuildScope(fn, colId, read, this.scopeKeyFor('visible'), postFilterIds);
        if (grouped) {
          for (const [groupKey, memberIds] of groupMemberIds) {
            rebuildScope(fn, colId, read, this.scopeKeyFor('group', groupKey), memberIds);
          }
        }
      }
    } else {
      const groupColIds = grouped ? groupColIdsOf(groupOutput) : [];
      this.applyDeltaToScopes(uniqueSpecs, delta, grouped, groupColIds, fieldOf, memberIdsFor, postFilterSet);
    }

    // Final review Fix 3 — snapshot this pass's filter membership for the
    // NEXT pass's boundary-crossing detection (see above). Recorded
    // unconditionally (both 'full' and 'delta' causes) so the very next
    // delta pass always compares against a fresh membership set.
    this.lastVisibleIds = postFilterSet;

    // ── per-row eval ──
    const interp = this.interp!;
    const resolveScopeKey = (rowId: string, kind: 'all' | 'visible' | 'group' | 'parent'): string => {
      if (kind === 'all') return this.scopeKeyFor('all');
      if (kind === 'visible') return this.scopeKeyFor('visible');
      const gk = grouped ? this.rowScopeKey.get(rowId) : undefined;
      if (kind === 'group') {
        return gk !== undefined ? this.scopeKeyFor('group', gk) : this.scopeKeyFor('visible');
      }
      // 'parent'
      const parentKey = gk !== undefined ? this.parentOfGroup.get(gk) : undefined;
      return parentKey !== undefined && parentKey !== ''
        ? this.scopeKeyFor('group', parentKey)
        : this.scopeKeyFor('visible');
    };

    const evalIds: string[] = grouped ? Array.from(this.rowScopeKey.keys()) : postFilterIds.slice();
    for (const col of aggCols) {
      const specs = specsByCol.get(col.colId)!;
      let colMap = this.values.get(col.colId);
      if (!colMap) {
        colMap = new Map();
        this.values.set(col.colId, colMap);
      }
      for (const rowId of evalIds) {
        const row = store.getById(rowId);
        if (row === undefined) continue;
        const aggSlots: Array<number | null> = new Array(col.prePass.length).fill(null);
        for (const spec of specs) {
          const scopeKey = resolveScopeKey(rowId, spec.kind);
          const entry = this.aggStates.get(`${spec.fn}|${spec.colId}|${scopeKey}`);
          aggSlots[spec.slot] = entry?.finalized ?? null;
        }
        let result: unknown;
        try {
          result = interp(col.ast, row as Record<string, unknown>, aggSlots, null);
        } catch {
          result = null;
        }
        colMap.set(rowId, result);
      }
    }
  }

  /** Delta path — reuse cached scope entries; feed only the transaction's
   *  touched rowIds to their affected scope instances (`'all'`,
   *  `'visible'`, and the row's group chain — `'parent'`-scope specs
   *  read a GROUP entry at eval time, so touching the group chain covers
   *  them too). Adds use post-transaction membership (current
   *  `rowScopeKey`, populated by the group walk in `ensureStageB` — a
   *  same-shape delta transaction doesn't change which bucket a NEW row
   *  falls into vs the tree GroupPass already built this pass). Removes
   *  use the row's LAST-KNOWN `rowScopeKey` entry (still present — the
   *  row was deleted from the store, but membership bookkeeping is
   *  evicted here, after use). Updates compare the row's OLD group key
   *  (recomputed from `tickPrevRowsB`'s pre-apply snapshot by mirroring
   *  GroupPass's own bucket-key construction, `groupKeyOf`) against the
   *  CURRENT `rowScopeKey` (the new key, already reflecting the updated
   *  row since GroupPass re-ran before Stage B this pass) to detect a
   *  cross-group move — different key: `removeRow` from every old-chain
   *  scope (using the OLD row's aggregate-source value) + `addRow` to
   *  every new-chain scope (NEW value); same key: `updateRow(old, new)`
   *  on the unchanged chain. FIRST/LAST entries are O(scope) rescanned
   *  on every touch this pass (documented cost — no delta state kept for
   *  them, matching the assembler addition's contract).
   *
   *  **Final review Fix 3.** `chainFrom` used to unconditionally include
   *  the `'visible'` (+ group tail) cache keys for EVERY touched row,
   *  with no check against `postFilterSet` — a row that is filtered OUT
   *  of the view still got `addRow`'d/`removeRow`'d into the 'visible'
   *  scope's cached state, polluting every reader of that scope (e.g. a
   *  filtered-out row worth 1000 inflating a visible SUM that should be
   *  30 up to 1030). `chainFrom` now takes the row's FILTER membership
   *  (current, for adds; PRE-removal — `lastVisibleIds` — for removes)
   *  and only appends the visible/group tail when the row actually
   *  belongs to the filtered view; `'all'` is unconditional (spec: 'all'
   *  ignores filter/group state entirely). UPDATE rows that CROSS the
   *  filter boundary never reach this method — `ensureStageB` detects
   *  that case and forces `cause = 'full'` for the whole pass instead
   *  (see the `boundaryCrossed` check there); `applyDeltaToScopes`'s
   *  update branch below can therefore assume `isVisible` is UNCHANGED
   *  across the transaction for every row it processes. */
  private applyDeltaToScopes(
    uniqueSpecs: Map<string, { fn: string; colId: string; read: (rowId: string) => unknown }>,
    delta: { add: string[]; update: string[]; remove: string[] } | null,
    grouped: boolean,
    groupColIds: readonly string[],
    fieldOf: (colId: string) => string | undefined,
    memberIdsFor: (scopeKey: string) => readonly string[],
    postFilterSet: ReadonlySet<string>,
  ): void {
    if (delta === null) return;

    const chainFrom = (leafGroupKey: string | undefined, isVisible: boolean): string[] => {
      const chain = [this.scopeKeyFor('all')];
      if (!isVisible) return chain; // filtered out — 'all' only (Fix 3)
      chain.push(this.scopeKeyFor('visible'));
      if (grouped) {
        let gk = leafGroupKey;
        while (gk !== undefined && gk !== '') {
          chain.push(this.scopeKeyFor('group', gk));
          gk = this.parentOfGroup.get(gk);
        }
      }
      return chain;
    };

    /** Mirror GroupPass's bucket-key construction (`src/worker/passes/
     *  groupPass.ts`): `${colId}:${keyPart}` per level, joined `'::'`,
     *  over the OLD (pre-apply) row snapshot's field values. Task 4
     *  (A-C7) — MUST escape segments identically to the real GroupPass
     *  keys (`rowScopeKey`/`parentOfGroup` below are populated from
     *  those real, now-escaped keys); a divergence here would silently
     *  misdirect — or drop — the old-scope `removeRow` on a cross-group
     *  move whenever a group value contains `:` or `::`. */
    const oldGroupKeyFor = (oldRow: unknown): string | undefined => {
      if (!grouped || groupColIds.length === 0) return undefined;
      let key = '';
      for (const colId of groupColIds) {
        const field = fieldOf(colId);
        const rawValue = field !== undefined ? (oldRow as Record<string, unknown>)[field] : undefined;
        const keyPart = rawValue == null ? '' : '' + rawValue;
        const seg = `${escapeGroupKeySegment(colId)}:${escapeGroupKeySegment(keyPart)}`;
        key = key === '' ? seg : `${key}::${seg}`;
      }
      return key;
    };

    // Touched-entry bookkeeping keyed by cache key, carrying enough
    // metadata to re-finalize below (FIRST/LAST need the scopeKey to
    // resolve membership for their rescan + the read fn — a bare
    // Set<string> can't reconstruct a scopeKey that itself contains
    // the `|` delimiter, e.g. `group:desk|desk:A`).
    const touched = new Map<string, { fn: string; colId: string; scopeKey: string; read: (rowId: string) => unknown }>();
    /** Bump the entry's version + record it for re-finalization.
     *  FIRST/LAST stub entries (impl === null) get ONLY the bump —
     *  callers must guard their impl state math on `entry.impl`. */
    const bumpTouched = (fn: string, colId: string, read: (rowId: string) => unknown, scopeKey: string): AggStateEntry => {
      const entry = this.entryFor(fn, colId, scopeKey);
      entry.dataVersion += 1;
      touched.set(`${fn}|${colId}|${scopeKey}`, { fn, colId, scopeKey, read });
      return entry;
    };

    for (const rowId of delta.add) {
      // Fix 3 — a NEW row's visibility is its CURRENT postFilterSet
      // membership (there is no "prior" state to compare against).
      const chain = chainFrom(this.rowScopeKey.get(rowId), postFilterSet.has(rowId));
      for (const { fn, colId, read } of uniqueSpecs.values()) {
        const value = read(rowId);
        for (const scopeKey of chain) {
          const entry = bumpTouched(fn, colId, read, scopeKey);
          if (entry.impl !== null) entry.state = entry.impl.addRow(entry.state, value);
        }
      }
    }

    for (const rowId of delta.remove) {
      // Fix 3 — a removed row's visibility is its PRE-removal membership
      // (`postFilterSet` never contains a removed row, so we must
      // consult the snapshot from the last completed pass instead).
      const chain = chainFrom(this.rowScopeKey.get(rowId), this.lastVisibleIds.has(rowId));
      const oldRow = this.tickPrevRowsB.get(rowId);
      for (const { fn, colId, read } of uniqueSpecs.values()) {
        const field = fieldOf(colId);
        const value = oldRow !== undefined
          ? (field !== undefined ? (oldRow as Record<string, unknown>)[field] : read(rowId))
          : read(rowId);
        for (const scopeKey of chain) {
          const entry = bumpTouched(fn, colId, read, scopeKey);
          if (entry.impl !== null) entry.state = entry.impl.removeRow(entry.state, value);
        }
      }
      this.rowScopeKey.delete(rowId);
    }

    for (const rowId of delta.update) {
      const newGroupKey = this.rowScopeKey.get(rowId);
      const oldRow = this.tickPrevRowsB.get(rowId);
      const oldGroupKey = oldRow !== undefined ? oldGroupKeyFor(oldRow) : newGroupKey;
      const sameGroup = oldGroupKey === newGroupKey;
      // Fix 3 — `ensureStageB` guarantees no boundary-crossing update
      // reaches this method (it forces `cause = 'full'` for the whole
      // pass instead), so the row's filter membership is UNCHANGED
      // across this transaction — one membership flag covers both the
      // old and new chain.
      const isVisible = postFilterSet.has(rowId);

      for (const { fn, colId, read } of uniqueSpecs.values()) {
        const field = fieldOf(colId);
        const newValue = read(rowId);
        const oldValue = oldRow !== undefined
          ? (field !== undefined ? (oldRow as Record<string, unknown>)[field] : newValue)
          : newValue;
        if (sameGroup) {
          const chain = chainFrom(newGroupKey, isVisible);
          for (const scopeKey of chain) {
            const entry = bumpTouched(fn, colId, read, scopeKey);
            if (entry.impl !== null) entry.state = entry.impl.updateRow(entry.state, oldValue, newValue);
          }
        } else {
          const oldChain = chainFrom(oldGroupKey, isVisible);
          const newChain = chainFrom(newGroupKey, isVisible);
          // 'all'/'visible' are shared by both chains — an in-place
          // value change there (not a membership change), so use
          // updateRow; only the GROUP-specific tail differs.
          const shared = new Set([this.scopeKeyFor('all'), this.scopeKeyFor('visible')]);
          for (const scopeKey of oldChain) {
            const entry = bumpTouched(fn, colId, read, scopeKey);
            if (entry.impl === null) continue; // FIRST/LAST: bump-only; rescan below
            entry.state = shared.has(scopeKey)
              ? entry.impl.updateRow(entry.state, oldValue, newValue)
              : entry.impl.removeRow(entry.state, oldValue);
          }
          for (const scopeKey of newChain) {
            if (shared.has(scopeKey)) continue; // already updateRow'd above
            const entry = bumpTouched(fn, colId, read, scopeKey);
            if (entry.impl !== null) entry.state = entry.impl.addRow(entry.state, newValue);
          }
        }
      }
    }
    this.tickPrevRowsB.clear();

    // Re-finalize every touched entry. FIRST/LAST (impl === null): the
    // ASSEMBLER ADDITION's recompute-on-version-bump — an O(scope)
    // order-aware rescan over the scope's CURRENT (post-transaction)
    // membership; everything else memoizes `impl.finalize(state)`.
    for (const { fn, colId, scopeKey, read } of touched.values()) {
      const entry = this.aggStates.get(`${fn}|${colId}|${scopeKey}`);
      if (entry === undefined) continue;
      const firstLast = isFirstLast(fn);
      entry.finalized = firstLast !== null
        ? firstLastScan(firstLast, memberIdsFor(scopeKey), read)
        : entry.impl!.finalize(entry.state);
    }
  }
}

/** Store-level group-model signature folded into every `'group:'`/
 *  `'parent:'` Stage-B cache key (spec §5 risk table: "scopeKey includes
 *  the group signature") — mirrors `packages/calc/src/scopeKey.ts`'s
 *  documented requirement without shipping that module's source. Built
 *  from the CURRENT tree's per-level `colId`s (root chain down through
 *  each level's first child — every node at a given depth shares the
 *  same `colId`, so one root-to-leaf walk is enough) joined `''`, so two
 *  different `rowGroupCols` orderings/sets produce different signatures
 *  and a regroup naturally orphans stale cache entries. Empty string for
 *  a bypassed (or root-less) tree. */
function groupColIdsOf(groupOutput: GroupPassOutput): string[] {
  const colIds: string[] = [];
  let node: GroupNode | undefined = groupOutput.roots[0];
  while (node !== undefined) {
    colIds.push(node.colId);
    node = node.childGroups[0];
  }
  return colIds;
}

function groupSignatureOf(groupOutput: GroupPassOutput): string {
  return groupColIdsOf(groupOutput).join('');
}

/** FIRST/LAST assembler addition — first/last NON-NULL value of
 *  `read(rowId)` over `memberIds` in the given scope's iteration order
 *  (store insertion for `'all'`, post-filter order for `'visible'`,
 *  group-bucket order for `'group'`/`'parent'` — the same order the
 *  membership arrays above are built in). O(scope) scan; no delta
 *  state — recomputed on every touch (full rebuild or delta bump). */
function firstLastScan(which: 'first' | 'last', memberIds: readonly string[], read: (rowId: string) => unknown): number | null {
  const ids = which === 'last' ? [...memberIds].reverse() : memberIds;
  for (const id of ids) {
    const v = read(id);
    if (v !== null && v !== undefined) {
      return typeof v === 'number' ? v : (Number.isFinite(Number(v)) ? Number(v) : null);
    }
  }
  return null;
}

function rebuild(label: string, source: string): unknown {
  let fn: unknown;
  try {
    fn = new Function(`"use strict"; return (${source});`)();
  } catch (err) {
    throw new Error(`[velocity-grid] failed to deserialise ${label}: ${String((err as Error).message ?? err)}`);
  }
  if (typeof fn !== 'function') {
    throw new Error(`[velocity-grid] ${label} did not deserialise to a function`);
  }
  return fn;
}
