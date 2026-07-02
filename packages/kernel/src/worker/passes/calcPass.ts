// Cycle 21d / Task 10 — worker-side calc program store.
//
// Owns the reconstruction of the calculated-column interpreter + delta
// aggregate factories shipped from @cgrid/calc's bridge as source text
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

import type { RowStore } from '../dataPipeline';
import type { WorkerCalcProgram } from '../protocol';

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
   *  and any pending PREV capture are stale against the new data. */
  onSetRowData(): void {
    this.stageADirty = 'full';
    this.values.clear();
    this.tickPrevRows.clear();
  }

  /** Union add/update rowIds into the dirty set (promoting `'full'`
   *  stays `'full'` — a pending full recompute already covers any
   *  newly-touched row). Evict removed rowIds from every column's
   *  value cache so a stale entry can't leak through `valueAt`. */
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
  }

  /** Snapshot the pre-apply row for every update BEFORE `store.apply`
   *  runs, so a `usesPrev` calc column can read the old value during
   *  the tick that recomputes it. No-op when no installed column
   *  actually reads PREV — avoids a snapshot walk on every transaction
   *  for programs that never use it. Mirrors `stageFlashesForUpdates`'s
   *  try/catch-skip on `getRowId` (a malformed update row shouldn't
   *  crash the capture pass). First capture wins within a tick — a
   *  row updated twice in one batched transaction keeps the earliest
   *  (truest "old") snapshot. */
  capturePrevForUpdates(store: RowStore, updates: unknown[]): void {
    if (!this.hasProgram()) return;
    const anyUsesPrev = this.program!.columns.some((c) => c.usesPrev);
    if (!anyUsesPrev) return;
    for (const newRow of updates) {
      let rowId: string;
      try { rowId = store.getRowId(newRow as never); } catch { continue; }
      if (this.tickPrevRows.has(rowId)) continue; // first capture wins
      const oldRow = store.getById(rowId);
      if (oldRow === undefined) continue;
      this.tickPrevRows.set(rowId, oldRow);
    }
  }

  private resetCaches(): void {
    this.stageADirty = 'full';
    this.values.clear();
    this.tickPrevRows.clear();
    this.preRecomputeSnapshot = undefined;
  }
}

function rebuild(label: string, source: string): unknown {
  let fn: unknown;
  try {
    fn = new Function(`"use strict"; return (${source});`)();
  } catch (err) {
    throw new Error(`[cgrid] failed to deserialise ${label}: ${String((err as Error).message ?? err)}`);
  }
  if (typeof fn !== 'function') {
    throw new Error(`[cgrid] ${label} did not deserialise to a function`);
  }
  return fn;
}
