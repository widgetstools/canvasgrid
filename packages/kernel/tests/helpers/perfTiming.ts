/**
 * Timing helpers for the perf suites.
 *
 * A perf test should fail when the CODE got slower, not when the MACHINE got
 * busier. Timing a single run does not distinguish those, and these suites had
 * budgets as tight as 0.01ms — where one garbage-collection pause, which is
 * measured in whole milliseconds, is a hundred times the entire budget. Such a
 * test passes only while the machine happens to be idle, and fails on a loaded
 * CI runner for reasons no one can act on.
 *
 * Two properties make a wall-clock measurement usable:
 *
 *   1. Discard the first run. An engine optimises a function once it has seen
 *      it a few times, so run one is systematically slower for reasons that
 *      have nothing to do with the code under test. Comparing a cold run
 *      against a warm one — which is what the pivot strict/non-strict ratio
 *      test did — measures the warm-up, not the branch.
 *
 *   2. Keep the FASTEST run, not the average. Noise is one-directional: a GC
 *      pause or the scheduler preempting the thread only ever ADDS time,
 *      never subtracts it. So the minimum is the sample least contaminated by
 *      whatever else the machine was doing, and it is stable where a single
 *      measurement is not. An average, by contrast, is dragged around by
 *      exactly the outliers that have nothing to do with the code.
 *
 * This is why widening the budgets was not the fix on its own: a wider bound
 * still fails eventually, and it weakens the assertion every time it is
 * widened. Measuring properly lets the bounds stay meaningful.
 */

/** Runs to discard before measuring, so the engine has optimised the path. */
const WARMUP_RUNS = 2;
/** Timed runs to take the minimum of. */
const TIMED_RUNS = 5;

/**
 * The fastest of several runs of `fn`, in milliseconds.
 *
 * Use this anywhere a test asserts a duration. `runs` can be lowered for an
 * operation expensive enough that repeating it dominates the suite.
 */
export function fastestOf(fn: () => void, runs: number = TIMED_RUNS, warmups: number = WARMUP_RUNS): number {
  for (let i = 0; i < warmups; i++) fn();
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    const elapsed = performance.now() - t0;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

/**
 * Time two alternatives fairly and return their ratio, largest over smallest.
 *
 * Both are warmed before either is timed, so neither pays the other's
 * optimisation cost — the asymmetry that made a same-code comparison read as a
 * 7× difference. `floor` guards the division: below it the numbers are shorter
 * than the clock can resolve, and a ratio of two rounding errors means nothing.
 */
export function timingRatio(a: () => void, b: () => void, floor = 0.1): number {
  const ta = fastestOf(a);
  const tb = fastestOf(b);
  return Math.max(ta, tb) / Math.max(floor, Math.min(ta, tb));
}
