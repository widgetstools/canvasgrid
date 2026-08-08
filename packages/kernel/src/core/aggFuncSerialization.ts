/**
 * Cycle 14 / Task 3 — serialise custom `aggFuncs` for the worker.
 *
 * Lifted out of `velocityGrid.ts` so the closure-detection / `new Function`
 * round-trip lives in one place. Apps MUST treat `aggFunc` sources as
 * trusted code: reconstruction uses `new Function` on both main and
 * worker. Do not feed untrusted function source strings.
 */

import type { IAggFunc, IAggFuncParams } from '../types/group';

/**
 * Round-trip `fn` through `Function.prototype.toString()` +
 * `new Function(...)` and probe for closure capture. Returns the
 * serialised `source` string the worker should rebuild from.
 */
export function serializeAggFunc(name: string, fn: IAggFunc): string {
  const source = fn.toString();
  let rebuilt: IAggFunc;
  try {
    rebuilt = new Function(`"use strict"; return (${source});`)() as IAggFunc;
  } catch (e) {
    throw new Error(
      `[velocity-grid] aggFunc '${name}' failed to serialise (syntax error in toString output): ${
        String((e as Error).message ?? e)
      }. Custom aggFuncs MUST be plain function expressions or arrows — no class methods.`,
    );
  }
  if (typeof rebuilt !== 'function') {
    throw new Error(
      `[velocity-grid] aggFunc '${name}' did not deserialise to a function — check the function shape`,
    );
  }
  const probe: IAggFuncParams = { values: [1, 2], colId: '__cgrid_probe__' };
  let originalRes: unknown;
  let originalThrew = false;
  try { originalRes = fn(probe); } catch { originalThrew = true; }
  let rebuiltRes: unknown;
  let rebuiltErr: Error | null = null;
  try { rebuiltRes = rebuilt(probe); } catch (e) { rebuiltErr = e as Error; }
  if (rebuiltErr && !originalThrew) {
    throw new Error(
      `[velocity-grid] aggFunc '${name}' closes over outer scope ` +
      `(rebuilt copy threw '${rebuiltErr.message}' when invoked). ` +
      `Custom aggFuncs MUST be pure — no references to variables, ` +
      `imports, or this-bound state from the surrounding closure. ` +
      `Pre-bake any external data into the values via a column ` +
      `valueGetter instead.`,
    );
  }
  if (!rebuiltErr && !originalThrew && !Object.is(originalRes, rebuiltRes)) {
    throw new Error(
      `[velocity-grid] aggFunc '${name}' produced different results pre- and post-serialisation ` +
      `(probably closes over outer scope). Custom aggFuncs MUST be pure.`,
    );
  }
  return source;
}

/** Serialise a whole `aggFuncs` map into worker `{ name, source }` entries. */
export function serializeAggFuncsMap(
  funcs: Record<string, IAggFunc> | undefined,
): Array<{ name: string; source: string }> {
  const entries: Array<{ name: string; source: string }> = [];
  if (!funcs) return entries;
  for (const [name, fn] of Object.entries(funcs)) {
    if (typeof fn !== 'function') {
      throw new Error(
        `[velocity-grid] aggFuncs.${name} is not a function — ` +
        `entries must be IAggFunc callables (received ${typeof fn})`,
      );
    }
    entries.push({ name, source: serializeAggFunc(name, fn) });
  }
  return entries;
}
