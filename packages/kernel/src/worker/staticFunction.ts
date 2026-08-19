/**
 * The worker reconstructs several app-supplied callbacks from source text
 * shipped over `postMessage` (custom aggFuncs, comparators, group
 * `keyCreator`s, calc programs) via `new Function(...)`, which runs with
 * full access to the worker's `self`. This is the ONE authorized call
 * site for that reconstruction — every other place in this package that
 * needs it MUST route through `createStaticFunction` so the trust
 * boundary is a single, auditable chokepoint instead of several
 * independently-trusted `new Function` calls scattered across the worker.
 *
 * TRUST CONTRACT: `source` must never be built from row data, cell
 * values, or any other user-authored / runtime string. It must originate
 * ONLY from a column, agg-func, comparator, or calc-program definition
 * the HOST APPLICATION supplied at grid-configuration time (i.e. the
 * `Function.prototype.toString()` form of a callback the app itself
 * wrote into `VelocityGridOptions` / `CColDef`). This function performs
 * NO sandboxing — it is a construction chokepoint, not a security
 * boundary. A call site that starts building `source` from anything
 * row/cell-derived is a bug; keeping every call in one place makes that
 * violation a single spot to catch in review.
 */
export function createStaticFunction(source: string, context: string): Function {
  let fn: unknown;
  try {
    fn = new Function(`"use strict"; return (${source});`)();
  } catch (err) {
    throw new Error(`[velocity-grid] failed to deserialise ${context}: ${String((err as Error).message ?? err)}`);
  }
  if (typeof fn !== 'function') {
    throw new Error(`[velocity-grid] ${context} did not deserialise to a function`);
  }
  return fn as Function;
}
