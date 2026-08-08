# `@wellsfargo-starui/velocity-grid-calc`

Calculated columns for the cgrid monorepo — worker-evaluated
expressions (row-local + scoped aggregates + `PREV`), the delta-aware
aggregate registry + cache, and the column override / template fold.

- **Calculated columns** — `[qty] * [price]`-style expressions
  synthesized into the kernel column tree and evaluated ON THE WORKER,
  so they sort / filter / group like ordinary data columns.
  Non-editable (derived).
- **Aggregates** — Basic (`SUM`, `AVG`, `MIN`, `MAX`, `COUNT`,
  `COUNT_DISTINCT`), Statistical (`MEDIAN`, `PERCENTILE`, `STDEV`,
  `VAR`, `MODE`), Ratio/share (`PCT_OF_TOTAL`, `PCT_OF_GROUP`,
  `PCT_OF_PARENT`, `PCT_OF_GRAND`), Comparative (`FIRST`, `LAST`) —
  all delta-aware (`{init, addRow, removeRow, updateRow, finalize}`)
  behind a scope-keyed cache.
- **Overrides + templates** — per-column layered mutations
  (headerName, format, cellStyle, cellRenderer, editable, hide, width)
  and reusable template chains folded onto base ColDefs.

**Status:** Cycle 21d — everything above shipped, including the kernel
bridge, the two-stage worker CalcPass, and `PREV`. The 21b/21e
`not-yet-implemented` reserve for aggregates comes alive here — but
only for CALC columns; aggregates inside `@wellsfargo-starui/velocity-grid-rules` conditions and
format Tier-1 interiors stay reserved. Order-dependent aggregates
(`RANK`, `RUNNING_*`, `MOVING_AVG`, `DELTA_FROM_*`), `window:` scopes,
and t-digest approximate percentiles are grammar-honest reserves for a
follow-up cycle. Full spec:
`docs/superpowers/specs/2026-07-02-cycle-21d-calc-design.md`.

## Quickstart

```ts
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { wireIntoKernel as wireFormat } from '@wellsfargo-starui/velocity-grid-format';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';

const grid = new VelocityGrid(host, { /* ... */ });
wireFormat(grid);  // calc `format` strings compile via the kernel's
                   // registered format compiler — wire format first
const { calc } = wireCalc(grid, {
  calculatedColumns: [{
    colId: 'notional', headerName: 'Notional',
    expression: '[qty] * [price]',
    format: '$#,##0', cellDataType: 'currency',
  }, {
    colId: 'pctOfSector', headerName: '% of Sector',
    expression: "[qty] / SUM([qty], 'group')",
    format: '0.0%', cellDataType: 'percent',
  }],
});
// …the columns appear in the grid: sortable, filterable, groupable.

calc.registerCalculatedColumn({ /* live add — grid rebuilds itself */ });
```

`wireIntoKernel` is idempotent — re-calling on a wired grid returns the
SAME `{ calc }` object. Wire BEFORE issuing the full ColDefs
(construct with a minimal column set, wire, then
`updateGridOptions({ columnDefs })`) so synthesized columns and folded
patches are present from the first resolution. Seeding note: templates
passed via `opts.templates` are re-stamped through their `updatedAt`
(`createdAt` is not preserved — engines never call `Date.now`).

**Calc-on-calc is rejected, not sequenced.** A calculated column whose
expression references another calc column's `colId` fails registration
with `bad-shape` — dependency ordering between Stage A/B calc columns
would require the pipeline to sequence one calc pass's output as
another's input, which isn't implemented this cycle. Aggregate a real
data field instead (the showcase demo's `pctOfSector` aggregates
`[qty]`, not a calc-derived notional). Dependency-ordered calc-on-calc
evaluation is a follow-up-cycle item.

## Calc DSL cheat sheet

**Row-local layer** — the full `@wellsfargo-starui/velocity-grid-expression` grammar: field refs
`[col]` / `[a.b]`, every builtin, ternaries. Infix booleans are
`&&` / `||` ONLY; equality is `==` / `!=` ONLY (no `AND` / `OR` / bare
`=` — they do not parse).

