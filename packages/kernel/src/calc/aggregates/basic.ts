// Built-in BASIC delta aggregates: SUM, COUNT, AVG, MIN, MAX,
// COUNT_DISTINCT.
//
// SERIALIZATION DISCIPLINE (Global Constraints): every factory below is
// SELF-CONTAINED — zero free variables, no imports referenced at
// runtime, no shared helpers. The factory's Function.prototype.toString()
// output must survive `new Function('return (' + src + ')')()` on the
// worker (aggFuncRegistry.ts:14 precedent). The participation rule is
// therefore INLINED in each factory on purpose; globals (Math, Map,
// Number) are fine — reconstructed sources run in worker global scope.
//
// Participation rule: a value participates iff it is not null/undefined
// and, when a number, is finite. SUM/AVG/MIN/MAX additionally require
// typeof 'number'. removeRow applies the identical rule (symmetric
// skip). finalize of an empty state is null — never NaN.
//
// State is MUTATED and returned; callers thread the return value and
// always invoke methods AS METHODS (updateRow delegates through `this`).

import type { Aggregate } from '../types';

export interface SumState { sum: number; n: number }

/** SUM — {sum, n}: n distinguishes empty (→ null) from sums-to-zero (→ 0). */
export const makeSum: () => Aggregate<SumState> = () => ({
  init() { return { sum: 0, n: 0 }; },
  addRow(state: SumState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    state.sum += value;
    state.n += 1;
    return state;
  },
  removeRow(state: SumState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    state.sum -= value;
    state.n -= 1;
    return state;
  },
  updateRow(state: SumState, oldValue: unknown, newValue: unknown) {
    return this.addRow(this.removeRow(state, oldValue), newValue);
  },
  finalize(state: SumState) { return state.n === 0 ? null : state.sum; },
});

export interface CountState { n: number }

/** COUNT — participating values of ANY type (strings/booleans count). */
export const makeCount: () => Aggregate<CountState> = () => ({
  init() { return { n: 0 }; },
  addRow(state: CountState, value: unknown) {
    if (value === null || value === undefined) return state;
    if (typeof value === 'number' && !Number.isFinite(value)) return state;
    state.n += 1;
    return state;
  },
  removeRow(state: CountState, value: unknown) {
    if (value === null || value === undefined) return state;
    if (typeof value === 'number' && !Number.isFinite(value)) return state;
    state.n -= 1;
    return state;
  },
  updateRow(state: CountState, oldValue: unknown, newValue: unknown) {
    return this.addRow(this.removeRow(state, oldValue), newValue);
  },
  finalize(state: CountState) { return state.n === 0 ? null : state.n; },
});

export interface AvgState { sum: number; n: number }

export const makeAvg: () => Aggregate<AvgState> = () => ({
  init() { return { sum: 0, n: 0 }; },
  addRow(state: AvgState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    state.sum += value;
    state.n += 1;
    return state;
  },
  removeRow(state: AvgState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    state.sum -= value;
    state.n -= 1;
    return state;
  },
  updateRow(state: AvgState, oldValue: unknown, newValue: unknown) {
    return this.addRow(this.removeRow(state, oldValue), newValue);
  },
  finalize(state: AvgState) { return state.n === 0 ? null : state.sum / state.n; },
});

export interface MinMaxState {
  /** Binary min-heap of STORED values (MAX stores negated). Entries are
   *  never removed eagerly — stale tops pop lazily at finalize. */
  heap: number[];
  /** stored value → live count (lazy delete). */
  live: Map<number, number>;
  /** Total live participating values (empty detection). */
  n: number;
}

/** MIN — heap + live-count lazy delete: addRow O(log n), removeRow O(1),
 *  finalize amortized O(log n). removeRow of an absent value: no-op. */
