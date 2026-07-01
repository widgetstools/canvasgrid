/**
 * Cycle 8 / Task 3 — worker-side registry of named comparators.
 *
 * Apps register a comparator by name via `CGridApi.registerComparator(name,
 * fn)`. The function string-serialises on the main thread, ships across
 * `postMessage` as source text, and reconstructs on the worker via
 * `new Function(...)`. Column defs reference the registered comparator
 * through `comparator: 'name'`; when the worker's `SortPass` encounters a
 * string-valued `comparator` on a `WorkerColumn`, it dispatches the cell
 * compare through the matching registered function instead of the built-in
 * text/number comparator.
 *
 * Unknown names (registration missing, dropped, or never sent) fall back to
 * the built-in compare so a slow main-thread / worker race never produces a
 * sort crash mid-pipeline — the column simply lexicographically sorts until
 * the registration lands.
 *
 * Closures don't cross `postMessage`, so `comparator: (a, b) => …` on a
 * col def is rejected at `setSortModel` time main-side with an error that
 * points the app at this registry.
 */
export type ComparatorFn = (a: unknown, b: unknown) => number;

export class ComparatorRegistry {
  private map = new Map<string, ComparatorFn>();

  /** Register `fn` under `name`. Re-registering overwrites. */
  register(name: string, fn: ComparatorFn): void {
    this.map.set(name, fn);
  }

  /** Look up the comparator for `name`. Returns `undefined` when the name
   *  hasn't been registered — callers fall back to the default compare. */
  get(name: string): ComparatorFn | undefined {
    return this.map.get(name);
  }
}
