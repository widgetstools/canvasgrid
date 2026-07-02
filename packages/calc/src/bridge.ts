// Cycle 21d / Task 14 — the kernel bridge.
//
// `wireIntoKernel(grid, opts?)` wires @cgrid/calc's engine onto a CGrid
// instance via kernel's PUBLIC registration API, mirroring
// packages/rules/src/bridge.ts and packages/format/src/bridge.ts:
//
//   1. constructs a CalcEngine seeded from opts (calculatedColumns,
//      overrides, templates, typeDefaults, schema) — invalid items are
//      skipped + console.warn'd, matching rules' setRules surfacing
//      (hosts wanting the full error objects call the engine directly),
//   2. registers the calc provider adapter (grid.registerCalcProvider):
//      kernel's calcSlot PULLS synthesized ColDefs, per-column fold
//      patches, and the worker calc program through the provider's
//      accessors, and subscribes onColumnsChanged itself for colDef
//      rebuild + program reship. The bridge therefore subscribes to
//      ZERO grid events — calc has no push path (contrast rules).
//
// Kernel never runtime-imports @cgrid/calc; this module reaches into
// kernel only through the grid surface passed in (structural types —
// zero static kernel imports). Idempotent per grid instance via a
// `__calcBridgeWired` marker that stores — and re-returns — the SAME
// `{ calc }` object.
//
// onColumnsChanged coverage note: CalcEngine.onColumnsChanged (Task 7)
// fires only on successful registerCalculatedColumn/removeCalculatedColumn
// — applyOverrides/saveTemplate/applyTemplate/setTypeDefaults/deleteTemplate
// deliberately do NOT notify (calcEngine.ts: "the Task 14 bridge triggers
// the kernel colDef rebuild itself"), since those mutations also change
// resolvedPatchFor's output and the kernel needs to rebuild colDefs for
// them too. This bridge closes that gap by wrapping the five mutator
// methods on the RETURNED calc instance (own-property shadow over the
// prototype method — `calc instanceof CalcEngine` still holds) so ANY
// caller, including a host calling `calc.applyOverrides(...)` directly
// after wiring (not just opts-seeding), reaches the kernel callback.

import type { TypeDefaults, WireCalcOptions } from './types';
import { CalcEngine } from './calcEngine';
import { buildWorkerCalcProgram } from './workerProgram';
import { serializeAggregates } from './aggregates/registry';

/** Bucket keys of `TypeDefaults`, in a fixed order (deterministic
 *  synthetic template ids below). */
const TYPE_DEFAULT_BUCKETS = ['numeric', 'date', 'string', 'boolean'] as const;

/** `__cgridTypeDefault:<bucket>` — namespaced so a seeded typeDefaults
 *  bucket can never collide with a host-supplied `opts.templates` id. */
function typeDefaultTemplateId(bucket: (typeof TYPE_DEFAULT_BUCKETS)[number]): string {
  return `__cgridTypeDefault:${bucket}`;
}

/** Structural mirror of kernel's CalcProviderShape (core/calcSlot.ts,
 *  Task 9) — CROSS-TASK CONTRACT: `workerProgram()` returns `unknown |
 *  null` (null when no calc column is registered), not an
 *  always-populated payload. */
interface CalcProviderShape {
  synthesizedColDefs(): Array<Record<string, unknown>>;
  resolvedPatchFor(colId: string, cellDataType: 'text' | 'number'): Record<string, unknown> | null;
  workerProgram(): unknown | null;
  onColumnsChanged(fn: () => void): () => void;
}

/** Structural surface of the CGrid instance (or CGridApi) the bridge
 *  registers against. Type-only — no runtime kernel import; the ONLY
 *  member calc needs is the provider registration (core/calcSlot.ts). */
interface KernelGridSurface {
  registerCalcProvider(provider: CalcProviderShape): void;
  __calcBridgeWired?: { calc: CalcEngine };
}

/** Mutator methods that change resolvedPatchFor's output but don't
 *  self-notify via CalcEngine.onColumnsChanged (see module doc). */
const SILENT_MUTATORS = [
  'applyOverrides', 'saveTemplate', 'applyTemplate', 'setTypeDefaults', 'deleteTemplate',
] as const;

/**
 * Wire @cgrid/calc into a CGrid instance. Idempotent — re-calling on
 * an already-wired grid returns the SAME `{ calc }` object.
 */
