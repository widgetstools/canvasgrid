/**
 * Pure aggregation math — the canonical `count / sum / min / max / avg`
 * implementation the worker's `AggFuncRegistry` built-ins delegate to.
 *
 * PORT-NOTE: ported from `packages/kernel/src/interaction/statusBar/aggMath.ts`.
 * Legacy deliberately let the worker bundle carry one canonical copy of this
 * math (the status-bar panel and the worker both call it, and it must agree
 * byte-for-byte between the two surfaces). The rebuild's `src/interaction/`
 * has not landed, so the copy lives inside the worker's own scope. When the
 * interaction port lands its `statusBar/aggMath`, both surfaces must keep
 * importing THE SAME module — collapse this to a re-export rather than
 * letting the two drift.
 *
 * Semantics preserved verbatim:
 * - NaN / Infinity / non-finite values are skipped from numeric aggregates
 *   but DO count toward `count`.
 * - Mixed-type input: every supplied value contributes to `count`; only
 *   finite numerics contribute to sum / min / max / avg.
 * - Empty numeric input — `sum` returns `0` (matches `SUM()` on an empty
 *   numeric set); `min` / `max` / `avg` return `NaN` to signal "undefined
 *   for an empty set".
 */

/** The canonical agg func vocabulary. */
export type AggFunc = 'count' | 'sum' | 'min' | 'max' | 'avg';

/** Canonical render order for the agg panel. */
export const CANONICAL_AGG_ORDER: readonly AggFunc[] = ['count', 'sum', 'min', 'max', 'avg'];

/** Aggregation result for one func. `count` is always an integer ≥ 0;
 *  `sum` is `0` for an empty numeric set, a finite number otherwise; the
 *  remaining funcs return `NaN` when there's no numeric input. */
export type AggregateResult = Record<AggFunc, number>;

function isAggregable(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Aggregate `values` and return the requested `funcs`. The result object
 * ALWAYS carries every key in `CANONICAL_AGG_ORDER` — funcs the caller
 * didn't request are present with their natural "no input" value.
 *
 * Single-pass: walks `values` once with no per-element allocation.
 */
export function aggregate(
  values: readonly unknown[],
  funcs: readonly AggFunc[] = CANONICAL_AGG_ORDER,
): AggregateResult {
  const result: AggregateResult = {
    count: 0,
    sum: 0,
    min: NaN,
    max: NaN,
    avg: NaN,
  };

  let numericCount = 0;
  let numericSum = 0;
  let minVal = Infinity;
  let maxVal = -Infinity;
  let totalCount = 0;

  const wantCount = funcs.includes('count');
  const wantSum = funcs.includes('sum');
  const wantMin = funcs.includes('min');
  const wantMax = funcs.includes('max');
  const wantAvg = funcs.includes('avg');
  // Avg needs sum + count whether or not the caller asked for them.
  const accumulateNumerics = wantSum || wantMin || wantMax || wantAvg;

  for (let i = 0; i < values.length; i++) {
    totalCount += 1;
    if (!accumulateNumerics) continue;
    const v = values[i];
    if (!isAggregable(v)) continue;
    numericCount += 1;
    numericSum += v;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }

  if (wantCount) result.count = totalCount;
  if (wantSum) result.sum = numericSum;
  if (wantMin) result.min = numericCount > 0 ? minVal : NaN;
  if (wantMax) result.max = numericCount > 0 ? maxVal : NaN;
  if (wantAvg) result.avg = numericCount > 0 ? numericSum / numericCount : NaN;

  return result;
}
