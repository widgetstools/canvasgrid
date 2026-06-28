/**
 * Cycle 18 / Task 1 — PivotState primitive.
 *
 * The single canonical source-of-truth for everything the pivot UI
 * surfaces mutate (columns tool panel Values + Column Labels drop zones —
 * Task 5; the pivot panel — Task 6; the column header context menu pivot
 * items — Task 7). Mirrors `GroupingState` (Cycle 15.5 / Task 1): each
 * surface calls a primitive verb, the primitive emits `pivotStateChanged`,
 * and every other surface re-renders from the new state — the
 * "many views over one model" invariant.
 *
 *   ┌─────────────────────┐
 *   │ Tool panel zones    │──┐
 *   └─────────────────────┘  │
 *   ┌─────────────────────┐  │   ┌────────────────────┐
 *   │ Pivot panel         │──┼──>│    PivotState      │
 *   └─────────────────────┘  │   │   (this module)    │
 *   ┌─────────────────────┐  │   └────────────────────┘
 *   │ Context menu items  │──┘            │ emits
 *   └─────────────────────┘               │ pivotStateChanged
 *                  ▲                       │
 *                  └───────── subscribe ───┘
 *
 * The state shape (the pivot spec's three roles — see
 * `pivot-behaviors-prompts.md` Prompt 1):
 *  - `pivotMode: boolean` — master switch. When false, pivot config is
 *    retained but inactive.
 *  - `pivotColumns: string[]` — ordered colIds whose distinct values
 *    become column headers ("Column Labels"). Index IS pivot-group
 *    nesting depth.
 *  - `valueColumns: Array<{ colId; aggFunc }>` — ordered measures
 *    ("Values") aggregated per (rowGroup × pivotKey) intersection.
 *
 * The ROW dimension (`rowGroupColumns`) is NOT modelled here — it stays in
 * `GroupingState`. Pivot reuses the existing Cycle 15 grouping axis.
 *
 * `pivotMode` activeness: a pivot only PRODUCES a matrix when
 * `pivotMode && pivotColumns.length >= 1 && valueColumns.length >= 1`
 * (`isPivotActive()`). `pivotMode` on with no pivot/value columns is a
 * valid state (the grid groups + aggregates normally) — see Prompt 1.
 *
 * NOTE (parity): `pivotMode` is persisted SEPARATELY from column state in
 * AG Grid. `serialize()` here includes it for a complete PivotState
 * round-trip via Grid State; the grid's `getColumnState()` deliberately
 * does NOT carry `pivotMode`.
 *
 * Design plan: docs/superpowers/plans/2026-06-28-canvasgrid-cycle-18-pivoting.md
 */

import { TypedEventEmitter } from './eventEmitter';

/** A measured column under pivot: a primary column + the aggregation
 *  applied to it per (rowGroup × pivotKey) cell. */
export interface PivotValueColumn {
  colId: string;
  aggFunc: string;
}

/** Discriminant for the verb that produced a `pivotStateChanged` event. */
export type PivotStateChangeSource =
  | 'mode'
  | 'set'
  | 'add'
  | 'remove'
  | 'move'
  | 'aggFunc'
  | 'restore';

/** Event payload emitted whenever the pivot state mutates. Carries fresh
 *  snapshots so subscribers can diff against their last-known copy. */
export interface PivotStateChangedEvent {
  type: 'pivotStateChanged';
  pivotMode: boolean;
  /** Ordered pivot column ids (Column Labels). Fresh array each emit. */
  pivotColumns: string[];
  /** Ordered value columns (Values). Fresh array of fresh objects. */
  valueColumns: PivotValueColumn[];
  source: PivotStateChangeSource;
}

/** Serialized snapshot suitable for `JSON.stringify`. Produced by
 *  `serialize()`, consumed by `restore()`. */
export interface PivotStateSnapshot {
  pivotMode: boolean;
  pivotColumns: string[];
  valueColumns: PivotValueColumn[];
}

export class PivotState {
  private pivotMode: boolean;
  private pivotColumns: string[];
  private valueColumns: PivotValueColumn[];
  private readonly events = new TypedEventEmitter<PivotStateChangedEvent>();
  private destroyed = false;

  constructor(init?: {
    pivotMode?: boolean;
    pivotColumns?: string[];
    valueColumns?: PivotValueColumn[];
  }) {
    this.pivotMode = init?.pivotMode ?? false;
    this.pivotColumns = [...(init?.pivotColumns ?? [])];
    this.valueColumns = (init?.valueColumns ?? []).map((v) => ({ ...v }));
  }

  // ─── reads ────────────────────────────────────────────────────────────

  isPivotMode(): boolean {
    return this.pivotMode;
  }

  /** A pivot produces a matrix only when the mode is on AND there is at
   *  least one pivot column AND at least one value column. */
  isPivotActive(): boolean {
    return this.pivotMode && this.pivotColumns.length > 0 && this.valueColumns.length > 0;
  }

  /** Fresh copy of the ordered pivot column ids. */
  getPivotColumns(): string[] {
    return [...this.pivotColumns];
  }

  /** Fresh copy (of fresh objects) of the ordered value columns. */
  getValueColumns(): PivotValueColumn[] {
    return this.valueColumns.map((v) => ({ ...v }));
  }

  // ─── pivotMode ──────────────────────────────────────────────────────────

  /** Flip the master switch. No-op (no event) when unchanged. */
  setPivotMode(next: boolean): void {
    if (this.destroyed) return;
    if (this.pivotMode === next) return;
    this.pivotMode = next;
    this.emitChanged('mode');
  }