export function wireIntoKernel(
  grid: unknown,
  opts?: WireCalcOptions,
): { calc: CalcEngine } {
  const g = grid as KernelGridSurface;
  if (g.__calcBridgeWired) return g.__calcBridgeWired;

  // 1. Engine, seeded from opts. Seeding order matters: schema at
  //    construction; typeDefaults + templates BEFORE overrides so a
  //    seeded override's templateIds resolve; calc columns before
  //    overrides so overrides naming calc colIds validate against
  //    registered columns.
  const calc = new CalcEngine({ schema: opts?.schema });

  // `WireCalcOptions.typeDefaults` carries raw format-DSL strings per
  // bucket (host-facing convenience — matches opts.overrides/[].format
  // and opts.templates[].overrides.format, which are also raw format
  // strings). CalcEngine.setTypeDefaults' buckets are TEMPLATE IDS
  // (resolvedPatchFor looks the bucket value up in the template store —
  // calcEngine.ts:352-360, pinned by tests/calcEngine.test.ts's
  // "resolvedPatchFor" suite). Bridge the two: seed one synthetic
  // single-key (`format`) template per populated bucket, namespaced so
  // it can't collide with a host-supplied `opts.templates` id, then
  // point setTypeDefaults at those synthetic ids.
  if (opts?.typeDefaults) {
    const resolved: TypeDefaults = {};
    for (const bucket of TYPE_DEFAULT_BUCKETS) {
      const format = opts.typeDefaults[bucket];
      if (format === undefined) continue;
      const id = typeDefaultTemplateId(bucket);
      calc.saveTemplate({ id, name: id, overrides: { format }, now: 0 });
      resolved[bucket] = id;
    }
    calc.setTypeDefaults(resolved);
  }

  if (opts?.templates) {
    for (const t of opts.templates) {
      // Seeded templates carry host-stamped timestamps; re-stamp
      // through saveTemplate's `now` argument with the seed's
      // updatedAt (engines stay Date-free — the bridge never calls
      // Date.now either). createdAt === updatedAt after seeding; the
      // original createdAt is not preserved — documented in README.
      calc.saveTemplate({
        id: t.id,
        name: t.name,
        description: t.description,
        overrides: t.overrides,
        now: t.updatedAt,
      });
    }
  }

  if (opts?.calculatedColumns) {
    for (const def of opts.calculatedColumns) {
      const res = calc.registerCalculatedColumn(def);
      for (const err of res.errors) {
        console.warn(
          `[cgrid/calc] skipped calculated column '${err.colId ?? def.colId}': ${err.message}`,
        );
      }
    }
  }

  if (opts?.overrides) {
    for (const err of calc.applyOverrides(opts.overrides).errors) {
      console.warn(`[cgrid/calc] skipped override '${err.colId ?? '?'}': ${err.message}`);
    }
  }

  // 2a. Hide the synthetic typeDefaults templates from listTemplates() —
  //     they're a bridge-internal implementation detail of the raw
  //     format-string convenience above, not a host-authored template.
  //     Own-property shadow (same instanceof-preserving pattern as the
  //     mutator wraps below).
  const originalListTemplates = calc.listTemplates.bind(calc);
  calc.listTemplates = () => originalListTemplates().filter(
    (t) => !TYPE_DEFAULT_BUCKETS.some((b) => t.id === typeDefaultTemplateId(b)),
  );

  // 2b. Bridge-level column-change notification. CalcEngine.onColumnsChanged
  //    (register/remove) covers half the surface; wrap the silent
  //    mutators on this INSTANCE (own-property shadow, prototype chain
  //    untouched, `instanceof CalcEngine` unaffected) so every path that
  //    changes resolvedPatchFor's output notifies the same listener set.
  const bridgeListeners = new Set<() => void>();
  for (const name of SILENT_MUTATORS) {
    const original = (calc[name] as (...args: unknown[]) => unknown).bind(calc);
    (calc as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      const result = original(...args);
      for (const fn of [...bridgeListeners]) fn();
      return result;
    };
  }
  calc.onColumnsChanged(() => {
    for (const fn of [...bridgeListeners]) fn();
  });

  // 3. Provider adapter — the exact structural mirror of kernel's
  //    CalcProviderShape (core/calcSlot.ts, Task 9). Pure pull surface:
  //    the kernel consults these on colDef rebuild / program ship, and
  //    installs its own onColumnsChanged subscription at register time
  //    so engine mutations (register/remove column, applyOverrides,
  //    applyTemplate, saveTemplate, setTypeDefaults, deleteTemplate)
  //    trigger rebuild + reship.
  g.registerCalcProvider({
    synthesizedColDefs: () => calc.synthesizedColDefs(),
    resolvedPatchFor: (colId: string, cellDataType: 'text' | 'number') =>
      calc.resolvedPatchFor(colId, cellDataType),
    workerProgram: () => {
      const compiled = calc.compiledColumns();
      if (compiled.length === 0) return null;
      return buildWorkerCalcProgram(
        compiled.map((c) => ({ colId: c.def.colId, ...c.compiled })),
        serializeAggregates(),
      );
    },
    onColumnsChanged: (fn: () => void) => {
      bridgeListeners.add(fn);
      return () => { bridgeListeners.delete(fn); };
    },
  });

  const wired = { calc };
  g.__calcBridgeWired = wired;
  return wired;
}
