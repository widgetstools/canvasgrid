# Cycle 21 — Modular monorepo + intrinsic feature absorption (decision doc)

**Status:** decision doc, options + tradeoffs. Not a task plan.
**Author:** Anand (via Claude)
**Date:** 2026-07-01
**Depends on:** Cycle 19 refactor hygiene (in flight); does not wait on Cycle 20 completion — Cycle 20 lands into the new monorepo structure.
**Related plans:**
- [2026-07-01-canvasgrid-cycle-20-excel-pivot-parity.md](2026-07-01-canvasgrid-cycle-20-excel-pivot-parity.md) — pivot-specific architecture; consumes the package structure decided here
- StarUI docs under [docs/starui-customizer-ui/](../../starui-customizer-ui/) (20 editor + toolbar docs) and [docs/starui-platform/](../../starui-platform/) (data-providers, config-manager) — the tooling this doc scopes cgrid to intrinsically support

---

## 0. Core principle — no retroactive layering

**Locked 2026-07-01.** If a feature requires even the slightest intrinsic support from cgrid — a paint hook, an event, a state field, a lifecycle callback — cgrid must implement the *whole* feature, not expose a minimal hook and let addons build the feature on top.

**What this means concretely:**

- Conditional styling, alerts, calculated columns, edit journal, smart-edit / bulk-update, expression evaluation, formatting DSL, column overrides, column templates — all become **intrinsic to cgrid** (spread across purpose-built packages, described in §3).
- The StarUI customizer becomes a **pure UI shell + host-integration layer** — 20 editor/toolbar panels, config manager storage, notification channels, data provider adapters. Nothing that needs a new cgrid hook lives outside cgrid.
- Any future request that would require a new hook is a signal to build the whole feature intrinsically, not to add the hook and layer the feature elsewhere.

**Why:** retroactive layering is expensive. Every consumer that needs the feature triggers another cgrid retrofit. Doing it native and once — even if the initial surface is larger — is cheaper across the roadmap. Aligned with the wrapper-native semantics principle from the base library's side: don't ship semi-features that force wrappers to compensate.

---

## 1. Problem framing

Three orthogonal asks converged in the review of the StarUI docs:

1. **Feature scope** — the 20-doc StarUI catalog specifies conditional styling, alerts, calculated columns, plus/minus rules, keyboard shortcut ops, smart-edit, bulk-update, edit journal + undo/redo, formatting toolbar, column templates, filter presets, grid-options panel, Excel export with visual formatting, and a row-exclusion global filter. Every one of these needs intrinsic support (per §0), so every one lands in cgrid.
2. **Modularity** — shipping all of the above as one grid package is anti-modular. Consumers who want a plain grid shouldn't pay for the alerts engine. Worker bundles shouldn't include DOM-shaped code. Two internal wrappers (ExcelPivotGrid, StarUI customizer) should consume the same engine layer without reaching into a monolith.
3. **Efficiency** — real-time ticking at 60Hz × 50k rows (Cycle 20 target) is unforgiving. Expression evaluation, aggregate computation, and style resolution all need to run on the worker; main thread must be a pure painter. Package boundaries need to respect the runtime split (worker vs main) as much as the domain split.

Combined, these force the intrinsic surface to grow substantially. The design question is: how do we grow it *modularly*, *before* absorbing features, so nothing lands in the wrong package retroactively?

---

## 2. Locked decisions (2026-07-01)

Nine decisions were made through discussion in this session:

| # | Decision | Implication |
|---|---|---|
| L1 | **No retroactive layering** | Any feature that needs intrinsic support lives in cgrid |
| L2 | **Multiple packages for modularity + efficiency** | Domain-oriented split across 10 packages (§3) |
| L3 | **Turborepo, lockstep versioning** | Single version bump across all `@cgrid/*` packages; independent SemVer deferred until API stabilizes |
| L4 | **Split BEFORE absorbing features** | Monorepo scaffold with correctly-shaped packages lands before any StarUI feature is implemented, so features never land in the wrong package |
| L5 | **Expression-first, code path fully supported** | Every value/format/style/renderer/editable hook accepts field-path OR JS function OR expression string; expressions auto-compile via `@cgrid/expression` |
| L6 | **Unified formatting DSL** | Excel format codes at Tier 0, expression extensions at Tier 1, composite fragments at Tier 2 — one language, one parser, one docs page (§5) |
| L7 | **Worker-only expression evaluation; main thread is a pure painter** | All expression/rule/aggregate evaluation happens on the worker; results ship in a compact style channel; main thread never evaluates expressions (§7) |
| L8 | **Canvas Path2D icons from Lucide/Phosphor sources** | No emoji, no DOM overlays for common icon needs; icons participate in text metrics inline in format strings |
| L9 | **Tick-scoped `prev()`** | Previous-value semantics scoped to one transaction cycle — sufficient for flash-on-tick and relative-change alerts; not a general history buffer |

---

## 3. Package inventory + dependency graph

Ten packages, all in one turborepo. Under `packages/` at the repo root. Lockstep versioned via each `packages/*/package.json` sharing the same version, bumped together by the release workflow.