  // ─── pivot columns (Column Labels) ───────────────────────────────────────

  /** Append `colId`. Idempotent — a column already present is a no-op. */
  addPivotColumn(colId: string): void {
    if (this.destroyed) return;
    if (this.pivotColumns.includes(colId)) return;
    this.pivotColumns = [...this.pivotColumns, colId];
    this.emitChanged('add');
  }

  /** Remove `colId`. Idempotent — a column not present is a no-op. */
  removePivotColumn(colId: string): void {
    if (this.destroyed) return;
    const idx = this.pivotColumns.indexOf(colId);
    if (idx < 0) return;
    this.pivotColumns = [
      ...this.pivotColumns.slice(0, idx),
      ...this.pivotColumns.slice(idx + 1),
    ];
    this.emitChanged('remove');
  }

  /** Replace the ordered pivot column list wholesale. No-op when
   *  identical to the current list. */
  setPivotColumns(nextColumns: string[]): void {
    if (this.destroyed) return;
    const next = [...nextColumns];
    if (arrayEqual(next, this.pivotColumns)) return;
    this.pivotColumns = next;
    this.emitChanged('set');
  }

  /** Move the pivot column at index `from` to index `to`. Splice
   *  semantics identical to `GroupingState.moveRowGroupColumn`. */
  movePivotColumn(from: number, to: number): void {
    if (this.destroyed) return;
    const next = moveInArray(this.pivotColumns, from, to);
    if (next === null) return;
    this.pivotColumns = next;
    this.emitChanged('move');
  }

  // ─── value columns (Values) ──────────────────────────────────────────────

  /** Append a measure `{ colId, aggFunc }`. Idempotent by colId — a
   *  column already measured is a no-op (use `setValueColumnAggFunc` to
   *  change its function). */
  addValueColumn(colId: string, aggFunc: string): void {
    if (this.destroyed) return;
    if (this.valueColumns.some((v) => v.colId === colId)) return;
    this.valueColumns = [...this.valueColumns, { colId, aggFunc }];
    this.emitChanged('add');
  }

  /** Remove the measure for `colId`. Idempotent. */
  removeValueColumn(colId: string): void {
    if (this.destroyed) return;
    const idx = this.valueColumns.findIndex((v) => v.colId === colId);
    if (idx < 0) return;
    this.valueColumns = [
      ...this.valueColumns.slice(0, idx),
      ...this.valueColumns.slice(idx + 1),
    ];
    this.emitChanged('remove');
  }

  /** Change the aggregation function for an existing measure. No-op when
   *  the column isn't measured OR the function is unchanged. */
  setValueColumnAggFunc(colId: string, aggFunc: string): void {
    if (this.destroyed) return;
    const idx = this.valueColumns.findIndex((v) => v.colId === colId);
    if (idx < 0) return;
    if (this.valueColumns[idx]!.aggFunc === aggFunc) return;
    const next = this.valueColumns.map((v) => ({ ...v }));
    next[idx]!.aggFunc = aggFunc;
    this.valueColumns = next;
    this.emitChanged('aggFunc');
  }

  /** Move the value column at index `from` to index `to`. */
  moveValueColumn(from: number, to: number): void {
    if (this.destroyed) return;
    const next = moveInArray(this.valueColumns, from, to);
    if (next === null) return;
    this.valueColumns = next.map((v) => ({ ...v }));
    this.emitChanged('move');
  }

  // ─── serialize / restore ─────────────────────────────────────────────────

  serialize(): PivotStateSnapshot {
    return {
      pivotMode: this.pivotMode,
      pivotColumns: [...this.pivotColumns],
      valueColumns: this.valueColumns.map((v) => ({ ...v })),
    };
  }

  /** Replace the current state with a previously-serialized snapshot.
   *  Emits once with source `'restore'`. */
  restore(snapshot: PivotStateSnapshot): void {
    if (this.destroyed) return;
    this.pivotMode = snapshot.pivotMode;
    this.pivotColumns = [...snapshot.pivotColumns];
    this.valueColumns = snapshot.valueColumns.map((v) => ({ ...v }));
    this.emitChanged('restore');
  }

  // ─── subscribe / lifecycle ───────────────────────────────────────────────

  on(
    type: 'pivotStateChanged',
    handler: (event: PivotStateChangedEvent) => void,
  ): () => void {
    return this.events.on(type, handler);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.events.destroy();
  }

  private emitChanged(source: PivotStateChangeSource): void {
    this.events.emit({
      type: 'pivotStateChanged',
      pivotMode: this.pivotMode,
      pivotColumns: [...this.pivotColumns],
      valueColumns: this.valueColumns.map((v) => ({ ...v })),
      source,
    });
  }
}

function arrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Move element at `from` to `to` with the same splice-normalisation
 *  `GroupingState.moveRowGroupColumn` uses. Returns a NEW array, or
 *  `null` when the move is a no-op (out of range or same final slot). */
function moveInArray<T>(arr: readonly T[], from: number, to: number): T[] | null {
  const len = arr.length;
  if (from < 0 || from >= len) return null;
  const targetIdx = to < 0 ? 0 : to > len ? len : to;
  let normalised = targetIdx;
  if (targetIdx > from) normalised = targetIdx - 1;
  if (normalised === from) return null;
  const next = [...arr];
  const [plucked] = next.splice(from, 1);
  next.splice(normalised, 0, plucked!);
  return next;
}
