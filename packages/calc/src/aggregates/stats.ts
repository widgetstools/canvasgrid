// Built-in STATISTICAL delta aggregates: PERCENTILE(p) (parameterized),
// MEDIAN (= PERCENTILE(50)), STDEV, VAR, MODE.
//
// Same serialization discipline as basic.ts: every factory is
// self-contained; multiset logic is inlined per factory (a shared
// helper would be a free variable). makePercentile is the ONE
// parameterized factory — its source ships as-is and the worker calls
// factory(p) (arity convention, registry.ts).
//
// PERCENTILE: exact sorted-multiset at all sizes this cycle (spec §1.2
// reserves the t-digest path; `percentileThreshold` is accepted and
// ignored at registration). Definition: PERCENTILE.INC linear
// interpolation between closest ranks. p is PERCENT POINTS (0–100),
// matching the calc DSL literal (aggTransform.ts folds PERCENTILE([x], 95)
// into the fn-string 'PERCENTILE(95)').
//
// STDEV/VAR: Welford's online algorithm with removeRow downdate.
// PRECISION CAVEAT: the downdate is not exactly associative — FP drift
// accumulates and M2 can go slightly negative on near-constant data, so
// M2 is clamped to 0. Property-tested to 1e-9 relative vs a two-pass
// reference over 1k-op streams. Welford cannot detect removal of a
// never-added value; the worker delta path only removes what it added
// (spec §2.3) — that discipline is the caller's contract.

import type { Aggregate } from '../types';

export interface PercentileState { values: number[] }

/** Parameterized factory: PERCENTILE(p), p in [0,100] (clamped). */
export const makePercentile: (p: number) => Aggregate<PercentileState> = (p) => ({
  init() { return { values: [] }; },
  addRow(state: PercentileState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    const values = state.values;
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((values[mid] as number) < value) lo = mid + 1; else hi = mid;
    }
    values.splice(lo, 0, value);
    return state;
  },
  removeRow(state: PercentileState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    const values = state.values;
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((values[mid] as number) < value) lo = mid + 1; else hi = mid;
    }
    if (lo < values.length && values[lo] === value) values.splice(lo, 1); // absent → no-op
    return state;
  },
  updateRow(state: PercentileState, oldValue: unknown, newValue: unknown) {
    return this.addRow(this.removeRow(state, oldValue), newValue);
  },
  finalize(state: PercentileState) {
    const values = state.values;
    const n = values.length;
    if (n === 0) return null;
    const q = Math.min(100, Math.max(0, p));
    const rank = (q / 100) * (n - 1);
    const lo = Math.floor(rank);
    const hi = Math.min(lo + 1, n - 1);
    const vLo = values[lo] as number;
    const vHi = values[hi] as number;
    return vLo + (rank - lo) * (vHi - vLo);
  },
});

/** Local convenience — registered with a source override embedding
 *  makePercentile's source applied at 50 (see registry.ts). */
export const makeMedian: () => Aggregate<PercentileState> = () => makePercentile(50);

export interface WelfordState { n: number; mean: number; m2: number }

export const makeVar: () => Aggregate<WelfordState> = () => ({
  init() { return { n: 0, mean: 0, m2: 0 }; },
  addRow(state: WelfordState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    state.n += 1;
    const d = value - state.mean;
    state.mean += d / state.n;
    state.m2 += d * (value - state.mean);
    return state;
  },
  removeRow(state: WelfordState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    if (state.n === 0) return state; // empty — no-op
    if (state.n === 1) { state.n = 0; state.mean = 0; state.m2 = 0; return state; }
    const meanOld = (state.n * state.mean - value) / (state.n - 1);
    state.m2 -= (value - state.mean) * (value - meanOld);
    if (state.m2 < 0) state.m2 = 0; // FP downdate drift clamp
    state.n -= 1;
    state.mean = meanOld;
    return state;
  },
  updateRow(state: WelfordState, oldValue: unknown, newValue: unknown) {
    return this.addRow(this.removeRow(state, oldValue), newValue);
  },
  finalize(state: WelfordState) {
    return state.n >= 2 ? state.m2 / (state.n - 1) : null; // sample variance
  },
});

export const makeStdev: () => Aggregate<WelfordState> = () => ({
  init() { return { n: 0, mean: 0, m2: 0 }; },
  addRow(state: WelfordState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    state.n += 1;
    const d = value - state.mean;
    state.mean += d / state.n;
    state.m2 += d * (value - state.mean);
    return state;
  },
  removeRow(state: WelfordState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    if (state.n === 0) return state;
    if (state.n === 1) { state.n = 0; state.mean = 0; state.m2 = 0; return state; }
    const meanOld = (state.n * state.mean - value) / (state.n - 1);
    state.m2 -= (value - state.mean) * (value - meanOld);
    if (state.m2 < 0) state.m2 = 0;
    state.n -= 1;
    state.mean = meanOld;
    return state;
  },
  updateRow(state: WelfordState, oldValue: unknown, newValue: unknown) {
    return this.addRow(this.removeRow(state, oldValue), newValue);
  },
  finalize(state: WelfordState) {
    return state.n >= 2 ? Math.sqrt(state.m2 / (state.n - 1)) : null;
  },
});

export interface ModeState { counts: Map<number, number> }

/** MODE — numeric participants; ties resolve to the SMALLEST value
 *  (deterministic across regroups and ticks). */
export const makeMode: () => Aggregate<ModeState> = () => ({
  init() { return { counts: new Map<number, number>() }; },
  addRow(state: ModeState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    state.counts.set(value, (state.counts.get(value) ?? 0) + 1);
    return state;
  },
  removeRow(state: ModeState, value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return state;
    const c = state.counts.get(value) ?? 0;
    if (c === 0) return state; // absent — no-op
    if (c === 1) state.counts.delete(value); else state.counts.set(value, c - 1);
    return state;
  },
  updateRow(state: ModeState, oldValue: unknown, newValue: unknown) {
    return this.addRow(this.removeRow(state, oldValue), newValue);
  },
  finalize(state: ModeState) {
    if (state.counts.size === 0) return null;
    let best: number | null = null;
    let bestCount = 0;
    for (const [v, c] of state.counts) {
      if (c > bestCount || (c === bestCount && best !== null && v < best)) {
        best = v;
        bestCount = c;
      }
    }
    return best;
  },
});