### 3.1 Package responsibilities

| Package | Responsibility | Runtime |
|---|---|---|
| `@cgrid/kernel` | Data model, columns, editing primitives, event system, module-scoped state API, mutation contract, canvas paint loop, painter primitives incl. Path2D icon registry, worker RPC plumbing, transactions, base cell renderers (text, number, boolean, checkbox, image, hyperlink, custom-registration) | main + worker |
| `@cgrid/expression` | DSL parser, compiler (row-local + aggregate splitting), portable AST, evaluators | main + worker |
| `@cgrid/format` | Unified formatting DSL parser (Excel format codes + expression extensions + composite fragments), Intl-backed number/date/currency formatters, formatter template registry, style resolution | main + worker |
| `@cgrid/rules` | Rule engine (rule = condition + action), conditional-styling rules, alerts core (trigger evaluation, severity, message templating — channels stay in host), match-count tracking | worker (evaluation), main (result consumption) |
| `@cgrid/calc` | Calculated columns, column customization / overrides, column templates, aggregate function registry, aggregate cache, delta-aware aggregation | worker |
| `@cgrid/renderers` | 40 rich cell renderers for financial blotters — numeric (tick-aware), text/identity, indicators, badges/pills, bars/gauges, in-cell charts/sparklines, composite, action. Detailed in [cell renderer catalog doc](2026-07-01-canvasgrid-cell-renderer-catalog.md). | main + worker |
| `@cgrid/edit` | EditJournal (undo/redo, cascade semantics, per-source recording), CellPatch data structure, smart-edit ops + magnitude parser (K/M/B), bulk-update ops, patch preview/commit, distinct-values RPC | main + worker |
| `@cgrid/export` | Excel/CSV export with visual formatting (pulls resolved formatters + rule colors when visual mode on) | main |
| `@cgrid/customizer` | 20 StarUI editor panels + toolbars, popout window primitive, template manager UI. Consumes everything else via public API only. | main |
| `@cgrid/excel-pivot` | ExcelPivotGrid — Excel-native pivot data model + engine (Cycle 20). Uses kernel as rendering substrate. | main + worker |

**Note on `@cgrid/platform`.** An earlier sketch included a `@cgrid/platform` package for data provider adapters, config manager storage, and notification channels. On reflection this is **host-app code, not shipped by cgrid** — it depends on host stack (STOMP, OpenFin, storage backends) that cgrid should not know about. Reference implementations may live in the customizer docs, but they are not a first-party package. The intrinsic hooks are what cgrid must expose; wiring them to a host stack stays in the host.

### 3.2 Dependency graph

```
kernel        (no cgrid deps)
expression    (no cgrid deps)
format        → expression                                      (format DSL uses expressions inside [...] brackets)
rules         → kernel, expression, format                      (rule actions can reference format templates)
calc          → kernel, expression, format                      (calculated column defs reference formatters)
renderers     → kernel, expression, format, calc, rules         (rich renderers consume all engine layers)
edit          → kernel
export        → kernel, calc, rules, format                     (visual mode needs rule colors + resolved formatters)
customizer    → kernel, expression, format, rules, calc, renderers, edit, export
excel-pivot   → kernel, expression, format, calc, renderers, edit, export
```

No cycles. `kernel` and `expression` are leaves — independently buildable, testable, publishable. Every other package has a single-directional path back to those two.

