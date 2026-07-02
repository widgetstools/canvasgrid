// @cgrid/renderers — main-side incremental column statistics. §2.4a.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21f-renderers-design.md §2.4a.
//
// Incremental min/max/maxAbs/sum/count per watched column over the full row
// set (scope = ALL rows; a 'visible' scope is a documented follow-up needing
// a visible-set feed). Seeded by `grid.forEachRow`, updated from the 21e
// listener-gated `rowsChanged` event. Consumed by HeatCell/BidirectionalBarCell/
// VolumeBar through their `stats` param (a plain `ColumnStatSnapshot` — the
// bridge's builders wire `heatCell.params.stats = stats.for('pnl')`).

import type { CGridApi } from '@cgrid/kernel';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Nullable snapshot of incremental column stats. null sentinels when no
 *  numeric values exist (empty set / all non-participating values). */
export interface ColumnStatSnapshot {
  min: number | null;
  max: number | null;
  maxAbs: number | null;
  sum: number | null;
  count: number;
}

// ---------------------------------------------------------------------------
// Heap helpers — lazy-delete binary min-heap + live-count map.
// Algorithm: packages/calc/src/aggregates/basic.ts:100-212 (reimplemented
// locally; no @cgrid/calc dep this cycle per §2.1).
// ---------------------------------------------------------------------------

interface HeapState {
  heap: number[];
  live: Map<number, number>;
  n: number;
}

function heapInit(): HeapState {
  return { heap: [], live: new Map(), n: 0 };
}

function heapPush(state: HeapState, v: number): void {
  state.live.set(v, (state.live.get(v) ?? 0) + 1);
  state.n += 1;
  const h = state.heap;
  h.push(v);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if ((h[p] as number) <= (h[i] as number)) break;
    const t = h[p] as number; h[p] = h[i] as number; h[i] = t;
    i = p;
  }
}

function heapRemove(state: HeapState, v: number): void {
  const c = state.live.get(v) ?? 0;
  if (c === 0) return; // absent — no-op
  if (c === 1) state.live.delete(v); else state.live.set(v, c - 1);
  state.n -= 1;
  // Heap entry stays; popped lazily by heapMin.
}