**Aggregate calls** — `FN([col])` or `FN([col], '<scope>')` with a
trailing string-literal scope (default `'all'`); the `scope: group`
sugar desugars to the same form:

| Family | Functions | Notes |
|---|---|---|
| Basic | `SUM` `AVG` `MIN` `MAX` `COUNT` `COUNT_DISTINCT` | `MIN`/`MAX` heap-backed (O(log n) deltas). Single field-ref arg ⇒ aggregate; variadic `MIN(a, b)` stays the row-local builtin |
| Statistical | `MEDIAN` `PERCENTILE` `STDEV` `VAR` `MODE` | Exact sorted-multiset at every size. `PERCENTILE(<p>)` — `<p>` is a PERCENT POINT in `[0, 100]` (canonical literal form, e.g. `PERCENTILE([price], 95)` compiles to the `PERCENTILE(95)` aggregate name), never a `0–1` fraction; t-digest approximate percentiles land with the order-dependent family |
| Ratio/share | `PCT_OF_TOTAL` `PCT_OF_GROUP` `PCT_OF_PARENT` `PCT_OF_GRAND` | Derived: value ÷ scoped `SUM` |
| Comparative | `FIRST` `LAST` | Order-aware, NOT delta state — every bump does an O(scope) rescan in the scope's current row order (store insertion order for `'all'`, post-filter order for `'visible'`, group-bucket order for `'group'`/`'parent'`). No `{addRow, removeRow, updateRow}` incremental path; correctness over incrementality for this pair |