**Bundle-size implications** (rough, before we've built anything):

- Plain grid consumer: `@cgrid/kernel` only. Comparable to today's `cgrid`. Base renderers (text, number, boolean, checkbox, image, hyperlink) included.
- Grid + formatting only: kernel + expression + format. Bounded, no rules/calc/renderers.
- Blotter consumer (finance-flavoured): kernel + expression + format + calc + rules + renderers. All 40 rich renderers, tick semantics, heat cells, sparklines, composite cells.
- Full StarUI experience: everything.
- ExcelPivotGrid consumer: everything except `customizer`.

---

## 4. Intrinsic API delta per package

Descriptive of the public surface each package exposes beyond what today's monolithic `cgrid` package offers. Not a task list. Anything not called out is presumed to stay as-is.

### 4.1 `@cgrid/kernel`

- **Mutation contract** — every mutation to the grid is representable as a plain JSON `Mutation` object.
  - `grid.apply(mutation: Mutation): void`
  - `grid.onMutation(fn: (m: Mutation) => void): Unsubscribe`
  - Config manager and edit journal both consume this stream; every editor panel produces mutations.
- **Module-scoped state API** — replaces monolithic `getState()` / `setState()`.
  - `grid.getModuleState(moduleId: string): unknown`
  - `grid.setModuleState(moduleId: string, state: unknown): void`
  - `grid.isDirty(moduleId?: string): boolean`
  - `grid.onModuleChange(moduleId: string, fn: () => void): Unsubscribe`
  - Modules include: `columns`, `filters`, `sorts`, `groups`, `pivot`, `selection`, `scroll`, `styling-rules`, `alerts`, `calc-columns`, `column-templates`, `saved-filters`, `edit-journal`, `grid-options`.
- **Grid options key/value API** — for grid-options panel (StarUI doc 08).
  - `grid.getGridOption<K extends GridOptionKey>(key: K): GridOptionValue<K>`
  - `grid.setGridOption<K extends GridOptionKey>(key: K, value: GridOptionValue<K>): void`
  - Legal keys enumerated in a shared type; panel content rendering (80 controls) stays in customizer.
- **`cellValueChanged` event includes `oldValue`** — required by rules, alerts, edit journal.
  - `cellValueChanged: { rowId, colId, oldValue, newValue, source }`
- **Batched partial refresh** — `grid.refreshCells({ rowIds?, colIds?, force? }): void`
- **Per-column `suppressKeyboardEvent(colId, event)` hook** — for plus/minus (doc 06) and shortcuts (doc 07).
- **Composite row-key spec** — `grid.setRowKey({ columns: string | string[] })`; supports `'id'`, `['symbol', 'exchange']`, and dot-path fields `'nested.field'`.
- **Column def accepts three forms on every hook** — `field`, `valueGetter`, `valueFormatter`, `cellStyle`, `cellClass`, `cellRenderer`, `editable`, `cellBackground` each accept:
  - a field-path string
  - a JS function
  - an expression string (auto-compiled via `@cgrid/expression`)
- **Cell renderer registry** — string key → factory function drawing to canvas.
  - `grid.registerCellRenderer(name: string, factory: CellRendererFactory): void`
  - Built-in renderers: text, number, checkbox, indicator-badge, composite, formatted.
- **Icon registry** — Path2D-based, sourced from Lucide + Phosphor at build time.
  - `grid.registerIconSet(name: string, paths: Record<string, string>): void`
  - Icons participate in text metrics when embedded inline via format DSL `{icon:name}`.
- **Style channel from worker** — kernel receives per-cell style data (fg color, bg color, weight, iconPathId, editable-bit) as a compact typed-array delta alongside data deltas; paint loop reads with zero branching on rules.
- **Interactive overlay layer** — hover, selection, focus overlays composited over the worker-driven base style; overlays are stateless (no expression eval).
- **Cell tooltip hook** — `grid.registerTooltipProvider(colId, fn)` — kernel invokes the provider on hover (after a debounce) with `(row, colId)` context, receives a tooltip payload (plain text or rich HTML). Composite cells use this to show full expanded content when ellipsis truncates.

### 4.2 `@cgrid/expression`

New package. Public surface:

- **AST + parser** — `parse(source: string): Ast`
  - Excel-inspired column references `[colId]`, including dot-path `[nested.field]`
  - Arithmetic, comparison, logical ops
  - Function calls (registered functions)
  - Aggregate function calls (§6)
- **Compiler** — `compile(ast: Ast, schema: ColumnSchema): CompiledProgram`
  - Splits row-local from aggregate portions
  - Emits pre-pass plan (aggregates to compute) + per-row plan (references to pre-computed scalars)
- **Evaluators** — same portable AST runs on both threads.
  - `evaluateRow(program, row): Value` (main + worker)
  - `evaluatePrePass(program, rows, scope): AggregateResults` (worker only)
- **Function registry** — `registerFunction(name, impl)` for both scalar and aggregate functions.
- **Validation** — `validate(source, schema): { ok: boolean; errors: ValidationError[] }` — surfaces to customizer UI's expression editor.
- **Transferable AST** — postMessage-serializable, so main thread can compile once and hand to worker (or vice versa).

### 4.3 `@cgrid/format`

New package. Public surface:

- **DSL parser** — parses Tier 0 (Excel), Tier 1 (Excel + expressions), Tier 2 (composite fragments) from a single format string / column def.
- **Formatter template registry** — `registerFormatterTemplate(name, factory)`.
  - Built-in templates: `Number`, `Currency`, `Percent`, `Date`, `Time`, `DateTime`, `RelativeTime`, `Abbreviated` (K/M/B), `Custom` (raw format string).
  - Each template resolves to an `Intl.*` formatter cached by param hash.
- **Composite column type** — column def shape:
  ```ts
  {
    type: 'composite',
    fragments: Fragment[],
    cellBackground?: string,     // format string with bg=<expr>
    align?: 'left' | 'center' | 'right',
    overflow?: 'ellipsis' | 'clip'
  }
  type Fragment =
    | { text: string }
    | { expr: string; format?: string; style?: FragmentStyle }
  type FragmentStyle = {
    color?: string,       // literal, or 'rule:<ruleId>', or '[<expr>]'
    weight?: 'normal' | 'bold' | number,
    style?: 'normal' | 'italic',
    size?: number,         // px, relative to row height
    background?: string    // per-fragment background (rare)
  }
  ```
- **Style resolution** — given a fragment and a row context, resolves style properties (colors, weights, background) into concrete values, including expression evaluation. Runs on worker.
- **Compiled format program** — format strings compile once at column-def load, cached by string identity.

### 4.4 `@cgrid/rules`

New package. Public surface:

- **Rule types** — `ConditionalStyleRule`, `AlertRule`, `IndicatorRule`; each has `id`, `condition` (expression), `scope` (columns / rows / cells), `action` (style / alert / indicator).
- **Rule engine** — evaluates all rules against affected cells on worker; produces cell-level rule-context (which rules matched, in what order) and folds actions into the style channel.
- **Live match count** — `rules.matchCount(ruleId): number` for customizer UI's "N cells match this rule" display.
- **Cross-package integration** — `@cgrid/format` reads rule matches via a rule-context accessor when a fragment style references `'rule:<ruleId>'`.
- **Alert triggers** — evaluate on transaction; produce alert events consumed by host.
  - `alerts.onAlert(fn: (alert: AlertEvent) => void): Unsubscribe`
  - Host decides how to route (toast, OS notification, OpenFin badge). Cgrid does not ship channels.

### 4.5 `@cgrid/calc`

New package. Public surface:

- **Calculated column def** — `{ colId, expression, format?, header, ... }`. Registered via `calc.registerCalculatedColumn(def)`, synthesized into the column tree.
- **Column override model** — layered mutations on top of base colDefs, precedence rules explicit.
  - `calc.applyOverrides(overrides: ColumnOverride[]): void`
  - Overrides can set `format`, `cellStyle`, `cellRenderer`, `editable`, `hide`, `width`, custom header.
- **Column templates** — `calc.saveTemplate(name, spec)`, `calc.applyTemplate(name)`, `calc.listTemplates()`; templates are named `ColumnOverride[]` snapshots.
- **Aggregate function registry** — `calc.registerAggregate(name, impl)`. Built-in categories (see §6.4).
- **Aggregate contract** — delta-aware (§6.3).
- **Aggregate cache** — keyed by `(fn, column, scope, dataVersion)`; incremental updates on tick.
- **Distinct-values RPC** — `workerClient.getDistinctValues(colId, limit): Promise<Value[]>` for bulk-update toolbar dropdown (StarUI doc 15).

### 4.6 `@cgrid/renderers`

New package. 40 rich cell renderers targeting financial blotter use cases (equities + fixed income), catalog fully specified in [2026-07-01-canvasgrid-cell-renderer-catalog.md](2026-07-01-canvasgrid-cell-renderer-catalog.md). Public surface:

- **Renderer catalog** — 40 renderers across 8 categories: Numeric tick-aware (9), Text/identity (5), Indicators (6), Badges/pills (7), Bars/gauges (8), In-cell charts/sparklines (7), Composite (5), Action (2).
- **Registration** — each renderer self-registers on package import via `kernel.registerCellRenderer(name, factory)`; consumers activate a renderer by string key on column def (`{ colId, type: 'price' }`) or by passing a renderer factory directly.
- **Themeable design tokens** — every renderer reads colour/motion/typography tokens from a shared theme registry so the aesthetic bar (§1 of the catalog doc) is consistent and swappable.
- **Icon set consumption** — renderers use kernel's icon registry (Lucide default, Phosphor opt-in per Q10.6).
- **Contextual data hooks** — renderers requiring column-wide statistics (HeatCell, BidirectionalBarCell, SpreadBarCell, VolumeBar) consume calc's aggregate cache; renderers requiring windowed history (sparklines, YieldCurveSparkline, KRDBarChart) consume expression-driven data windows.
- **Composite renderer factory** — StackedValueCell, PriceQuoteCell, NBBOCell, BenchmarkSpreadCell, PriceChangeComposite are all configurations of the composite column type from `@cgrid/format` Tier 2.

### 4.7 `@cgrid/edit`

New package. Public surface:

- **EditJournal** — undo/redo stacks with cascade semantics.
  - `journal.undo()`, `journal.redo()`, `journal.canUndo`, `journal.canRedo`
  - Per-source recording toggles (`recordFromSource('smart-edit'): boolean`)
  - Bounded history with configurable retention
- **CellPatch** — atomic pending mutation `{ rowId, colId, newValue, meta }`; patch arrays are the deferred-mutation currency for smart-edit and bulk-update.
- **Smart-edit ops** — `buildSmartEditPatches(op, scope): CellPatch[]`. Ops: `+`, `-`, `*`, `/`, `set`, `set-percent`. Magnitude parser accepts `K`, `M`, `B` suffixes.
- **Bulk-update ops** — `buildBulkUpdatePatches(value, scope): CellPatch[]`.
- **Patch apply** — `applyPatches(patches: CellPatch[], options: { preview?: boolean; commit?: boolean }): PatchResult`; preview returns projected values without committing.

### 4.8 `@cgrid/export`

New package. Public surface:

- `exportToExcel(options: { visualFormatting?: boolean; scope?: 'all' | 'visible' | 'selection' }): Blob`
  - Visual mode threads rule colors + resolved formatters into the XLSX cell styles.
- `exportToCSV(options): string`

### 4.9 `@cgrid/customizer`

New package. Not detailed here — this doc scopes intrinsic surface, and customizer is by definition non-intrinsic (it consumes everything via public API of the packages above). Package exists so the split respects L1 from day one — if customizer needs a new hook, we add it to the correct core package, not to the customizer.

### 4.10 `@cgrid/excel-pivot`

Detailed in Cycle 20 plan. Consumes kernel + expression + format + calc + edit + export. This doc unblocks that one by defining the packages it depends on.

---

## 5. The unified formatting DSL

Three tiers, one language, one parser. Users start at Tier 0 (Excel muscle memory) and layer up as needs grow.

### Tier 0 — pure Excel format codes

Anything a spreadsheet user already knows. Works verbatim:

```
$#,##0.00                            →  $1,234.56
$#,##0.00;[Red]-$#,##0.00            →  green positive, red negative
0.00%                                →  12.34%
"Q"0 " " yyyy                        →  Q3 2026
_(* #,##0_);_(* (#,##0);_(* "—"_)    →  aligned accounting
```

### Tier 1 — Excel plus icons and expressions

Extend Excel's own bracket convention with `{icon:name}` and expression brackets `[color=<expr>]`, `[bg=<expr>]`, `[weight=<expr>]`, `[if <expr>]`.

```
[Green]{icon:trending-up} $#,##0.00 ; [Red]{icon:trending-down} -$#,##0.00
[color=[if [change]>0 then #0a7 else #d33]] $#,##0.00
[bg=[if abs([change])>0.05 then #fee else transparent]] $#,##0.00
```

Icon references resolve to Path2D at paint; colors resolve per row via worker-side expression evaluation; the resolved values ship in the style channel.

### Tier 2 — composite / rich-text cells

For displaying multiple values in one cell, each formatted independently. Column def shape (§4.3). Each fragment's `format` field uses Tier 0 or Tier 1 syntax:

```ts
{
  colId: 'summary',
  type: 'composite',
  fragments: [
    { expr: '[symbol]', format: '@',           style: { weight: 'bold' } },
    { text: '  ' },
    { expr: '[price]',  format: '$#,##0.00',   style: { color: 'rule:priceColor' } },
    { text: '  ' },
    { expr: '[change]', format: '[Green]{icon:trending-up}+0.00%;[Red]{icon:trending-down}-0.00%' }
  ],
  cellBackground: '[if abs([change])>0.05 then #fee else transparent]',
  align: 'left',
  overflow: 'ellipsis'
}
```

### DSL design decisions (resolved 2026-07-01)

1. **Single line only.** Composite cells are always horizontal, no wrap. Row heights stay uniform. Multi-line is a future consideration only if a use case genuinely needs it.
2. **Ellipsis + hover tooltip.** When content exceeds cell width, the last visible fragment truncates with an ellipsis; a tooltip on hover shows the full expanded text (all fragments concatenated as plain text). Kernel's tooltip hook accepts a tooltip provider on the composite column def.
3. **Multi-format clipboard.** Copy writes both `text/plain` (concatenation of all fragment strings) and `text/html` (a rich-text run preserving fragment styles). Excel picks up the HTML with styling intact on paste; plain-text consumers get the concatenation.
4. **Non-editable.** Composite cells are derived views. To edit source values, users edit the source column directly.

---

## 6. Expression + aggregate architecture

### 6.1 Two evaluation shapes, one syntax

**Row-local expressions** — evaluate per-row, stateless:

```
[price] * [qty]
IF([change] > 0, "up", "down")
prev([bid])
```

**Aggregate expressions** — compute one scalar per `(function, column, scope, dataVersion)`, then reference it per row:

```
[price] / SUM([price])
[revenue] / SUM([revenue], scope: group)
RANK([latency])
PERCENTILE([price], 95)
```

The compiler detects aggregate calls, splits the AST into a pre-pass (aggregates to compute) and a per-row program (references pre-computed scalars). `[price] / SUM([price])` becomes:

```
pre-pass:  __agg_1 = SUM(price, currentScope, dataVersion)   // once per scope
per-row:   row.price / __agg_1                                // cheap per row
```

### 6.2 Scope model

| Scope | Meaning | Default when |
|---|---|---|
| `all` | Entire dataset, ignoring filters | Explicit request; pivot grand-totals |
| `visible` | Rows after current filter | Non-grouped calculated columns |
| `group` | Current row's immediate group | Grouped calculated columns |
| `parent` | Row's parent group (nested grouping) | Excel's "% of parent row total" |
| `window: {order, size}` | Ordered window preceding this row | RUNNING_SUM, MOVING_AVG |

Syntax:

```
SUM([revenue])                                              // default for context
SUM([revenue], scope: all)                                   // explicit
SUM([revenue], scope: group)
MOVING_AVG([price], scope: {order: [ts] asc, size: 10})
```

### 6.3 Delta-aware aggregate contract

Every aggregate function ships as a delta-aware implementation, so aggregates can be updated by delta rather than recomputed against the full dataset each tick:

```ts
type Aggregate<T, S> = {
  init(): S,
  addRow(state: S, value: T): S,
  removeRow(state: S, value: T): S,
  updateRow(state: S, oldValue: T, newValue: T): S,
  finalize(state: S): number
}
```

Complexity by function class:

- **SUM, COUNT, AVG** — O(1) per delta. State is scalar or `{sum, count}`.
- **MIN, MAX** — O(log n) per delta with a heap or sorted multiset.
- **MEDIAN, PERCENTILE** — hybrid: sorted structure (exact, O(log n) per delta) up to ~10k rows per scope; t-digest (approximate, bounded-memory, O(log n) per delta) above that threshold. Threshold configurable per-aggregate via `registerAggregate` options.
- **RANK, DENSE_RANK, PERCENT_RANK** — order-dependent; scope-scoped recompute on change. Cache invalidates the scope's rank result, not per-row.
- **RUNNING_SUM, RUNNING_AVG, MOVING_AVG** — order-dependent per group; window-local delta.
- **FIRST, LAST** — O(1) with tracked pointers.

### 6.4 Built-in aggregate categories

Cgrid ships the following out of the box; consumers register more via `calc.registerAggregate(name, impl)`:

- **Basic** — SUM, AVG, MIN, MAX, COUNT, COUNT_DISTINCT
- **Statistical** — MEDIAN, PERCENTILE(v, p), STDEV, VAR, MODE
- **Ratio / share** — PCT_OF_TOTAL, PCT_OF_GROUP, PCT_OF_PARENT, PCT_OF_GRAND
- **Rank / order** — RANK, DENSE_RANK, PERCENT_RANK
- **Cumulative / windowed** — RUNNING_SUM, RUNNING_AVG, MOVING_AVG(n), FIRST, LAST
- **Comparative** — DELTA_FROM_PREV, DELTA_FROM_FIRST, DELTA_FROM_LAST

Covers everything Excel exposes as "Show Values As," plus what StarUI docs 03 / 04 / 05 need.

### 6.5 Cache invalidation

Aggregate cache keyed by `(fn, column, scope, dataVersion)`. Every transaction bumps dataVersion for affected scopes. Aggregates in unaffected scopes reuse cached scalars.

For real-time ticking (Cycle 20 target: 60Hz × 50k rows), this is what makes calculated columns viable — `SUM(50k)` is not recomputed every tick; it is updated by `-oldValue + newValue` in O(1) via the delta contract.

---

## 7. Worker-only evaluation architecture

Main thread is a pure painter. No expression evaluation, no rule evaluation, no formatting DSL evaluation. Every decision that involves per-cell computation happens on the worker and ships to main thread as data.

### 7.1 What the worker ships per transaction

Alongside the data delta (row inserts/updates/removes), the worker ships a **style channel delta**:

```
StyleChannelDelta = {
  version: number,
  cellStyles: {
    // packed typed arrays, one entry per changed cell
    rowIds: Uint32Array,
    colIndex: Uint16Array,
    fgColorIndex: Uint16Array,       // index into shared color palette
    bgColorIndex: Uint16Array,
    weightIndex: Uint8Array,          // 0=normal, 1=bold, ...
    iconPathId: Uint16Array,          // 0=none, else index into Path2D map
    editableBit: Uint8Array,          // 1 bit per cell, packed
  },
  fragmentPlans: {
    // for composite cells: precomputed fragment list per changed cell
    ...
  },
  aggregateResults: {
    // scalars for aggregates used by paint-visible calc columns
    ...
  }
}
```

Style channel is delta-encoded — cells whose styles didn't change ship nothing. Color palette and weight table are shared, populated by the worker as new colors appear, indexed by both threads.

### 7.2 Main thread paint loop

For each visible cell:

1. Read data value from row model.
2. Read style channel entry (fgColor, bgColor, weight, iconPathId, editable).
3. Composite interactive overlay if applicable (hover, selection, focus).
4. Draw text + icon glyph + background using canvas primitives.

No branching on rules. No expression evaluation. No formatting logic. Target: under 8ms per frame at 50k visible rows scrolled.

### 7.3 Editing lifecycle under worker-only

Editing is triggered by user action on main thread. Editability was precomputed on worker and shipped as an editable-bit in the style channel — main thread reads it synchronously. Cell click / F2 / keystroke either opens the editor or ignores the input. No async round-trip to check editability.

On edit commit: main thread emits a mutation via the mutation contract; worker applies to data, recomputes affected style channel entries and aggregates, ships the delta back. Round-trip bounded by transaction latency, not by expression complexity.

### 7.4 `prev()` semantics

Tick-scoped. During `applyTransaction`, the worker snapshots pre-update values for affected rows; `prev()` in expressions evaluated during that transaction reads from the snapshot. Snapshot discarded after the transaction's paint completes.

- Flash-on-tick — works.
- Alert-on-relative-change — works.
- "Previous value 5 minutes ago" — does NOT work. Windowed history is a different feature (belongs to aggregate `MOVING_AVG` / a future time-window function, not `prev()`).

---

## 8. What stays in host / addon (not intrinsic)

To keep §0 honest, these features do **NOT** need intrinsic support and stay in the host / customizer layer:

- **Config manager storage** — profiles saved to localStorage, IndexedDB, remote KV store. Consumes `getModuleState` + `onMutation`; produces `setModuleState`. No new cgrid hooks.
- **Data provider adapters** — STOMP, WebSocket, OpenFin FDC3, REST polling. Consume `applyTransaction`. No new hooks.
- **Alert channel routing** — toast, OS notification, OpenFin badge, Slack, email. Consumes `alerts.onAlert(fn)`. No new hooks.
- **Popout window primitive** — OS window lifecycle for detachable panels. DOM concern.
- **Template manager UI** — saves formatting snapshots. State lives via `setModuleState('column-templates', ...)`.
- **20 StarUI panel UIs** — dialogs, forms, side-nav, popouts. All consume the packages above via public API.
- **Grid-options panel content rendering** — cgrid exposes `setGridOption(key, value)` + the schema of legal keys; the panel rendering the 80 controls is customizer.

If any of the above turns out to need a new cgrid hook, that is a signal that a feature needs to move *into* the core packages — not that the hook goes into a customizer add-on. §0 is durable.

---

## 9. Migration options — split before features (L4)

L4 locked "split before absorbing features." Three options for HOW to split; recommendation is C.

### Option A — Big-bang split

One large PR does everything: sets up turborepo, moves current `cgrid/src/*` into `packages/kernel/src/*`, creates all other packages with initial code, migrates all consumers (`apps/*`, tests, docs).

- **Pros:** single migration event; no intermediate state.
- **Cons:** enormous PR; high review risk; blocks all other work for the duration; conflicts with in-flight Cycle 19 refactor tasks.
- **When it fits:** codebase is small and no other work is in flight. Neither is true here.

### Option B — Progressive scaffold

A cycle moves current `cgrid` into `packages/kernel` only. Later cycles add each new package as its feature work begins (`@cgrid/expression` when calc columns start; `@cgrid/rules` when conditional styling starts; etc.).

- **Pros:** smaller PRs; incremental risk.
- **Cons:** during the gap between kernel-move and other packages existing, new features naturally land in kernel and get moved out later. Exactly the retroactive-layering pattern L1 forbids.
- **Verdict:** violates L4 semantically even if it satisfies it literally.

### Option C — Empty scaffolds up front (recommended)

Cycle 21a lands the full monorepo scaffold in one PR:

1. Sets up turborepo at repo root — migrates root `package.json` `workspaces` to include `packages/*`, adds `turbo.json` with task pipeline (`build`, `test`, `typecheck`, `lint`), dependency-aware ordering, per-package caching.
2. Moves current `cgrid/src/*` → `packages/kernel/src/*`. Updates all imports across `apps/*`, tests, docs. Renames `cgrid/package.json` `"name": "cgrid"` to `"name": "@cgrid/kernel"` — direct rename, no meta-package, no aliasing (Q10.1 resolved: no existing external consumers).
3. Creates `packages/expression`, `packages/format`, `packages/rules`, `packages/calc`, `packages/edit`, `packages/export`, `packages/customizer`, `packages/excel-pivot` — each with `package.json` (locked version, dep declarations), `tsconfig.json`, `README.md`, minimal `src/index.ts` (empty exports or type stubs), test scaffold.
4. Turborepo pipeline caches build/test/typecheck outputs per package; empty packages return instantly on rebuild.

- **Pros:** every future feature lands in its correct package from birth. L1 + L4 both satisfied durably. Consumers migrate imports once, not repeatedly.
- **Cons:** larger up-front PR than Option B; requires turborepo learning curve; empty packages initially accumulate CI runs (mitigated by turborepo caching).
- **Verdict:** recommended. Direct fulfillment of L4.

### Full sequencing — Cycle 19 → Cycle 21 → Cycle 20

The overall roadmap (locked 2026-07-01):

**Phase 0. Complete Cycle 19 refactor hygiene.** In flight, near completion (task 8c per recent commits). Cycle 21a does not start until Cycle 19's remaining tasks land — otherwise refactor PRs collide with the `cgrid/src/` → `packages/kernel/src/` rename.

**Phase 1. Cycle 21a — monorepo scaffold.** Empty scaffolds for all 10 packages, turborepo pipeline, kernel move.

**Phase 2. Cycle 21b–i — feature absorption into packages.** Dependency-ordered:

1. **`@cgrid/expression`** — parser + compiler + evaluator + AST. Nothing else can start until this exists.
2. **`@cgrid/format`** — DSL parser, formatter templates. Depends on expression.
3. **`@cgrid/rules`** — rule engine + conditional styling + alerts core. Depends on expression, format.
4. **`@cgrid/calc`** — calculated columns + column overrides + column templates + aggregate registry + delta-aware aggregation. Depends on expression, format.
5. **`@cgrid/renderers`** — 40 rich cell renderers for financial blotters (numeric tick-aware, indicators, badges, bars, sparklines, composites). Depends on kernel, expression, format, calc, rules. Full spec: [cell renderer catalog](2026-07-01-canvasgrid-cell-renderer-catalog.md).
6. **`@cgrid/edit`** — edit journal + smart-edit + bulk-update. Depends on kernel.
7. **`@cgrid/export`** — Excel + CSV with visual formatting. Depends on kernel, calc, rules, format.
8. **`@cgrid/customizer`** — 20 panels + toolbars. Depends on everything.

Some can run in parallel once expression + format are up (rules + calc are peers; edit is independent). Renderers can partially start ahead of calc for the numeric/text/indicator/badge/action categories (~28 renderers); bars/gauges/sparklines/composites (~12 renderers) need calc + expression windowed data.

**Phase 3. Cycle 20 — `@cgrid/excel-pivot` implementation.** Lands *after* Phase 2 completes — depends on kernel + expression + format + calc + edit + export, all of which must be stable first. Running Cycle 20 in parallel with feature absorption would force constant rebases against changing dependencies. Foundation first, then Excel-native pivot on top.

Rough calendar estimate: 6–8 cycles across Phase 2, plus Cycle 20 as the capstone.

---

## 10. Open questions — all resolved (2026-07-01)

All eight questions closed in follow-up discussion this session.

**Q1. `cgrid` package name post-split.** No existing external consumers → direct rename. `cgrid/src/*` moves to `packages/kernel/src/*`; `cgrid/package.json` `"name": "cgrid"` becomes `"name": "@cgrid/kernel"`. No meta-package, no aliasing, no deprecation cycle. Cleanest option.

**Q2. Turborepo remote cache.** Local only for now. Vercel remote cache deferred — revisit if CI parallelism becomes a bottleneck or open-source contributors join.

**Q3. Composite cell design.** Resolved in §5: single-line only; ellipsis + hover tooltip on overflow; multi-format clipboard (`text/plain` + `text/html` rich run for Excel paste); non-editable (derived views).

**Q4. Aggregate scope defaults in grouped context.** Excel-native. `SUM([x])` in a grouped calculated column defaults to `scope: group`; grand-total row uses `scope: all`; parent-subtotal row uses `scope: parent`. Consistent with Excel pivot muscle memory.

**Q5. Percentile / MEDIAN approximation.** Hybrid strategy — sorted-array (exact, O(log n) delta) up to a per-scope threshold of ~10k rows; t-digest (approximate, bounded-memory, O(log n) delta) above that. Threshold configurable per-aggregate via `registerAggregate` options.

**Q6. Icon set governance.** Lucide bundled as default (shipped inside `@cgrid/kernel`'s icon registry); Phosphor available as opt-in registration via `grid.registerIconSet('phosphor', phosphorPaths)`.

**Q7. Cycle 19 / Cycle 20 sequencing.** Locked: Cycle 19 (refactor hygiene) must complete before Cycle 21a scaffold starts. Cycle 20 (Excel Pivot Grid implementation) lands *after* all Cycle 21 feature-absorption cycles complete — not in parallel. Full roadmap: Cycle 19 → Cycle 21a scaffold → Cycle 21b–i feature packages (including `@cgrid/renderers`) → Cycle 20 ExcelPivotGrid. See §9 Full sequencing.

**Q8. Selection / keyboard / clipboard package boundary.** Stays in `@cgrid/kernel`. Main-thread paint-adjacent concerns that never leave the grid substrate — no separate package.

---

## 11. Non-goals

Explicitly out of scope for Cycle 21:

- **Independent SemVer per package** — deferred until API stabilizes (post-full-feature-absorption).
- **Third-party plugin API** — not designed here. Public API of each package is the plugin surface, but a stable plugin manifest / loader is not shipped.
- **Alternative renderers** — no WebGL, no SVG-primary, no DOM-only mode. Canvas + Path2D icons + optional DOM overlays (future, if needed) is the paint model.
- **A universal AG-Grid compatibility layer** — column definitions and grid options match cgrid's native shape, not AG-Grid's. Wrapper-native semantics.
- **Server-side data model** — data lives in the browser (worker + main). Server-side row model, infinite scroll from server, etc. are future work.
- **Additional runtime targets** — no Node.js server-rendering, no React Native.

---

## Summary

Cycle 21 sets the intrinsic surface for cgrid to absorb the StarUI tooling as first-class features — not as add-ons requiring hooks. Nine packages under a turborepo scaffold, lockstep versioned, split before feature absorption to prevent retroactive layering. Expression evaluation, rule evaluation, format DSL parsing, and aggregate computation all live on the worker; main thread stays a pure painter. Path2D icons from Lucide give the sleek aesthetic without emoji/DOM tradeoffs. The unified formatting DSL layers Excel muscle memory (Tier 0), expressions (Tier 1), and composite fragments (Tier 2) into one language.

Roadmap: complete in-flight **Cycle 19** (refactor hygiene, task 8c) → **Cycle 21a** lands the empty scaffold for 10 packages → **Cycles 21b–i** absorb features into their packages in dependency order (expression → format → rules / calc / renderers / edit → export → customizer). The `@cgrid/renderers` package delivers 40 rich cell renderers for financial blotters — full spec in [cell renderer catalog](2026-07-01-canvasgrid-cell-renderer-catalog.md). Finally **Cycle 20** ExcelPivotGrid implementation lands into `@cgrid/excel-pivot` on top of the completed package layer.