export const makeMin: () => Aggregate<MinMaxState> = () => ({
  init() { return { heap: [], live: new Map<number, number>(), n: 0 }; },
  addRow(state: MinMaxState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    state.live.set(value, (state.live.get(value) ?? 0) + 1);
    state.n += 1;
    const heap = state.heap;
    heap.push(value);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] as number) <= (heap[i] as number)) break;
      const t = heap[p] as number; heap[p] = heap[i] as number; heap[i] = t;
      i = p;
    }
    return state;
  },
  removeRow(state: MinMaxState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    const c = state.live.get(value) ?? 0;
    if (c === 0) return state; // absent — no-op
    if (c === 1) state.live.delete(value); else state.live.set(value, c - 1);
    state.n -= 1;
    return state; // heap entry stays; popped lazily at finalize
  },
  updateRow(state: MinMaxState, oldValue: unknown, newValue: unknown) {
    return this.addRow(this.removeRow(state, oldValue), newValue);
  },
  finalize(state: MinMaxState) {
    if (state.n === 0) return null;
    const heap = state.heap;
    for (;;) {
      if (heap.length === 0) return null; // unreachable while n > 0 — defensive
      const top = heap[0] as number;
      if ((state.live.get(top) ?? 0) > 0) return top;
      const last = heap.pop() as number;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let s = i;
          if (l < heap.length && (heap[l] as number) < (heap[s] as number)) s = l;
          if (r < heap.length && (heap[r] as number) < (heap[s] as number)) s = r;
          if (s === i) break;
          const t = heap[s] as number; heap[s] = heap[i] as number; heap[i] = t;
          i = s;
        }
      }
    }
  },
});

/** MAX — same structure as MIN with values NEGATED into the min-heap
 *  (finalize negates back; 0/-0 collide safely under SameValueZero). */
export const makeMax: () => Aggregate<MinMaxState> = () => ({
  init() { return { heap: [], live: new Map<number, number>(), n: 0 }; },
  addRow(state: MinMaxState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    const v = -value;
    state.live.set(v, (state.live.get(v) ?? 0) + 1);
    state.n += 1;
    const heap = state.heap;
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] as number) <= (heap[i] as number)) break;
      const t = heap[p] as number; heap[p] = heap[i] as number; heap[i] = t;
      i = p;
    }
    return state;
  },
  removeRow(state: MinMaxState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    const v = -value;
    const c = state.live.get(v) ?? 0;
    if (c === 0) return state; // absent — no-op
    if (c === 1) state.live.delete(v); else state.live.set(v, c - 1);
    state.n -= 1;
    return state;
  },
  updateRow(state: MinMaxState, oldValue: unknown, newValue: unknown) {
    return this.addRow(this.removeRow(state, oldValue), newValue);
  },
  finalize(state: MinMaxState) {
    if (state.n === 0) return null;
    const heap = state.heap;
    for (;;) {
      if (heap.length === 0) return null; // defensive
      const top = heap[0] as number;
      if ((state.live.get(top) ?? 0) > 0) return -top;
      const last = heap.pop() as number;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let s = i;
          if (l < heap.length && (heap[l] as number) < (heap[s] as number)) s = l;
          if (r < heap.length && (heap[r] as number) < (heap[s] as number)) s = r;
          if (s === i) break;
          const t = heap[s] as number; heap[s] = heap[i] as number; heap[i] = t;
          i = s;
        }
      }
    }
  },
});

export interface DistinctState { counts: Map<unknown, number> }

/** COUNT_DISTINCT — Map<value, count>; SameValueZero key semantics. */
export const makeCountDistinct: () => Aggregate<DistinctState> = () => ({
  init() { return { counts: new Map<unknown, number>() }; },
  addRow(state: DistinctState, value: unknown) {
    if (value === null || value === undefined) return state;
    if (typeof value === 'number' && !Number.isFinite(value)) return state;
    state.counts.set(value, (state.counts.get(value) ?? 0) + 1);
    return state;
  },
  removeRow(state: DistinctState, value: unknown) {
    if (value === null || value === undefined) return state;
    if (typeof value === 'number' && !Number.isFinite(value)) return state;
    const c = state.counts.get(value) ?? 0;
    if (c === 0) return state; // absent — no-op
    if (c === 1) state.counts.delete(value); else state.counts.set(value, c - 1);
    return state;
  },
  updateRow(state: DistinctState, oldValue: unknown, newValue: unknown) {
    return this.addRow(this.removeRow(state, oldValue), newValue);
  },
  finalize(state: DistinctState) {
    return state.counts.size === 0 ? null : state.counts.size;
  },
});