/** Lazily pops dead entries from the top, returns the live minimum or null. */
function heapMin(state: HeapState): number | null {
  if (state.n === 0) return null;
  const h = state.heap;
  for (;;) {
    if (h.length === 0) return null; // defensive
    const top = h[0] as number;
    if ((state.live.get(top) ?? 0) > 0) return top;
    // Pop the dead top and sift down.
    const last = h.pop() as number;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < h.length && (h[l] as number) < (h[s] as number)) s = l;
        if (r < h.length && (h[r] as number) < (h[s] as number)) s = r;
        if (s === i) break;
        const t = h[s] as number; h[s] = h[i] as number; h[i] = t;
        i = s;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-column accumulator
// ---------------------------------------------------------------------------

interface ColAcc {
  /** Min-heap of raw values. */
  minH: HeapState;
  /** Max-as-min-heap: values stored negated; finalize negates back. */
  maxH: HeapState;
  /** MaxAbs-as-min-heap: values stored negated-abs; finalize negates back. */
  maxAbsH: HeapState;
  sum: number;
  count: number;
}

function accInit(): ColAcc {
  return { minH: heapInit(), maxH: heapInit(), maxAbsH: heapInit(), sum: 0, count: 0 };
}

function accAdd(acc: ColAcc, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  heapPush(acc.minH, value);
  heapPush(acc.maxH, -value);
  heapPush(acc.maxAbsH, -Math.abs(value));
  acc.sum += value;
  acc.count += 1;
}

function accRemove(acc: ColAcc, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  heapRemove(acc.minH, value);
  heapRemove(acc.maxH, -value);
  heapRemove(acc.maxAbsH, -Math.abs(value));
  acc.sum -= value;
  acc.count -= 1;
}

function accSnapshot(acc: ColAcc): ColumnStatSnapshot {
  if (acc.count === 0) {
    return { min: null, max: null, maxAbs: null, sum: null, count: 0 };
  }
  const minRaw = heapMin(acc.minH);
  const maxNeg = heapMin(acc.maxH);
  const maxAbsNeg = heapMin(acc.maxAbsH);
  return {
    min: minRaw,
    max: maxNeg !== null ? -maxNeg : null,
    maxAbs: maxAbsNeg !== null ? -maxAbsNeg : null,
    sum: acc.sum,
    count: acc.count,
  };
}

// ---------------------------------------------------------------------------
// rowsChanged event type (mirrors kernel's event shape at event.ts ~133-138)
// ---------------------------------------------------------------------------

type RowsChangedEvent<TRow> = {
  type: 'rowsChanged';
  added: Array<{ rowId: string; row: TRow }>;
  updated: Array<{ rowId: string; row: TRow; oldRow: TRow }>;
  removed: Array<{ rowId: string; row: TRow }>;
  source: 'transaction' | 'transactionAsync' | 'edit';
};

/**
 * Row-change payload shape ColumnStats consumes (mirrors kernel's `rowsChanged` event).
 * Re-exported for backwards compatibility with index.ts.
 * @deprecated Use the kernel's own rowsChanged event type directly.
 */
export interface RowsChangedPayload {
  added?: ReadonlyArray<Record<string, unknown>>;
  updated?: ReadonlyArray<{ prev: Record<string, unknown>; next: Record<string, unknown> }>;
  removed?: ReadonlyArray<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// ColumnStats — public class
// ---------------------------------------------------------------------------

/**
 * Incremental min/max/maxAbs/sum/count tracker for a fixed set of watched
 * `colId`s. Seeded from the full row set via `grid.forEachRow`, kept current
 * from the `rowsChanged` event. `for(colId)` is O(1).
 *
 * `CGridApi` is a peerDependency type-only import — erased at runtime.
 */
export class ColumnStats<TRow = unknown> {
  private readonly _accs: Map<string, ColAcc>;
  private readonly _colIds: readonly string[];
  private readonly _valueGetter: (row: TRow, colId: string) => unknown;
  private readonly _handler: (e: RowsChangedEvent<TRow>) => void;
  private readonly _grid: CGridApi<TRow>;

  constructor(
    grid: CGridApi<TRow>,
    colIds: string[],
    opts?: { valueGetter?: (row: TRow, colId: string) => unknown },
  ) {
    this._grid = grid;
    this._colIds = colIds;
    this._valueGetter = opts?.valueGetter ?? ((row, colId) => (row as Record<string, unknown>)[colId]);

    // Initialise per-column accumulators.
    this._accs = new Map(colIds.map(id => [id, accInit()]));

    // Seed from full row set.
    grid.forEachRow((_rowId, row) => {
      for (const colId of this._colIds) {
        const acc = this._accs.get(colId);
        if (acc !== undefined) accAdd(acc, this._valueGetter(row, colId));
      }
    });

    // Subscribe to incremental updates.
    this._handler = (e: RowsChangedEvent<TRow>) => {
      for (const { row } of e.added) {
        for (const colId of this._colIds) {
          const acc = this._accs.get(colId);
          if (acc !== undefined) accAdd(acc, this._valueGetter(row, colId));
        }
      }
      for (const { row, oldRow } of e.updated) {
        for (const colId of this._colIds) {
          const acc = this._accs.get(colId);
          if (acc !== undefined) {
            accRemove(acc, this._valueGetter(oldRow, colId));
            accAdd(acc, this._valueGetter(row, colId));
          }
        }
      }
      for (const { row } of e.removed) {
        for (const colId of this._colIds) {
          const acc = this._accs.get(colId);
          if (acc !== undefined) accRemove(acc, this._valueGetter(row, colId));
        }
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    grid.addEventListener('rowsChanged', this._handler as any);
  }

  /**
   * Returns the current snapshot for one watched column. O(1) — returns the
   * live accumulator record (amortised heap lazy-pops at finalize time).
   * Returns null sentinels when the column has no numeric values.
   */
  for(colId: string): Readonly<ColumnStatSnapshot> {
    const acc = this._accs.get(colId);
    if (acc === undefined) return { min: null, max: null, maxAbs: null, sum: null, count: 0 };
    return accSnapshot(acc);
  }

  /** Removes the rowsChanged subscription. */
  destroy(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._grid.removeEventListener('rowsChanged', this._handler as any);
  }
}
