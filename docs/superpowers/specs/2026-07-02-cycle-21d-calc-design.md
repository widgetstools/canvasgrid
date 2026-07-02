# Cycle 21d — `@cgrid/calc` (Calculated Columns + Aggregates + Overrides/Templates) — Design

**Date:** 2026-07-02
**Parent brief:** [Cycle 21 decision doc](../plans/2026-07-01-canvasgrid-cycle-21-modular-monorepo-and-intrinsic-features.md) §4.5, §6, §7.4
**Source requirements:** `docs/starui-customizer/02-calculated-columns.md`, `docs/starui-customizer/05-column-customization.md`, `docs/starui-customizer/07-column-templates.md`, `docs/starui-customizer-ui/03-calculated-columns.md`
**Depends on:** `@cgrid/expression` (21b), `@cgrid/format` (21c), `@cgrid/rules` (21e, PR #95) — rules is a peer consumer, not a dependency.
**Baselines (main @ `e68231e`):** kernel `2477`, rules `144`, format `171`, expression `185`; showcase E2E `125`; typecheck 21/21; build 13/13; kernel dist 771.49 KiB (+2% budget vs 760.90K → ceiling 776.12 KB — 21d gets a fresh +2% ceiling measured in Task 1 of its plan).

---

## §1 Scope & non-goals

### 1.1 In scope (parent §4.5 — all of it, no deferral)

1. **Expression aggregate support** — `AggregateNode`/`PrevNode` come alive: a post-parse transform in `@cgrid/calc` rewrites `CallNode`s whose name ∈ `AGGREGATE_NAMES` ∪ {`PREV`} into `AggregateNode`/`PrevNode` (MIN/MAX disambiguated by arg shape: single field-ref arg → aggregate; otherwise variadic builtin). The 21b `not-yet-implemented` reserve is honored: `packages/expression` stays **untouched**; the transform + split compiler live in calc.
2. **Two-pass compilation** (parent §6.1) — `compileCalc(source, schema?)` splits the AST into a **pre-pass plan** (aggregates to compute, each `{fn, colId, scope}`) and a **per-row program** (aggregate refs become slot reads). Row-local-only expressions have an empty pre-pass.
3. **Scope model** (parent §6.2) — `all` / `visible` / `group` / `parent` literal scopes this cycle; scope syntax `SUM([x], scope: group)` parsed by the calc transform (sugared to an extra string-literal arg before `expression.parse` — mirror of 21c's bracket sugar). `window:{order,size}` scopes and the order-dependent aggregate family are **structurally reserved** (parse → `not-yet-implemented`), because RUNNING_*/MOVING_AVG demand sorted-window state that belongs with the same machinery — see 1.2.
4. **Delta-aware aggregate registry** (parent §6.3/§6.4) — `registerAggregate(name, impl)` with the `{init, addRow, removeRow, updateRow, finalize}` contract. Built-ins this cycle: **Basic** (SUM, AVG, MIN, MAX, COUNT, COUNT_DISTINCT), **Statistical** (MEDIAN, PERCENTILE, STDEV, VAR, MODE — sorted-multiset exact path; t-digest threshold reserved per Q5 with the sorted path used at all sizes this cycle, threshold option accepted + documented), **Ratio/share** (PCT_OF_TOTAL, PCT_OF_GROUP, PCT_OF_PARENT, PCT_OF_GRAND), **Comparative FIRST/LAST** (order-aware, computed directly by the worker CalcPass per scope — NOT delta-registry impls; O(scope) recompute on version bump). MIN/MAX heap-backed for O(log n) deltas. PERCENTILE parameter rides the canonical fn-string `PERCENTILE(<p>)` (percent points 0–100).
5. **Aggregate cache** (parent §6.5) — keyed `(fn, colId, scopeKey, dataVersion)`; transactions bump `dataVersion` per affected scope; unaffected scopes reuse.
6. **`PREV([col])`** — tick-scoped previous-value read (parent §7.4) from the worker's transaction snapshot.
7. **Worker-side evaluation** — calculated columns evaluate ON THE WORKER (they must: filter/sort/group operate there). Mechanism in §2.3.
8. **Calculated column defs** — `calc.registerCalculatedColumn(def)` / `removeCalculatedColumn(colId)` / `listCalculatedColumns()`; defs follow StarUI's `VirtualColumnDef` (colId, headerName, expression, valueFormatterTemplate → format string, cellDataType, position/initialWidth/initialHide/initialPinned); synthesized into the kernel column tree; **non-editable** (derived).
9. **Column override model** — `calc.applyOverrides(overrides: ColumnOverride[])`; per-column layered mutations (headerName, format string, cellStyle, cellRenderer, editable, hide, width) folded onto base ColDefs with explicit precedence.
10. **Column templates** — `calc.saveTemplate(spec)`, `calc.applyTemplate(templateId, colIds)`, `calc.listTemplates()`, `calc.deleteTemplate(id)`, type-defaults map; template chain fold per StarUI 07: typeDefault → templateIds left-to-right → per-column assignment wins; styles merge per-field, everything else last-writer-wins.
11. **Distinct-values API** — the kernel has the worker RPC internally (DistinctValuesPass + client call) but NO public API method (recon correction — the parent brief assumed one existed); 21d adds `api.getDistinctValues(colId, limit?)` end-to-end with the `limit` applied at reply time.
12. **Kernel bridge** — `wireIntoKernel(grid, opts?)` (idempotent, structural surface, zero static kernel imports) registering: the calc-column synthesizer slot, the worker calc-program shipping, override/template fold into colDef resolution.
13. **Showcase demo + E2E** — calculated-columns feature page (row-local + aggregate + PREV columns over ticking data, live group re-scoping) and a column-templates demo section; Playwright specs.

### 1.2 Non-goals (explicit)

- **Order-dependent aggregates** — RANK / DENSE_RANK / PERCENT_RANK / RUNNING_SUM / RUNNING_AVG / MOVING_AVG / DELTA_FROM_* and `window:` scopes: registered names, `not-yet-implemented` compile error with a pointer to the follow-up cycle. Rationale: they need per-scope ORDERED state coupled to the sort model; wiring that correctly is its own cycle-sized feature and none of the downstream 21f–21i cycles block on it (renderers need windowed data for sparklines — 21f consumes the RPC surface reserved here). This is the ONLY feature-level reserve and it is a grammar-honest one (mirrors 21b/21c reserves).
- **t-digest approximate percentiles** — the threshold option exists; the approximate implementation lands with the order-dependent family (same follow-up); exact sorted-multiset is used at every size this cycle.
- **Customizer editor panels** — 21i.
- **Editing calculated columns / editable overrides UI** — `@cgrid/edit` (21g) + 21i.
- **Aggregates inside `@cgrid/rules` conditions / format Tier-1 interiors** — stays reserved (their compilers reject as today); wiring rule conditions to the calc pre-pass is a follow-up once both engines coexist.

---

## §2 Architecture

### 2.1 Dependency position

```
calc → kernel (peerDep, bridge-only runtime), expression (dep), format (dep — override/template format strings compile via the kernel's registered compiler, format dep is for types + validation)
```

Kernel gains `@cgrid/calc` as devDependency (types in tests only); zero runtime imports — DI slots + structural types (formatCompilerSlot / ruleEngineSlot precedents).

### 2.2 `@cgrid/calc` source layout

```
packages/calc/src/
  types.ts               — all public types (§4)
  aggTransform.ts        — post-parse AST rewrite: CallNode→AggregateNode/PrevNode, scope-arg sugar, MIN/MAX arg-shape disambiguation
  compile.ts             — compileCalc(source, schema?) → {prePass: AggSpec[], perRow: Compiled, watchedColIds, usesPrev}
  aggregates/contract.ts — Aggregate<S> delta contract + finalize typing
  aggregates/basic.ts    — SUM/AVG/MIN/MAX/COUNT/COUNT_DISTINCT (heap/multiset where needed)
  aggregates/stats.ts    — MEDIAN/PERCENTILE/STDEV/VAR/MODE (sorted multiset)
  aggregates/share.ts    — PCT_OF_TOTAL/GROUP/PARENT/GRAND (derived: value ÷ scoped SUM)
  aggregates/registry.ts — registerAggregate/getAggregate/listAggregates + serialization for worker shipping
  scopeKey.ts            — scope canonicalization + cache keys + dataVersion bookkeeping
  calcEngine.ts          — CalcEngine: registered calc columns, compiled programs, override/template stores, fold logic
  templates.ts           — template chain fold (typeDefault → templateIds → assignment)
  overrides.ts           — ColumnOverride fold → kernel colDef patch objects
  workerProgram.ts       — buildWorkerCalcProgram(): serializes {colId, ast(JSON), prePass, cellDataType} + the SELF-CONTAINED interpreter source (§2.3)
  bridge.ts              — wireIntoKernel(grid, opts?)
  index.ts
```

### 2.3 Worker-side evaluation — the interpreter ship

Calculated values must exist where filter/sort/group run: the worker. The kernel is zero-dep, so calc ships its evaluator the way aggFuncs already travel (`Function.toString()` → `new Function` reconstruction, `worker/aggFuncRegistry.ts:14` precedent, CSP caveat documented there):

- `@cgrid/calc` exports a **self-contained interpreter function** (`evaluateCalcAst(ast, row, aggSlots, prevLookup)`) written with zero free variables (no imports, no closures) — property-tested against `expression.evaluate` for row-local semantics parity.
- The bridge ships, per calc column: the portable AST (plain JSON — 21b guarantee), the pre-pass `AggSpec[]`, `cellDataType`, plus (once) the interpreter source and the delta-aggregate implementations' sources (each aggregate impl is itself written self-contained for serialization, mirroring how custom aggFuncs already cross).
- Kernel worker gains a **CalcPass** with two stages:
  - **Stage A (row-local)** — runs at row materialization (before FilterPass): computes row-local calc values into per-column Float64/side text arrays, so filter/sort/group treat calc columns as ordinary columns.
  - **Stage B (aggregate-dependent)** — runs after grouping: computes pre-pass scalars per scope via the delta contract + cache, then per-row values that reference them. Chunks ship calc values in the ordinary `numericCols`/`textCols` slots.
- **Ordering (corrected to the real pipeline, which is filter → group → sort):** Stage B runs between group and sort, so SORTING sees fresh aggregate-dependent values; only FILTERING over Stage-B columns has a one-frame settle (its inputs are defined by the grouping the filter pass precedes). Row-local calc columns have no restriction. The showcase demo demonstrates both.
- **Delta path:** on `applyTransaction`, the worker updates Stage-A values for touched rows, feeds `addRow/removeRow/updateRow` deltas to cached aggregate states whose scope contains the row, bumps those scopes' `dataVersion`, and recomputes Stage-B values only for rows in dirtied scopes.
- **PREV:** CalcPass Stage A reads the worker's existing transaction old-value capture (the flash diff already computes old/new per changed cell — `diffRowFields`) exposed as a tick-scoped `prevLookup(rowId, colId)`; discarded after the transaction's slice ships.

### 2.4 Kernel diff footprint (slot-gated, surgical)

- `core/calcSlot.ts` — DI slot: `registerCalcProvider(provider)` with structural `CalcProviderShape` (synthesized colDefs + worker program payload + override patches).
- `cgrid.ts` — `registerCalcProvider` public method; column-defs rebuild consults the slot (synthesized calc ColDefs appended per `position` hints; override/template patches folded pre-`resolveColDefs`); worker coordinator ships/updates the calc program on register + on calc-column changes; `getDistinctValues(colId, limit?)` gains the `limit` param end-to-end.
- `worker/passes/calcPass.ts` (+ pipeline wiring in `dataPipeline.ts` / `dispatch.ts` / `protocol.ts` message) — Stage A/B as §2.3; program installed via a `setCalcProgram` message; absent program → zero-cost no-op (empty pass skipped).
- Behavior byte-identical when no calc provider is registered; kernel baseline (2477) preserved.

---

## §3 Public API surface (locked types)

```ts
// types.ts — verbatim contract for the plan
import type { Loc, Schema, Ast } from '@cgrid/expression';

export type CellDataType = 'number' | 'currency' | 'percent' | 'date' | 'datetime' | 'string' | 'boolean';

export interface CalculatedColumnDef {
  colId: string;                    // must not collide with data fields or other calc cols
  headerName: string;
  expression: string;               // calc DSL: [col], builtins, aggregates, PREV
  /** Format-DSL string (any tier the registered compiler accepts). */
  format?: string;
  cellDataType?: CellDataType;      // default 'number'
  position?: number;                // insertion hint into the column order
  initialWidth?: number;
  initialHide?: boolean;
  initialPinned?: 'left' | 'right';
}

export type AggScope =
  | { kind: 'all' } | { kind: 'visible' } | { kind: 'group' } | { kind: 'parent' };

export interface AggSpec {
  slot: number;                     // pre-pass slot index the per-row program reads
  fn: string;                       // registered aggregate name
  colId: string;                    // source column (field path head)
  scope: AggScope;
}

export interface CompiledCalc {
  ast: Ast;                         // transformed (AggregateNode/PrevNode present)
  prePass: AggSpec[];
  watchedColIds: ReadonlySet<string>;
  usesPrev: boolean;
  cellDataType: CellDataType;
}

export interface CalcValidationError {
  colId: string | null;
  code: 'parse' | 'unknown-fn' | 'arity' | 'not-yet-implemented' | 'bad-shape'
      | 'duplicate-colId' | 'unknown-scope' | 'format-compile';
  message: string;
  loc: Loc | null;
}

export interface Aggregate<S = unknown> {
  init(): S;
  addRow(state: S, value: unknown): S;
  removeRow(state: S, value: unknown): S;
  updateRow(state: S, oldValue: unknown, newValue: unknown): S;
  finalize(state: S): number | null;
}

export interface ColumnOverride {
  colId: string;
  headerName?: string;
  format?: string;                  // format-DSL string → kernel compiler
  cellStyle?: Record<string, unknown>;
  cellRenderer?: string;
  editable?: boolean;
  hide?: boolean;
  width?: number;
  templateIds?: string[];           // template chain refs; undefined → typeDefault; [] → opt out
}

export interface ColumnTemplate {
  id: string;
  name: string;
  description?: string;
  overrides: Omit<ColumnOverride, 'colId' | 'templateIds'>;
  createdAt: number;                // host-stamped; engine never calls Date.now
  updatedAt: number;
}

export interface TypeDefaults { numeric?: string; date?: string; string?: string; boolean?: string; }

export class CalcEngine {
  constructor(opts?: { schema?: Schema });
  registerCalculatedColumn(def: CalculatedColumnDef): { ok: boolean; errors: CalcValidationError[] };
  removeCalculatedColumn(colId: string): void;
  listCalculatedColumns(): CalculatedColumnDef[];
  applyOverrides(overrides: ColumnOverride[]): { ok: boolean; errors: CalcValidationError[] };
  getOverrides(): ColumnOverride[];
  saveTemplate(spec: Omit<ColumnTemplate, 'createdAt' | 'updatedAt'> & { now: number }): void;
  applyTemplate(templateId: string, colIds: string[]): void;
  deleteTemplate(templateId: string): void;
  listTemplates(): ColumnTemplate[];
  setTypeDefaults(defaults: TypeDefaults): void;
  /** Folded per-column patch (template chain + overrides) for the kernel. */
  resolvedPatchFor(colId: string, cellDataType: 'text' | 'number'): Record<string, unknown> | null;
}

export function compileCalc(source: string, schema?: Schema):
  { ok: true; compiled: CompiledCalc } | { ok: false; error: CalcValidationError };
export function registerAggregate(name: string, impl: Aggregate, opts?: { percentileThreshold?: number }): void;
export function wireIntoKernel(grid: unknown, opts?: WireCalcOptions): { calc: CalcEngine };

export interface WireCalcOptions {
  calculatedColumns?: CalculatedColumnDef[];
  overrides?: ColumnOverride[];
  templates?: ColumnTemplate[];
  typeDefaults?: TypeDefaults;
  schema?: Schema;
}
```

Grammar corrections locked from 21e experience (bind every plan task): expression infix is `&&`/`||`, equality `==`/`!=` (no `AND`/`OR`/bare `=`); vocabulary `colId` everywhere (no `columnId` identifiers).

---

## §4 Testing + gates

- calc unit: transform table (aggregate detection, MIN/MAX shapes, scope sugar, reserves), two-pass split, interpreter ⇄ `expression.evaluate` parity property (≥200 generated row-local cases), delta contract per aggregate (add/remove/update streams === recompute), cache invalidation by scope, template/override fold precedence table.
- kernel new-code: calcSlot; CalcPass Stage A (filter/sort/group over calc values), Stage B (group scopes, parent scopes, cache reuse across untouched scopes), PREV tick lifecycle, program install/update/remove, no-provider zero-diff, `getDistinctValues` limit.
- E2E: calculated-columns page (row-local col sorts/filters/groups; `PCT_OF_GROUP` re-scopes live on regroup; PREV-driven delta column ticks; template applied to a column set).
- Gates (final task): typecheck 21/21 · lint · build 13/13 · kernel 2477+new · rules 144 · format 171 · expression 185 untouched · calc suite · showcase E2E 125+new · kernel dist ≤ new-baseline+2% · zero runtime `@cgrid/calc` imports in kernel dist · no raw NULs.

## §5 Risks

| Risk | Mitigation |
|---|---|
| Interpreter/`expression.evaluate` semantic drift | Parity property tests + single source of truth doc for null/EvalError semantics (interpreter returns null where evaluate throws EvalError — matches calc's "errors → null cell" StarUI rule) |
| Worker pipeline ordering regressions | CalcPass gated on program presence; every stage covered by pipeline tests; kernel baseline enforced per task |
| Serialized-source CSP | Documented caveat (aggFunc precedent); interpreters/impls are static sources, not user input |
| Aggregate cache staleness on regroup | scopeKey includes the group signature; group-state changes invalidate group/parent scopes wholesale |
| Dist growth (interpreter + aggregates ship in kernel? NO — they live in calc and cross via postMessage at runtime) | dist check remains on kernel only; calc payload measured + logged in the demo task |

## §6 Decisions locked

1. Worker-side calc via serialized self-contained interpreter (aggFunc precedent) — NOT main-side row enrichment (stale-on-regroup) and NOT expression-package import into kernel (dep graph).
2. Two-stage CalcPass; documented one-frame settle for filter/sort over Stage-B columns.
3. Order-dependent aggregate family + `window:` scopes + t-digest: grammar-honest reserves (the only deferral, justified by ordered-state coupling; parent §9 lists renderers needing windowed data — 21f consumes the reserved RPC surface without blocking).
4. `packages/expression` untouched — transform lives in calc.
5. Calc columns non-editable; overrides may set `editable` on DATA columns only.
6. Engines Date-free (host stamps template timestamps).
7. Distinct values: extend existing kernel RPC with `limit` rather than a calc-side duplicate.
