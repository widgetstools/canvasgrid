// Delta-aware aggregate registry + worker-shipping serialization.
//
// SERIALIZATION (aggFuncRegistry precedent — worker/aggFuncRegistry.ts:14):
// every entry stores a FACTORY SOURCE string with zero free variables.
// The worker (Task 10) reconstructs via
//     const factory = new Function('return (' + source + ')')();
// and calls factory() — or factory(p) when the rebuilt factory declares
// a parameter (arity convention: fn.length >= 1 ⇒ parameterized, e.g.
// PERCENTILE) — to mint a fresh Aggregate instance per cache scope.
//
// VALIDATION is deliberately one mechanism: reconstruct-and-smoke-test
// at register time (mirror of the main-thread probe in
// aggFuncRegistry.ts:33-39). Closure captures surface as ReferenceError,
// [native code] toString as SyntaxError — both reject with a message
// pointing at the self-containment constraint. Built-ins skip the smoke
// test at module load (keeps `import '@cgrid/calc'` eval-free on
// strict-CSP main threads; their round-trip is covered by tests).
//
// CSP caveat: worker reconstruction needs `new Function` — hosts with a
// no-unsafe-eval CSP on the worker cannot ship aggregates (same caveat
// as custom aggFuncs; built-in sources are static, not user input).
//
// DUPLICATES: registration throws on an existing name unless
// { force: true } — silent shadowing is the aggFunc-masking footgun;
// force documents intent at the call site.

import type { Aggregate } from '../types';
import type { AggregateFactoryOpts } from './contract';
import {
  makeAvg, makeCount, makeCountDistinct, makeMax, makeMin, makeSum,
} from './basic';
import {
  makeMedian, makeMode, makePercentile, makeStdev, makeVar,
} from './stats';

export type AggregateFactory = (p?: number) => Aggregate;

export interface RegisterFactoryOpts {
  parameterized?: boolean;
  force?: boolean;
  /** Built-in path only — public registerAggregate never skips. */
  skipSmokeTest?: boolean;
}

interface RegistryEntry {
  factory: AggregateFactory;
  /** Zero-free-variable factory source (worker payload). */
  source: string;
  parameterized: boolean;
}

const entries = new Map<string, RegistryEntry>();

/** Parameterized lookup grammar: NAME(p) — canonical p is String(number). */
const PARAM_NAME_RE = /^([A-Za-z_][A-Za-z0-9_]*)\((-?\d+(?:\.\d+)?)\)$/;

function smokeTest(name: string, source: string, parameterized: boolean): void {
  try {
    const rebuilt = new Function('return (' + source + ')')() as AggregateFactory;
    const inst = parameterized ? rebuilt(50) : rebuilt();
    let s = inst.init();
    s = inst.addRow(s, 1);
    s = inst.addRow(s, 2);
    s = inst.updateRow(s, 2, 3);
    s = inst.removeRow(s, 1);
    inst.finalize(s);
  } catch (e) {
    throw new Error(
      `registerAggregate: '${name}' failed the serialization smoke test — the impl must be ` +
      `self-contained (zero free variables; Function.toString must round-trip through ` +
      `new Function; globals like Math are fine): ${(e as Error).message}`,
    );
  }
}

/**
 * Internal registration path (Task 6 uses it for stats + the MEDIAN
 * source-override). Exported from this module; NOT re-exported by
 * index.ts.
 */
export function registerFactory(
  name: string,
  factory: AggregateFactory,
  source: string,
  opts: RegisterFactoryOpts = {},
): void {
  if (entries.has(name) && opts.force !== true) {
    throw new Error(
      `registerAggregate: '${name}' is already registered — pass { force: true } to replace`,
    );
  }
  if (opts.skipSmokeTest !== true) smokeTest(name, source, opts.parameterized === true);
  entries.set(name, { factory, source, parameterized: opts.parameterized === true });
}

const AGG_METHODS = ['init', 'addRow', 'removeRow', 'updateRow', 'finalize'] as const;

/**
 * Synthesize a zero-free-variable factory source from an impl object's
 * method sources. Shorthand methods stringify as `name(args) { ... }`
 * (valid as-is inside an object literal); `function` expressions and
 * arrows need the `name:` key. Mis-detections (e.g. a shorthand method
 * borrowed under a different name) are caught by the smoke test — that
 * is the gate, not this heuristic.
 */
