/**
 * Cycle 13 / Task 3 — pure aggregation math for the
 * `agAggregationComponent` status panel.
 *
 * Splits the math (this file) from the panel (`panels/aggregation.ts`) for
 * three reasons:
 *
 * 1. **Perf-gate.** The cycle worklog Architecture section pins
 *    "≤ 500 selected cells aggregated in ≤ 1 ms" as a hard ceiling. That
 *    target is easier to defend (and test) when the math is a pure
 *    function with no DOM / event surface around it.
 * 2. **Worker offload (Cycle 14).** Cycle 14 / Aggregation UI ships the
 *    worker pipeline. Keeping the math as a pure module means the same
 *    code runs on either thread without a fork; the offload becomes
 *    "post to worker, await result" rather than "rewrite math".
 * 3. **Testability.** The 18-case test suite proves each agg func against
 *    edge cases (empty / NaN / mixed types / Infinity) without standing
 *    up a panel, an api stub, or a DOM.
 *
 * Honours the design-pass decisions (`cycle-13-statusbar-design.md` §
 * Task 3):
 *
 * - **Decision 5** — NaN / Infinity / non-finite values are silently
 *   skipped from numeric aggregates but DO count toward `Count`.
 * - **Decision 6** — mixed-type input: every supplied value contributes
 *   to `Count`; only finite numerics contribute to Sum / Min / Max / Avg.
 * - **Empty numeric input** — Sum returns `0` (mathematical convention,
 *   matches `[].reduce((s, v) => s + v, 0)`); Min / Max / Avg return
 *   `NaN` to signal "undefined for an empty set". The panel renders NaN
 *   as the em-dash placeholder per design decision 5.
 *
 * Why we don't always return NaN for empty Sum: a column of nothing-but-
 * strings still wants a Sum cell that reads as "zero contribution"
 * (consistent with `SUM()` in Excel / SQL on an empty numeric set).
 * Returning NaN here would force every consumer to special-case Sum,
 * which is more code surface for the same render outcome (the panel
 * shows `Sum: 0` for a string-only selection with at least one row,
 * which matches the spreadsheet expectation).
 */

/** The canonical agg func vocabulary. Matches the catalog's
 *  `AggregationStatusPanelAggFunc` union (`docs/catalog/18-status-bar.md`)
 *  and the order panels render in (Count → Sum → Min → Max → Avg per
 *  design decision 3). */
export type AggFunc = 'count' | 'sum' | 'min' | 'max' | 'avg';

/** Canonical render order for the agg panel. Re-exported so the panel
 *  and any future consumer (sidecar, debug tool) share one source of
 *  truth. */
export const CANONICAL_AGG_ORDER: readonly AggFunc[] = ['count', 'sum', 'min', 'max', 'avg'];

/** Aggregation result for one func. `count` is always an integer ≥ 0;
 *  `sum` is `0` for an empty numeric set, a finite number otherwise; the
 *  remaining funcs return `NaN` when there's no numeric input to operate
 *  on (the panel renders that as the em-dash). */
export type AggregateResult = Record<AggFunc, number>;

/** Internal — true when `v` is a finite number we can include in the
 *  numeric aggregates. Filters out NaN, ±Infinity, non-numbers (the
 *  caller may have passed `unknown[]`, so we check both type and
 *  finiteness). The caller-side decision 6 — "mixed-type selections
 *  aggregate over the numerics, ignore the rest" — funnels through
 *  this single predicate. */
function isAggregable(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Aggregate `values` and return the requested `funcs`. The result
 * object ALWAYS carries every key in `CANONICAL_AGG_ORDER` — funcs
 * the caller didn't request are present with their natural "no input"
 * value (`0` for `count` / `sum`, `NaN` for `min` / `max` / `avg`).
 * This keeps the type stable (`Record<AggFunc, number>`) without
 * forcing the panel to branch per-func at the render site.
 *
 * Single-pass: walks `values` once, accumulating each requested func
 * inline. The perf-gate (≤ 1 ms over 500 cells) holds because the loop
 * does no allocation per element and the per-iter branches are constant.
 *
 * - `values: readonly unknown[]` — accepts the raw cell values straight
 *   off `api.getCellValue(...)` without forcing the caller to pre-filter
 *   or pre-cast. The internal `isAggregable` guard sorts numerics from
 *   the rest in a single check.
 * - `funcs: readonly AggFunc[]` — which aggregates to actually compute.
 *   Funcs NOT in this list still get a defined key in the result (with
 *   the no-input default), so the result type is stable.
 *
 * Edge cases:
 * - Empty `values`: `count=0`, `sum=0`, `min=NaN`, `max=NaN`, `avg=NaN`.
 * - All non-finite (NaN, Infinity, strings, null): `count=values.length`
 *   (every cell counts toward count regardless of type — design
 *   decision 6), `sum=0`, `min/max/avg=NaN`.
 * - Single value `[42]`: `count=1`, `sum=42`, `min=42`, `max=42`,
 *   `avg=42`.
 */
export function aggregate(
  values: readonly unknown[],
  funcs: readonly AggFunc[] = CANONICAL_AGG_ORDER,
): AggregateResult {
  // Result skeleton with "no input" defaults. This is the contract
  // documented above — every key is always defined.
  const result: AggregateResult = {
    count: 0,
    sum: 0,
    min: NaN,
    max: NaN,
    avg: NaN,
  };

  // Single-pass accumulators. We accumulate numericCount + numericSum
  // unconditionally so `avg` can derive from them at the end without
  // a second pass (the perf-gate motivation). `min` / `max` track the
  // running extremes only when the func is requested.
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
  // Avg needs sum + count whether or not the caller asked for them, so
  // force the internal aggregates on when only `avg` is requested.
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