**Scopes** — `'all'` (whole dataset) · `'visible'` (post-filter set) ·
`'group'` (the row's group) · `'parent'` (the enclosing parent group).
**Promotion:** with NO active row grouping, `'group'` resolves over the
visible set (one implicit group) — toggling grouping on live-promotes
it to per-group, which is why `PCT_OF_GROUP`-style columns re-scope
without a re-register.

**`PREV([col])`** — tick-scoped previous value from the worker's
transaction snapshot: non-null only for rows touched by the current
transaction; `null` before any transaction and for untouched rows.
Unresolved `PREV` reads as engine-level `null` — a numeric-typed
transport slot may carry a `0` sentinel across the worker→main wire for
an unresolved read, but the calc value the cell/consumer sees is `null`,
never a real zero.

**One-frame settle:** filtering ON an aggregate-dependent (Stage B)
calc column uses the values from the previous completed pipeline pass,
because the pipeline order is filter → group → sort, so a Stage B
column's group-scoped inputs aren't final until after the filter that
would consult them has already run. Sorting on a Stage B column is
fresh (sort runs after group, so its inputs are current for that pass).
Row-local (Stage A) calc columns have no such restriction — they're
available fresh to every stage.

**Distinct values** work on calc columns too — `getDistinctValues`
consults the calc value source alongside the four data-column sources,
so calc columns participate in filter-panel value lists like ordinary
columns.

**Errors → null cells:** a runtime evaluation error (null propagation,
bad arithmetic) renders the cell `null` — it never breaks the pipeline.

## Reserves (grammar-honest)

`RANK` / `DENSE_RANK` / `PERCENT_RANK` / `RUNNING_SUM` / `RUNNING_AVG`
/ `MOVING_AVG` / `DELTA_FROM_*` and `window:{order,size}` scopes parse
and reject with `not-yet-implemented` + a follow-up-cycle pointer —
they need per-scope ORDERED state coupled to the sort model. t-digest
approximate percentiles land with that family.

## Aggregate registry + the worker crossing

`registerAggregate(name, impl, opts?)` with the delta contract
`{init, addRow, removeRow, updateRow, finalize}` — property: any
add/remove/update stream finalizes identically to a from-scratch
recompute. Implementations MUST be self-contained (zero free
variables): they cross to the kernel worker as `fn.toString()` sources
reconstructed via `new Function` (the kernel `aggFuncRegistry`
precedent). **CSP caveat:** environments blocking `unsafe-eval` cannot
reconstruct the shipped sources — same caveat as custom aggFuncs;
interpreters/impls are static library sources, never user input. The
cache is keyed `(fn, colId, scopeKey, dataVersion)`; transactions bump
`dataVersion` per affected scope only.

## Overrides & templates

Fold chain per column, left wins nothing / right wins everything:

```
typeDefault (by cellDataType) → templateIds (left-to-right) → per-column assignment
```

`cellStyle` merges per-field across layers; every other property is
last-writer-wins. `ColumnOverride.templateIds: undefined` → the type
default applies; `[]` → explicit opt-out. `editable` may be overridden
on DATA columns only — calc columns are derived and reject it
(`bad-shape`). Engines are Date-free: `saveTemplate` takes a `now`
argument; hosts stamp timestamps.

**`WireCalcOptions.typeDefaults` takes raw format-DSL strings**, one
per `TypeDefaults` bucket (`numeric` / `date` / `string` / `boolean`) —
the same host-facing convenience as `opts.overrides[].format` and
`opts.templates[].overrides.format`. `CalcEngine.setTypeDefaults`
itself takes TEMPLATE IDS, not raw strings; the bridge closes that gap
by seeding one synthetic single-key (`format`) template per populated
bucket under a reserved id, `__cgridTypeDefault:<bucket>`, and pointing
`setTypeDefaults` at those ids. **The `__cgridTypeDefault:` id prefix is
reserved** — a host-supplied `opts.templates[].id` (or a direct
`calc.saveTemplate` call) using that prefix silently collides with the
bridge's synthetic bucket templates and corrupts type-default
resolution. Treat it as off-limits. These synthetic templates are
filtered out of `calc.listTemplates()` — they're a bridge-internal
implementation detail, not host-authored.

## Public API

| Surface | Members |
|---|---|
| `CalcEngine` | `registerCalculatedColumn` / `removeCalculatedColumn` / `listCalculatedColumns`, `applyOverrides` / `getOverrides`, `saveTemplate` / `applyTemplate` / `deleteTemplate` / `listTemplates`, `setTypeDefaults`, `resolvedPatchFor(colId, cellDataType)` |
| Compile | `compileCalc(source, schema?)` → `{ ok, compiled: { ast, prePass, watchedColIds, usesPrev, cellDataType } } \| { ok: false, error }`, `transformAggregates(ast, schema?)` |
| Aggregates | `registerAggregate(name, impl, opts?)`, `getAggregate`, `listAggregates` |
| Worker | `evaluateCalcAst(ast, row, aggSlots, prevLookup)`, `INTERPRETER_SOURCE`, `buildWorkerCalcProgram(...)` |
| Bridge | `wireIntoKernel(grid, opts?)` → `{ calc }` (`WireCalcOptions`: `calculatedColumns` / `overrides` / `templates` / `typeDefaults` / `schema`) |
| Types | `CalculatedColumnDef`, `CellDataType`, `AggScope`, `AggSpec`, `CompiledCalc`, `Aggregate`, `ColumnOverride`, `ColumnTemplate`, `TypeDefaults`, `CalcValidationError`, `WireCalcOptions`, `Unsubscribe` |

## Error surfaces

Registration APIs never throw — invalid items are skipped and reported
(the bridge `console.warn`s skips). `CalcValidationError.code`:

- `parse` — expression failed `expression.parse` (carries `loc`)
- `unknown-fn` / `arity` — compile rejections
- `not-yet-implemented` — order-dependent aggregate / `window:` scope
- `bad-shape` — structural def/override failure (incl. `editable` on a
  calc column, and a calc-on-calc expression reference)
- `duplicate-colId` — collides with a data field or another calc column
- `unknown-scope` — scope literal outside `'all' | 'visible' | 'group' | 'parent'`
- `format-compile` — the def's `format` string failed the format compiler

## What's not in this cycle

- Order-dependent aggregates, `window:` scopes, t-digest — follow-up
  cycle (the only feature-level reserve).
- Dependency-ordered calc-on-calc evaluation — follow-up cycle (see
  Quickstart note above).
- Aggregates inside `@wellsfargo-starui/velocity-grid-rules` conditions / format Tier-1
  interiors — follow-up once both engines coexist.
- Customizer editor panels — Cycle 21i (`@wellsfargo-starui/velocity-grid-customizer`).
- Editing calculated columns / editable-overrides UI — `@wellsfargo-starui/velocity-grid-edit`
  (21g) + 21i.