function synthesizeFactorySource(impl: Aggregate): string {
  const parts = AGG_METHODS.map((m) => {
    const src = Function.prototype.toString.call(impl[m]);
    const isKeyed = /^\s*(?:async\s*)?(?:function\b|\()/.test(src) || /^[^({]*=>/.test(src);
    return isKeyed ? `${m}: ${src}` : src;
  });
  return `() => ({\n${parts.join(',\n')}\n})`;
}

/**
 * Register a delta-aware aggregate (spec §3). `opts.percentileThreshold`
 * is accepted and IGNORED this cycle (t-digest reserve, spec §1.2 — the
 * exact sorted path runs at every size). Throws on duplicate names
 * unless `opts.force`.
 */
export function registerAggregate(name: string, impl: Aggregate, opts?: AggregateFactoryOpts): void {
  const source = synthesizeFactorySource(impl);
  // The impl object is stateless by contract (state threads through the
  // methods), so reusing it across instances is safe.
  registerFactory(name, () => impl, source, { force: opts?.force === true });
}

/**
 * Fresh Aggregate instance for `name`, or undefined. Parameterized form:
 * `getAggregate('PERCENTILE(95)')` parses the suffix and passes p to the
 * 1-arg factory. A parameterized base name without `(p)` → undefined.
 */
export function getAggregate(name: string): Aggregate | undefined {
  const exact = entries.get(name);
  if (exact !== undefined) {
    return exact.parameterized ? undefined : exact.factory();
  }
  const m = PARAM_NAME_RE.exec(name);
  if (m === null) return undefined;
  // Both capture groups are mandatory in PARAM_NAME_RE — a successful
  // match guarantees m[1]/m[2] are defined.
  const entry = entries.get(m[1] as string);
  if (entry === undefined || !entry.parameterized) return undefined;
  const p = Number(m[2] as string);
  if (!Number.isFinite(p)) return undefined;
  return entry.factory(p);
}

export function listAggregates(): string[] {
  return Array.from(entries.keys()).sort();
}

/**
 * Worker-shipping payload (Task 10). Arity convention: a rebuilt factory
 * with length >= 1 is parameterized — the worker calls factory(p) with
 * the p parsed from AggSpec.fn's `NAME(p)` suffix.
 */
export function serializeAggregates(): Array<{ name: string; source: string }> {
  return Array.from(entries.entries(), ([name, e]) => ({ name, source: e.source }));
}

function registerBuiltins(): void {
  const builtins: Array<[string, () => Aggregate]> = [
    ['SUM', makeSum as () => Aggregate],
    ['COUNT', makeCount as () => Aggregate],
    ['AVG', makeAvg as () => Aggregate],
    ['MIN', makeMin as () => Aggregate],
    ['MAX', makeMax as () => Aggregate],
    ['COUNT_DISTINCT', makeCountDistinct as () => Aggregate],
  ];
  for (const [name, factory] of builtins) {
    registerFactory(name, factory, factory.toString(), { force: true, skipSmokeTest: true });
  }

  // Statistical (Task 6). MEDIAN's registered source embeds PERCENTILE's
  // factory applied at 50 — the LOCAL factory may close over
  // makePercentile (only the SOURCE must be free-variable-free).
  registerFactory('PERCENTILE', makePercentile as AggregateFactory, makePercentile.toString(), {
    parameterized: true, force: true, skipSmokeTest: true,
  });
  registerFactory('MEDIAN', makeMedian as AggregateFactory,
    '() => (' + makePercentile.toString() + ')(50)', { force: true, skipSmokeTest: true });
  registerFactory('STDEV', makeStdev as AggregateFactory, makeStdev.toString(), { force: true, skipSmokeTest: true });
  registerFactory('VAR', makeVar as AggregateFactory, makeVar.toString(), { force: true, skipSmokeTest: true });
  registerFactory('MODE', makeMode as AggregateFactory, makeMode.toString(), { force: true, skipSmokeTest: true });
}

/** Test/host hook: drop customs, restore built-ins. */
export function resetAggregateRegistry(): void {
  entries.clear();
  registerBuiltins();
}

registerBuiltins();
