/**
 * Cycle 14 / Task 3 — worker-side registry of named column-aggregation
 * functions.
 *
 * Apps declare aggregations on column defs by name:
 *
 *     { field: 'notional', aggFunc: 'sum' }            // built-in
 *     { field: 'rating',   aggFunc: 'p99' }            // custom — registered via setAggFuncs
 *     { field: 'volume',   aggFunc: ['p99', 'avg'] }   // ordered fallback list
 *
 * Built-in names are pre-registered at construction. Custom names ride a
 * `setAggFuncs` worker message — the main thread serialises the
 * function via `Function.prototype.toString()` and the worker
 * reconstructs the callable through `new Function(...)` (mirrors the
 * Cycle 8 / Task 3 ComparatorRegistry serialisation pattern).
 *
 * **Single source of truth.** The math for `sum / avg / min / max /
 * count` lives in `interaction/statusBar/aggMath.ts` — the canonical
 * implementation the status panel's `agAggregationComponent` already
 * uses (Cycle 13 / Task 3). The worker built-ins delegate straight
 * through the same `aggregate(values, funcs)` call so the totals row
 * and the agg panel can never silently diverge on (e.g.) NaN / Infinity
 * handling. `first` / `last` are local one-liners — not "math", just
 * array access.
 *
 * The decision (per the Cycle 14 worklog Global Constraint 8 — "aggMath
 * is the single source of truth for agg math") is to *share* the module
 * rather than duplicate it with a `@generated` header. Vite's lib mode
 * (see `cgrid/vite.config.ts`) builds the worker entry as its own
 * bundle that pulls shared modules in, so the worker bundle already
 * carries one canonical copy of `aggMath`.
 *
 * **Closure semantics.** Custom funcs are reconstructed via
 * `new Function(...)` and run in the worker's global scope; any
 * outer-scope identifier the original closed over throws a
 * `ReferenceError` at first invocation. The main-thread serialiser
 * detects this BEFORE shipping (rebuilds + probes the function locally)
 * and throws a clear error pointing the app at this constraint — so the
 * worker never sees a deserialised function that would fail mid-pass.
 */

import { aggregate as aggregateValues } from '../interaction/statusBar/aggMath';
import type { IAggFunc, IAggFuncParams } from '../types';

/** Names of the built-in aggregations. Apps reference these by string
 *  on a column's `aggFunc` field. The order documents the catalog
 *  presentation order (sum / avg / min / max / count / first / last) —
 *  not load-bearing, just convention. */
export const BUILTIN_AGG_FUNC_NAMES: readonly string[] = [
  'sum', 'avg', 'min', 'max', 'count', 'first', 'last',
];

/** Construct the built-in agg funcs. Factored out so tests can spy on
 *  the implementation without touching the registry class. The numeric
 *  built-ins thread through the shared `aggMath.aggregate()` so they
 *  match the status panel's behaviour bit-for-bit. */
function builtinAggFuncs(): Record<string, IAggFunc> {
  return {
    sum:   ({ values }) => aggregateValues(values, ['sum']).sum,
    avg:   ({ values }) => {
      const r = aggregateValues(values, ['avg']).avg;
      // aggregate() returns NaN for "no numeric input" — surface that
      // as `null` so the totals cell renders the design-pass placeholder
      // instead of a literal `NaN` string.
      return Number.isNaN(r) ? null : r;
    },
    min:   ({ values }) => {
      const r = aggregateValues(values, ['min']).min;
      return Number.isNaN(r) ? null : r;
    },
    max:   ({ values }) => {
      const r = aggregateValues(values, ['max']).max;
      return Number.isNaN(r) ? null : r;
    },
    // `count` over a column's filtered values — every supplied value
    // contributes regardless of type (matches the agg panel's
    // decision 6 — see `aggMath.ts`). aggregate() short-circuits the
    // numeric loop when only count is requested.
    count: ({ values }) => aggregateValues(values, ['count']).count,
    // `first` / `last` — trivial array access. Returning `null` for
    // empty input keeps the chunk.totals entry serialisable across
    // postMessage (undefined would be dropped by structured-clone).
    first: ({ values }) => (values.length > 0 ? values[0] : null),
    last:  ({ values }) => (values.length > 0 ? values[values.length - 1] : null),
  };
}

/**
 * Lookup + registration surface for column aggregation functions.
 *
 * - `resolve(name | name[])` returns the first matching registered
 *   function. The array form lets a column declare an ordered fallback
 *   list (`aggFunc: ['p99', 'avg']` reads as "use p99 when registered,
 *   otherwise avg"). Unknown names return `undefined`; the caller
 *   (`AggPass`) leaves the column's totals entry empty so the totals
 *   row paints the cell blank.
 * - `register(name, fn)` adds or replaces an entry. Custom entries
 *   can mask built-ins (e.g. an app-specific `'sum'` that ignores
 *   negative values).
 * - `replaceCustom(funcs)` swaps the custom layer wholesale without
 *   disturbing the built-ins — keeps `setGridOption('aggFuncs', …)`
 *   semantics aligned with "new map replaces the previous one"
 *   while still letting custom entries shadow built-ins.
 */
export class AggFuncRegistry {
  private builtin: Record<string, IAggFunc>;
  private custom = new Map<string, IAggFunc>();

  constructor() {
    this.builtin = builtinAggFuncs();
  }

  /** Add or replace a custom aggFunc. Custom entries take precedence
   *  over a built-in of the same name. */
  register(name: string, fn: IAggFunc): void {
    this.custom.set(name, fn);
  }

  /** Drop a custom entry. The built-in (if any) becomes visible again. */
  unregister(name: string): void {
    this.custom.delete(name);
  }

  /** Wholesale replace the custom layer. Keeps built-ins intact. Called
   *  by the worker handler on `setAggFuncs` so a runtime
   *  `setGridOption('aggFuncs', { ... })` matches the "replaces previous
   *  map" semantics documented in `VelocityGridOptions.aggFuncs`. */
  replaceCustom(funcs: Record<string, IAggFunc>): void {
    this.custom = new Map(Object.entries(funcs));
  }

  /** Look up by name. Custom layer first; falls through to built-ins.
   *  Unknown name → `undefined`. */
  get(name: string): IAggFunc | undefined {
    return this.custom.get(name) ?? this.builtin[name];
  }

  /** Resolve a column's `aggFunc` field (single name or fallback array)
   *  to the first matching function. Returns `undefined` when no entry
   *  in the list resolves — the caller skips emitting a totals entry
   *  for the column. */
  resolve(nameOrList: string | string[] | undefined): IAggFunc | undefined {
    if (nameOrList === undefined) return undefined;
    if (typeof nameOrList === 'string') return this.get(nameOrList);
    for (const n of nameOrList) {
      const fn = this.get(n);
      if (fn) return fn;
    }
    return undefined;
  }

  /** Test hook — list the names currently registered (custom + built-in,
   *  custom takes precedence on collision). Not used by the worker
   *  itself; lets tests assert registration round-trips. */
  knownNames(): string[] {
    const out = new Set<string>(Object.keys(this.builtin));
    for (const k of this.custom.keys()) out.add(k);
    return Array.from(out);
  }
}

/** Re-export the params shape so the worker's aggPass can type the
 *  invocation site without reaching back into `types.ts` (which would
 *  pull the whole public surface into the worker bundle). */
export type { IAggFunc, IAggFuncParams };
