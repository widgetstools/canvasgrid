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

import type { TypeDefaults, WireCalcOptions, ColumnTemplate, CalculatedColumnDef, ColumnOverride } from './types';
import { CalcEngine, type ColumnEditPatch } from './calcEngine';
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
  // Grid Layouts / Phase B (B3) — template library CRUD the kernel's
  // CGridApi template methods delegate to. The kernel stamps `now` (engine
  // is Date-free).
  getTemplates(): ColumnTemplate[];
  saveTemplate(spec: {
    id: string; name: string; description?: string;
    overrides: ColumnTemplate['overrides']; now: number;
  }): void;
  renameTemplate(templateId: string, name: string, now: number): void;
  deleteTemplate(templateId: string): void;
  applyTemplate(colId: string, templateId: string): void;
  removeTemplate(colId: string, templateId: string): void;
  editColumn(colId: string, patch: Record<string, unknown>, now: number): void;
}

/** Structural mirror of kernel's `StateModule` (core/moduleState.ts) — a
 *  named, versioned, JSON-serializable slice folded into `GridState.modules`
 *  and ridden by getState/setState + persistState + layouts. */
interface StateModuleShape {
  id: string;
  version: number;
  get(): unknown;
  set(data: unknown, version: number): void;
}

/** Structural surface of the CGrid instance (or CGridApi) the bridge
 *  registers against. Type-only — no runtime kernel import. `registerCalcProvider`
 *  is required; `registerStateModule` is optional so a minimal grid surface
 *  (e.g. a pre-Phase-B kernel or a bare test double) still wires — it just
 *  won't persist templates / calc defs. */
interface KernelGridSurface {
  registerCalcProvider(provider: CalcProviderShape): void;
  registerStateModule?(module: StateModuleShape): () => void;
  __calcBridgeWired?: { calc: CalcEngine };
}

/** Mutator methods that change resolvedPatchFor's output but don't
 *  self-notify via CalcEngine.onColumnsChanged (see module doc). */
const SILENT_MUTATORS = [
  'applyOverrides', 'saveTemplate', 'applyTemplate', 'setTypeDefaults', 'deleteTemplate',
  // Auto-template-on-edit (Phase B / B2) — changes resolvedPatchFor output.
  'editColumn',
  // Template API (Phase B / B3) — `removeTemplate` drops a template from a
  // column's chain (changes resolvedPatchFor output → kernel rebuild).
  // `renameTemplate` is intentionally NOT here: it touches only metadata
  // (the display name), so no colDef rebuild is warranted.
  'removeTemplate',
  // Export portability (Phase B / B4) — `clearOverrides` drops the whole
  // override layer (columnOverrides module restore) → kernel rebuild.
  'clearOverrides',
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
    // Grid Layouts / Phase B (B3) — template library CRUD. These delegate to
    // the (possibly SILENT_MUTATOR-wrapped) instance methods, so save /
    // apply / remove notify the kernel colDef rebuild; getTemplates uses the
    // shadowed listTemplates (synthetic typeDefaults filtered); rename touches
    // only metadata (not wrapped). The engine stamps nothing — `now` flows in
    // from the kernel.
    getTemplates: () => calc.listTemplates(),
    saveTemplate: (spec) => calc.saveTemplate(spec),
    renameTemplate: (templateId, name, now) => calc.renameTemplate(templateId, name, { now }),
    deleteTemplate: (templateId) => calc.deleteTemplate(templateId),
    applyTemplate: (colId, templateId) => calc.applyTemplate(templateId, [colId]),
    removeTemplate: (colId, templateId) => calc.removeTemplate(colId, templateId),
    editColumn: (colId, patch, now) => calc.editColumn(colId, patch as ColumnEditPatch, { now }).ok,
  });

  // 4. Grid Layouts / Phase B (B1) — persist the template LIBRARY (grid tier)
  //    and CALC-column definitions (layout tier) through the kernel module
  //    registry, so they ride getState/setState + persistState + layouts. The
  //    tier split keys off the module id (`templates` is in the kernel's
  //    DEFAULT_GRID_LEVEL_MODULES → shared; `calc` is not → per-layout). Both
  //    restore with REPLACE semantics (the snapshot fully defines the slice).
  //    Guarded so a grid surface without the registry simply doesn't persist.
  g.registerStateModule?.({
    id: 'templates',
    version: 1,
    // `listTemplates` is the bridge-shadowed version (2a) — synthetic
    // typeDefaults are already filtered out. Undefined → omitted from the
    // snapshot (compact), matching the kernel's own empty-field convention.
    get: () => {
      const templates = calc.listTemplates();
      return templates.length > 0 ? templates : undefined;
    },
    set: (data) => {
      const next = Array.isArray(data) ? (data as ColumnTemplate[]) : [];
      for (const t of calc.listTemplates()) calc.deleteTemplate(t.id);
      for (const t of next) {
        // `saveTemplate` THROWS on a bad def (empty id / non-compiling format).
        // Per-item try/catch so one bad template in a foreign / hand-edited
        // bundle can't wipe the whole library mid-restore (M3).
        try {
          calc.saveTemplate({
            id: t.id, name: t.name, description: t.description,
            overrides: t.overrides, now: t.updatedAt,
          });
        } catch (err) {
          console.warn(`[cgrid/calc] restore skipped template '${t.id}': ${(err as Error).message}`);
        }
      }
    },
  });
  g.registerStateModule?.({
    id: 'calc',
    version: 1,
    get: () => {
      const cols = calc.listCalculatedColumns();
      return cols.length > 0 ? cols : undefined;
    },
    set: (data) => {
      const next = Array.isArray(data) ? (data as CalculatedColumnDef[]) : [];
      for (const c of calc.listCalculatedColumns()) calc.removeCalculatedColumn(c.colId);
      for (const def of next) {
        for (const err of calc.registerCalculatedColumn(def).errors) {
          console.warn(
            `[cgrid/calc] restore skipped calculated column '${err.colId ?? def.colId}': ${err.message}`,
          );
        }
      }
    },
  });
  // 4b. Grid Layouts / Phase B (B4) — persist the per-column OVERRIDE layer
  //     (layout tier — not in DEFAULT_GRID_LEVEL_MODULES). This is where a
  //     column's `templateIds` (template ASSIGNMENTS) + any direct per-column
  //     styling live, so a layout round-trips its template assignments (and
  //     exportLayout can bundle the defs those assignments reference — B4).
  //     REPLACE semantics: clear the whole layer, then re-apply, so switching
  //     to a layout without an override for a column drops the stale one.
  g.registerStateModule?.({
    id: 'columnOverrides',
    version: 1,
    get: () => {
      const overrides = calc.getOverrides();
      return overrides.length > 0 ? overrides : undefined;
    },
    set: (data) => {
      const next = Array.isArray(data) ? (data as ColumnOverride[]) : [];
      calc.clearOverrides();
      if (next.length > 0) {
        for (const err of calc.applyOverrides(next).errors) {
          console.warn(
            `[cgrid/calc] restore skipped override '${err.colId ?? '?'}': ${err.message}`,
          );
        }
      }
    },
  });

  const wired = { calc };
  g.__calcBridgeWired = wired;
  return wired;
}
