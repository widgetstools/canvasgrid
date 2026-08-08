# Cycle 20 — Excel Pivot Grid (design brief)

**Status:** design discussion, not a task plan.
**Author:** Anand (via Claude)
**Date:** 2026-07-01
**Depends on:** Cycle 19 refactor hygiene (Sprint 0 + Tasks 1–8a shipped)
**Related plans:** [2026-06-28-canvasgrid-cycle-18-pivoting.md](2026-06-28-canvasgrid-cycle-18-pivoting.md) — historical reference only; Cycle 20 does NOT build on this pipeline (see §0).

---

## 0. Core principle — Excel-native, not AG-Grid-plus-extensions

**Locked in 2026-07-01.** `ExcelPivotGrid` must deliver the actual flexibility of Excel's pivot table. It must NOT be shaped by the existing cgrid pivot implementation (Cycle 18), which was deliberately built for AG-Grid parity and carries AG-shaped assumptions (single agg per value column at the API layer, hierarchical column tree as the primary output shape, no calculated fields, no item-level filters, no Show Values As transform layer, etc.).

**What this means concretely:**

- `@wellsfargo-starui/velocity-grid-excel-pivot` builds its own **Excel-native data model** from day one — `ExcelPivotCache`, `ExcelPivotModel`, `ExcelPivotEngine`, and a fresh Excel-native worker pipeline.
- **VelocityGrid becomes the rendering + interaction substrate**, not the pivot engine. ExcelPivotGrid feeds columns + rows into VelocityGrid via VelocityGrid's neutral public APIs (`setColumnTree`, `setRowData`, `applyTransaction`) — VelocityGrid renders, handles selection/editing/keyboard/scroll/theming as usual.
- The existing cgrid pivot (`PivotState`, `PivotEngine`, `PivotPass`, `PivotColumns`, the plz zone in the tool panel, the top-of-grid pivot strip) is **untouched**. Users who want AG-Grid-style pivots continue to use plain `VelocityGrid` with `pivotMode: true`; users who want Excel semantics use `ExcelPivotGrid`. Two independent code paths.
- New extension points on `VelocityGrid` are **only** things that are genuinely renderer-shaped and useful even without Excel: worker-pass registration, custom cell projection, transaction interceptor hook. If a hook is only useful to force-fit Excel semantics into cgrid's pivot, it's the wrong hook — we build it on the Excel side instead.

**Why this direction:** if the Excel engine builds on top of the cgrid pivot, every AG-shaped assumption in the cgrid pivot becomes an assumption we have to work around later. Excel's field model (rich per-field metadata: display name, base field/item, number format, subtotal function ≠ summary function, custom name, sort order, item filter set, calculated flag) is broader than what the cgrid pivot exposes. Building fresh means no unwinding later.

**Cost:** foundation cycle grows from ~4 weeks (delta-aware retrofit of existing PivotPass) to ~6–8 weeks (fresh Excel-native pipeline, delta-aware from day one). The ceiling gets much higher in return.

---

## 1. Problem framing

Two orthogonal asks, both landed in one prompt:

1. **Excel pivot feature parity** on top of the Cycle 18 pivot engine — the full "Show Values As" grid, calculated fields/items, date auto-hierarchy, per-field item filters, drill-through, etc.
2. **Real-time ticking** — pivot must stay correct under sustained `applyTransaction({ update })` traffic (financial ticking snapshot use case), not just batch loads.
3. **Sub-question:** should this ship as a new class `ExcelPivotGrid` that "extends" `VelocityGrid`, or as another architecture?

None of these are independent. Ticking constrains the algorithm choice for every Show-Values-As transform, calculated-field, and item-filter. The class shape decision constrains where the ticking logic lives.

**What's usable from VelocityGrid** (the substrate — everything under this is renderer/interaction/data-plumbing, not pivot logic):

- Row rendering, column rendering, header/footer bands, floating filters
- Selection (range + row), fill handle, clipboard, keyboard shortcuts
- Cell editing, cell renderers, cell-flash diff
- Column reorder / resize / pin / show-hide, virtualized scroll, sticky rows
- Worker pipeline plumbing: `applyTransaction({ add, update, remove })` primitive at [worker/dataPipeline.ts:789](../../../cgrid/src/worker/dataPipeline.ts#L789), the filter/sort/group pass registry, chunk protocol
- Tool panel host (right sidebar), status bar, context menu chrome, column drag router
- Column-state round-trip, save/restore

**What NOT to build on** (the existing cgrid pivot — historical reference only, ExcelPivotGrid does not use these):

- ~~[pivotPass.ts](../../../cgrid/src/worker/passes/pivotPass.ts), [pivotColumns.ts](../../../cgrid/src/core/pivotColumns.ts), [pivotEngine.ts](../../../cgrid/src/core/pivotEngine.ts)~~ — AG-Grid parity engine, kept for users of plain `VelocityGrid` with `pivotMode: true`.
- ~~PivotState, three-surface plz-zone sync, `pivotStateChanged` event~~ — same, AG-Grid-shaped.

We can still *read* the Cycle 18 code as reference for how the delta-aware key discovery + per-prefix aggregation problem was solved in this codebase. But the Excel engine ships its own equivalents, designed around Excel's field model.

**What's missing (broad categories, detail in §4):**

- Every non-trivial Excel value transform (Show Values As)
- Date auto-hierarchy, numeric binning, calculated fields/items, item filters, drill-through, layout modes, slicers, pivot charts
- Delta-aware pivot pipeline for ticking

---

## 2. Architecture — how does `ExcelPivotGrid` relate to `VelocityGrid`?

**Decision (locked 2026-07-01):** Composition + fresh Excel-native engine. `ExcelPivotGrid` owns a `VelocityGrid` instance and its own `ExcelPivotEngine`. VelocityGrid is the rendering substrate; the Excel engine drives every pivot-shaped decision. Section §0 covers the *why*; this section covers the *shape*.

The three options considered before landing here — subclass, composition-on-existing-pivot, feature-flags — are preserved below for record.

### Option A — subclass (`class ExcelPivotGrid extends VelocityGrid`)

```ts
class ExcelPivotGrid<TRow> extends VelocityGrid<TRow> {
  private excelExtensions: ExcelExtensions<TRow>;
  constructor(container, options) {
    super(container, options);
    this.excelExtensions = new ExcelExtensions(this);
  }
  addCalculatedField(spec: CalculatedFieldSpec) { ... }
  setShowValuesAs(colId, mode) { ... }
  // etc.
}
```

**Pros:**
- Familiar OO shape. `new ExcelPivotGrid(...)` is a drop-in for `new VelocityGrid(...)`.
- All Excel-only surface area on one class = easy to find.

**Cons:**
- Fights the Cycle 19 direction. Cycle 19 spent 5 tasks *extracting* things out of `velocityGrid.ts` into coordinators (`WorkerCoordinator`, `ViewportManager`, `PivotEngine`, `ColumnStateManager`, `GroupingCoordinator`, `EditController`). Adding a subclass reverses that trend by piling behavior onto the leaf class instead of onto the graph of coordinators the leaf class already owns.
- Subclass can't cleanly reach into worker-side pipeline. The pivot engine has two halves: main-thread [pivotEngine.ts](../../../cgrid/src/core/pivotEngine.ts) and worker-side [pivotPass.ts](../../../cgrid/src/worker/passes/pivotPass.ts). A subclass has no natural way to add a `CalculatedFieldsPass` to the worker pipeline — you'd need a factory hook on `VelocityGrid` for that anyway, at which point the subclass is redundant.
- Type gymnastics: every method on `VelocityGrid` that returns `this` or takes generic `TRow` needs recheck under the subclass.
- Testing: every Excel test now has to spin up a full `VelocityGrid`. There's no way to unit-test the Excel-specific transforms without a canvas + worker.

### Option B — composition (`ExcelPivotGrid` wraps `VelocityGrid`) — **recommended**

```ts
class ExcelPivotGrid<TRow> {
  private grid: VelocityGrid<TRow>;
  private calculatedFields: CalculatedFieldsRegistry<TRow>;
  private valueTransforms: ValueTransformsRegistry;
  private dateHierarchies: DateHierarchyRegistry;
  private itemFilters: PivotItemFilterState;
  // ...

  constructor(container, options: ExcelPivotGridOptions<TRow>) {
    // 1. translate Excel-shaped options into VelocityGrid options + extension registries
    const cgridOptions = this.buildVelocityGridOptions(options);
    this.grid = new VelocityGrid(container, cgridOptions);
    // 2. install extensions via the extension-point hooks VelocityGrid already exposes
    //    (aggFuncs, processPivotResultColDef, transaction interceptors, etc.)
  }

  // Excel-only public API
  addCalculatedField(spec: CalculatedFieldSpec) { ... }
  setShowValuesAs(colId, mode: ShowValuesAsMode) { ... }
  addDateHierarchy(fieldId, granularities: DateGranularity[]) { ... }

  // Passthrough VelocityGrid API — either explicit forwarding for the ~30 methods
  //   we want as public, or `Object.assign(this, this.grid.api)` in ctor.
  get api() { return this.grid.api; }
}
```

**Pros:**
- Matches Cycle 19's trajectory. Extensions are just more coordinators.
- Excel-specific worker passes register via a `VelocityGrid` extension point (see §3.2), not inheritance. That extension point is generally useful even without Excel (custom AggFuncs already use one).
- Each Excel feature (calculated fields, value transforms, date hierarchies, item filters) is a self-contained module with its own unit-tests, no canvas needed.
- Clean surface separation. `VelocityGrid` stays the general-purpose grid; `ExcelPivotGrid` is the Excel-flavored preset. Anyone who wants only *some* Excel features can install just those extensions on plain `VelocityGrid`.

**Cons:**
- Requires opening up two or three extension points on `VelocityGrid` (see §3.2) — a small refactor cost, but they'd be useful anyway.
- Passthrough boilerplate for the ~30 methods we want re-exposed. Mitigate with a `get api()` accessor + a fluent facade.

### Option C — feature flags on `VelocityGrid` (`new VelocityGrid({ excelPivot: true, calculatedFields: [...] })`)

**Pros:** no new class.
**Cons:** bloats `VelocityGrid` with Excel-specific concerns most users don't want; every Excel feature increases tree-shake weight for non-Excel users; violates the Cycle 19 direction more thoroughly than Option A does.

### Chosen: Option B, with a fresh Excel-native engine (per §0)

**Package layout — `@wellsfargo-starui/velocity-grid-excel-pivot`, sibling to `cgrid`:**

```
cgrid/                                   (unchanged — general-purpose grid + AG-parity pivot)
excel-pivot/                             (NEW PACKAGE — @wellsfargo-starui/velocity-grid-excel-pivot)
├── src/
│   ├── excelPivotGrid.ts                (facade: owns VelocityGrid + ExcelPivotEngine)
│   │
│   ├── model/                           ── EXCEL DATA MODEL ──
│   │   ├── excelPivotCache.ts           (normalized source view + derived-value shadow buffer)
│   │   ├── excelPivotModel.ts           (fields, axes, filters, layout — Excel-shape)
│   │   ├── excelPivotField.ts           (rich per-field metadata: display name, base field/item,
│   │   │                                 number format, subtotal fn ≠ summary fn, custom sort,
│   │   │                                 item filter set, calculated flag)
│   │   └── excelPivotItem.ts            (per-value item metadata: visible, custom label, order)
│   │
│   ├── engine/                          ── ORCHESTRATION ──
│   │   ├── excelPivotEngine.ts          (main-thread; subscribes to VelocityGrid transactions;
│   │   │                                 pushes columns + rows back into VelocityGrid)
│   │   ├── deltaCoalescer.ts            (tick-batch coalescing, RAF-debounced applyColumnTree)
│   │   └── excelPivotState.ts           (save/restore state for the Excel model)
│   │
│   ├── worker/                          ── EXCEL-NATIVE WORKER PIPELINE ──
│   │   ├── excelPivotPipeline.ts        (filter → group → aggregate → transform → layout)
│   │   ├── passes/
│   │   │   ├── filterPass.ts            (item-level filters, top-N)
│   │   │   ├── groupPass.ts             (row + col axis grouping; delta-aware from day one)
│   │   │   ├── aggregatePass.ts         (multi-agg per field; deltaApply protocol)
│   │   │   ├── transformPass.ts         (Show Values As — 14 modes)
│   │   │   └── layoutPass.ts            (Compact / Outline / Tabular)
│   │   ├── state/
│   │   │   ├── axisState.ts             (Fenwick per axis for running totals)
│   │   │   ├── rankState.ts             (sorted multiset per group for ranks)
│   │   │   └── aggState.ts              (per-cell agg state: sum, count, min-bucket, etc.)
│   │   └── protocol.ts                  (worker msgs)
│   │
│   ├── calculatedFields/
│   │   ├── formulaParser.ts             (see §6 Q5 — language TBD)
│   │   ├── depGraph.ts                  (row-level dependency tracking)
│   │   ├── evaluator.ts
│   │   └── shadowBuffer.ts              (per-row derived values)
│   │
│   ├── calculatedItems/                 (Tier 3, later)
│   ├── dateHierarchy/
│   │   ├── granularities.ts             (year/quarter/month/day/hour/…)
│   │   └── hierarchyField.ts            (first-class field type, not synthesized columns)
│   ├── numericBinning/
│   ├── itemFilter/                      (label/value/top-N per pivot field)
│   ├── layoutModes/                     (Compact / Outline / Tabular)
│   ├── drillThrough/
│   ├── conditionalFormatting/
│   ├── slicers/                         (Tier 3)
│   ├── timelines/                       (Tier 3)
│   │
│   ├── ui/                              ── EXCEL-SHAPED UI (drives ExcelPivotEngine, NOT the cgrid plz zone) ──
│   │   ├── fieldList.ts                 (Excel-style Field List panel)
│   │   ├── valueFieldSettings.ts        (dialog: summarize / show values as / number format)
│   │   ├── itemFilterDropdown.ts        (per-field header dropdown)
│   │   └── pivotContextMenu.ts          (Excel-shaped context menu, not cgrid's)
│   │
│   └── cgridBridge/                     ── THE ONLY COUPLING TO VelocityGrid ──
│       ├── columnTreeAdapter.ts         (Excel columns → VelocityGrid CColGroupDef tree)
│       ├── cellValueAdapter.ts          (Excel cell lookup → VelocityGrid cellSpec / cellAt)
│       └── transactionListener.ts       (VelocityGrid applyTransaction → Excel cache updates)
│
├── test/
└── package.json                         (peerDependency: cgrid)
```

**The bridge is small and clearly named** — everything else in the package is Excel-native.

---

## 3. Real-time ticking — the constraint that reshapes everything

### 3.1 What "ticking" means for pivot correctness

Users of this grid will (per the financial snapshot use case) fire `applyTransaction({ update: [...] })` at potentially 60Hz on 50k–500k row datasets, mostly touching numeric fields. Under pivot mode, every tick must:

1. **Update affected aggregates only** — a sum tick shouldn't re-scan the dataset
2. **Preserve column tree stability** — no reflow flash unless a genuinely new pivot key appears
3. **Preserve scroll + focus + selection** — ticks are not user actions
4. **Flash-highlight changed cells** — cell-flash already exists for regular cells; extend to synthesized pivot cells
5. **Stay under the frame budget** — ~10ms per tick batch at 60Hz for interactive feel

Today, PivotPass re-runs single-scan discovery + full aggregation on every transaction. That's fine at low tick rates on small datasets, but it will not hold up at target rates.

### 3.2 Delta-aware pivot pipeline — Excel-native from day one

The Excel-native worker pipeline (`excel-pivot/src/worker/excelPivotPipeline.ts`) is designed for delta from the start — not retrofitted. Each pass has both a `batch(input)` and a `delta(input, tick)` method:

```
TickBatch = {
  updates:  Array<{ rowIdx, field, oldValue, newValue }>
  adds:     Array<TRow>                    // for add case
  removes:  Array<rowIdx>                  // for remove case
}
```

**Per aggregation, the incremental update:**

| AggFunc | Delta-friendly? | State needed per (rowGroup × pivotPath) | Notes |
|---|---|---|---|
| `sum` | ✅ trivial | `sum` | `sum += (new − old)` |
| `count` | ✅ trivial | `count` | `count += (isDefined(new)?1:0) − (isDefined(old)?1:0)` |
| `avg` | ✅ trivial | `sum, count` | reuse `sum` + `count` |
| `min` | ⚠️ conditional | `min` + full value list OR bucket | trivial if `new ≤ oldMin`; if the tick moves `oldMin` upward, need to rescan the bucket |
| `max` | ⚠️ conditional | `max` + full value list OR bucket | symmetric to `min` |
| `first` | ✅ trivial | `first` | ignore updates unless row 0 changed |
| `last` | ⚠️ full-rescan if the "last" row is not fixed | | |
| custom | depends | user-defined | need a `deltaApply?` optional method on `AggFunc` |

**Design:** add optional `deltaApply(agg, tick): AggState` to `AggFuncRegistry` alongside the existing batch `apply`. Aggregations without a `deltaApply` fall back to full-rescan of the affected bucket — bounded to the affected `(rowGroup × pivotPath)` cell, not the whole dataset.

**Pivot key discovery under ticks:**

- **Update** on a *pivot-column* field: previous key `k1` → new key `k2`.
  - If `k1` still has other rows: leave `k1` in the tree, decrement its bucket, add row to `k2`'s bucket (which may create `k2`).
  - If `k1`'s bucket empties: leave the key in the tree under non-strict mode (already Cycle 18 behavior), only drop it if the user explicitly clears history. (Or add a `pivotKeyRetention: 'sticky' | 'gc'` option.)
- **Add**: fold into the trie, standard.
- **Remove**: decrement all affected buckets; GC empty ones per retention policy.

**Column-tree stability:** if the delta *creates* a new pivot key, that requires a column-tree rebuild (main-thread `applyPivotColumns`). Debounce these — coalesce all new-key events within a tick-batch window into one `applyPivotColumns` call. Existing-key ticks skip the rebuild entirely.

### 3.3 Show Values As under ticking — the hard part

The 14 Show-Values-As modes vary in delta-friendliness:

| Mode | Delta cost | Notes |
|---|---|---|
| `% of Grand Total` | O(1) per tick | denominator = grand total (already tracked); numerator per cell (already tracked) |
| `% of Row/Col Total` | O(1) per tick | same |
| `% of Parent Row/Col` | O(1) per tick | same |
| `Difference From (base cell)` | O(1) per tick | one lookup |
| `% Difference From` | O(1) per tick | same |
| `Running Total in Field` | ⚠️ O(k) per tick | a tick to cell `i` invalidates cells `i+1..n` in the row/col — need to re-scan the tail. Or store partial sums in a Fenwick tree per axis for O(log n) updates. |
| `% Running Total` | ⚠️ same as running total | |
| `Rank Smallest/Largest` | ⚠️ O(log n) per tick with a sorted structure per group; O(n) naive | need a sorted multiset per pivot group |
| `Index` (Excel's `(value × grandTotal) / (rowTotal × colTotal)`) | O(1) per tick | all four operands already tracked |

**Design:** each Show-Values-As mode is a module implementing:

```ts
interface ValueTransformMode {
  name: string;
  requiresState: 'none' | 'axis-partial-sums' | 'per-group-sorted';
  batchCompute(pivotCells, ctx): PivotCells;
  deltaCompute?(pivotCells, tick, ctx): AffectedCells;   // optional; else full-recompute
}
```

Only Running Total and Rank need heavy state. All others are pointwise transforms over cells the batch pass already produced.

### 3.4 Calculated fields under ticking

Calculated fields = user formulas over source rows (e.g. `Margin = (Revenue − Cost) / Revenue`) that become new value columns.

**Design:**
- Formula parser produces AST + `Set<sourceFieldId>` (dependencies).
- On tick, if the tick's `field ∈ deps`, recompute the derived field for that row *before* the pivot pass sees it.
- Store per-row derived values in a shadow buffer keyed by rowIdx.
- Aggregation over the derived field then goes through the normal `sum`/`avg` delta path.

**Calculated items** (formulas over specific pivot items, e.g. `"West Coast" = SF + LA + Seattle`) are strictly harder because they invent virtual pivot keys that don't exist in the source. Design deferred; probably a whole cycle on its own.

### 3.5 Rendering under ticks

- Reuse existing cell-flash: [worker/dataPipeline.ts:789](../../../cgrid/src/worker/dataPipeline.ts#L789) already emits diffs. Extend the diff to include synthesized pivot cells (map from `(rowGroup, pivotPath, valueColId) → cellId`).
- Debounce main-thread `applyPivotColumns` calls to one per animation frame max.
- Never rebuild the column tree during a tick if no new keys appeared.

---

## 4. Feature scope (updated for ticking cost)

Estimates are engineering-days, assuming 1 focused engineer + existing test discipline (Cycle 18 shipped ~2074 tests; expect similar density per feature).

Each estimate has two numbers: **[batch] → [batch + delta-aware]**. The delta adder is the real cost of "must handle ticking."

### Tier 1 — engine gaps (short/medium features)

| Feature | Batch | +Ticking | Notes |
|---|---|---|---|
| Date auto-hierarchy (Y/Q/M/D/H) | 6d | +3d | Key encoder + header rendering + item filter integration |
| Numeric binning | 4d | +2d | Auto-bin ranges; user override |
| Per-level subtotal show/hide | 3d | +1d | Toggle existing pivotColumnGroupTotals per depth |
| Grand totals row/col independent toggles | 2d | +1d | Split current `pivotRowTotals` into 2 options |
| Report layout: Compact/Outline/Tabular | 5d | 0 | Pure rendering variant; no delta impact |
| Repeat item labels (Tabular) | 2d | 0 | Rendering |
| `pivotComparator` per colDef | 2d | 0 | Deferred from Cycle 18 / Task 8c |
| Manual pivot-item sort order | 3d | 0 | New state on PivotState |
| "Expand/collapse entire field" API | 2d | 0 | New verb on PivotEngine |
| Empty-cell / error display options | 1d | 0 | Cosmetic |
| Plural APIs + `getPivotResultColumn(s)` | 1d | 0 | Deferred from Cycle 18 / Task 9 |

**Tier 1 subtotal:** ~31 days batch + ~7 days delta = **~38 dev-days (~7–8 weeks)**

### Tier 2 — sizable features (each 1–3 weeks)

| Feature | Batch | +Ticking | Notes |
|---|---|---|---|
| Show Values As (14 modes) | 10d | +8d | Delta cost varies per mode (§3.3); Running Total + Rank are the hard ones |
| Item filter per pivot field | 8d | +2d | Label/value/top-N; independent from source column filter |
| Top N / Bottom N value filter | 4d | +2d | Subset of Show Values As |
| Drill-through / Show Details | 5d | +1d | Modal/table with source rows |
| Multiple simultaneous subtotal aggregations per group | 5d | +2d | e.g. show sum AND avg AND count together |
| Conditional formatting engine | 10d | +2d | Data bars / color scales / icon sets; rule engine |

**Tier 2 subtotal:** ~42 days batch + ~17 days delta = **~59 dev-days (~12 weeks)**

### Tier 3 — new subsystems (each a whole cycle)

| Feature | Batch | +Ticking | Notes |
|---|---|---|---|
| Calculated Fields | 15d | +5d | Formula parser + dep graph + shadow buffer + worker eval |
| Calculated Items | 20d | +10d | Virtual pivot keys; strictly harder than fields |
| Group Selected Items | 10d | +3d | Ad-hoc user groups; new PivotState surface |
| Slicers | 15d | +2d | New UI surface, separate from grid chrome |
| Timelines | 8d | +2d | Date-flavored slicer |
| Pivot Charts | 25d | +5d | Chart engine + bidirectional linkage; or integrate a chart lib and shave 15d |

**Tier 3 subtotal:** ~93 days batch + ~27 days delta = **~120 dev-days (~24 weeks)**

### Cross-cutting: delta-aware pipeline foundation

Not tied to any feature — has to happen before any of the above ticks correctly.

- Delta-aware PivotPass with per-agg incremental update: **8d**
- `deltaApply` on AggFuncRegistry + built-in fallback: **3d**
- Tick-batch coalescing + `applyPivotColumns` debouncer: **3d**
- Pivot cell-flash wiring: **2d**
- Perf harness + regression tests at 60Hz × 50k rows: **4d**

**Foundation subtotal: ~20 dev-days (~4 weeks)** — this is Cycle 20 itself, before feature work starts.

### Totals by target quality bar

| Target | Scope | Effort |
|---|---|---|
| **Ticking-safe foundation only** | Just §3 foundation, no new features | ~4 weeks |
| **"Credible Excel-alternative engine"** | Foundation + Tier 1 | ~11–12 weeks (~3 months) |
| **"Excel-competitive minus Excel-only chrome"** | + Tier 2 | ~23–24 weeks (~5–6 months) |
| **"Excel parity minus charts/slicers"** | + Tier 3 minus charts/slicers/timelines | ~40 weeks (~9–10 months) |
| **"Full Excel parity"** | Everything | ~48 weeks (~11–12 months) |

Order-of-magnitude sanity check: Cycle 18 shipped a substantial pivot engine in ~2 weeks (nine tasks, one engineer, ~2074 tests). Tier 1 and Tier 2 features are each 0.3–1 Cycle-18-equivalents. Tier 3 items are each 1–2 Cycle-18-equivalents.

---

## 5. Recommended multi-cycle path

Phased so that each cycle delivers user-visible value on its own, and so that ticking correctness lands *before* features that depend on it.

### Cycle 20 — Excel-native pivot foundation (fresh engine, not a retrofit)

- New package `@wellsfargo-starui/velocity-grid-excel-pivot` (peerDep cgrid), sibling to `cgrid/`
- **Data model:** `ExcelPivotCache`, `ExcelPivotModel`, `ExcelPivotField`, `ExcelPivotItem` — Excel's real field model (rich per-field/per-item metadata)
- **Engine:** `ExcelPivotEngine` (main-thread), subscribes to VelocityGrid's `applyTransaction`, translates to Excel-model updates
- **Extension points on VelocityGrid** (minimum viable — only what's genuinely renderer-shaped): worker-pass registration; custom cell projection (`cellAt` override); transaction interceptor hook. Each is generally useful even without Excel.
- **Worker pipeline** (Excel-native, delta-aware from day one): `filterPass` + `groupPass` + `aggregatePass` — Show Values As transforms + layout modes come in Cycle 22
- **Delta protocol:** each pass has `batch(input)` and `delta(input, tick)` methods; `aggregatePass` supports a `deltaApply` protocol on `AggregatorRegistry` (Excel-namespaced, independent of cgrid's `AggFuncRegistry`)
- **cgridBridge:** `columnTreeAdapter`, `cellValueAdapter`, `transactionListener` — the ONLY files that touch cgrid internals
- **Facade:** `ExcelPivotGrid` class, minimum viable public API — set rows/columns/values/filters axes, get/set aggregation, save/restore
- **Perf harness:** 60Hz × 50k rows regression gate (batch cell-flash under sustained ticking; column tree stable when no new keys; new-key debouncing)
- **Ship criterion:** ExcelPivotGrid renders a real Excel-shaped pivot end-to-end with a subset of features (row/col/value axes + sum/count/avg + item filter stub); perf gate green; the existing cgrid pivot (Cycle 18) is untouched and its tests still green.

**Estimate: 6–8 weeks** (up from 4 — the fresh Excel-native engine costs more upfront but the ceiling is much higher)

### Cycle 21 — Tier 1 engine gaps

- Date auto-hierarchy (highest-ROI single feature per user visibility)
- Numeric binning
- Report layout modes + repeat item labels
- `pivotComparator`, manual sort order, entire-field expand/collapse
- Grand-total independent axis toggles, empty-cell display, plural APIs

**Estimate: 8 weeks** (7 shipped batch + 1 delta hardening)

### Cycle 22 — Show Values As

- All 14 modes as delta-aware ValueTransform modules
- Item filter per pivot field
- Top N / Bottom N

**Estimate: 6–8 weeks**

### Cycle 23 — Calculated Fields + conditional formatting

- Formula parser + evaluator + dep graph
- Shadow buffer for derived values
- CF rule engine (data bars, color scales, icon sets)
- Drill-through

**Estimate: 8–10 weeks**

### Cycle 24+ — Calculated Items / Slicers / Charts (defer until user signal justifies)

Each is a full cycle. Slicers and Charts have the largest surface area and the least algorithmic depth; Calculated Items is the opposite.

**Total to Cycle 23:** ~26–30 weeks (~6–7 months) to reach "Excel-competitive minus slicers, calc items, and charts."

---

## 6. Open questions for the user

**Q1 — Is `ExcelPivotGrid` its own package, or a subtree inside cgrid?**
- Separate package (`@wellsfargo-starui/velocity-grid-excel-pivot`) means clean opt-in, no tree-shake weight for non-Excel users, own version cadence.
- Same tree means one build, one test suite, easier internal refactor. Given the Cycle 19 trajectory, same tree is probably simpler until package-level customer demand appears.

**Q2 — What's the realistic tick rate + row-count target?**
- 60Hz × 50k rows is what I've assumed. If it's 1Hz × 1M, the algorithm choices change (batch-per-second is fine; no Fenwick tree needed). If it's 60Hz × 500k, more state-heavy structures are required.

**Q3 — Pivot key retention policy on delete?**
- Non-strict mode today keeps keys that once appeared (stable column order). Under sustained ticking with occasional row drops, does the user want empty keys GC'd, or sticky?

**Q4 — Which subset of Show Values As is truly must-have?**
- `% of Grand/Row/Col Total` and `Running Total` are the two most-used in Excel. If those + Rank are enough, that's ~4d instead of 10d for the initial Tier 2 slice.

**Q5 — Calculated Fields formula language: Excel-syntax or JS expressions?**
- Excel-syntax matches user muscle memory but requires a bigger parser (cell refs, ranges, 300+ functions).
- JS expressions (`row.revenue - row.cost`) are 1/10 the work but require the user to write code, not spreadsheet formulas.
- A middle option: a small DSL supporting arithmetic + a fixed function library (SUM/AVG/IF/AND/OR/etc.) — ~20 functions covers 90% of real-world calculated fields.

**Q6 — Slicers + Pivot Charts: in scope for cgrid, or out?**
- Both are large. Charts especially — that's a chart engine, not a grid feature. Consider integrating a chart lib (e.g. bundled Highcharts equivalent) rather than building from scratch, which would drop Charts from 25d to ~10d integration work.

---

## 7. Decisions needed before Cycle 20 kickoff

**Locked in 2026-07-01:**

1. ✅ **Architecture:** Option B — composition. `ExcelPivotGrid` owns a `VelocityGrid` instance, not a subclass.
2. ✅ **Package layout:** new package `@wellsfargo-starui/velocity-grid-excel-pivot` (separate from `cgrid`). Own build, own test suite, tree-shakeable for users who don't need Excel features.
3. ✅ **Tick target:** **60Hz × 50k rows.** Requires Fenwick tree for Running Total, sorted multiset for Rank. Baseline for the Cycle 20 perf harness regression gate.
4. ✅ **Retention policy:** **sticky.** Empty pivot keys stay in the column tree; layout never shifts under ticking. Match current non-strict mode behavior. (If unbounded growth becomes a real issue later, consider adding a `pivotKeyGC: 'on-idle' | 'never'` opt-in — not blocking for Cycle 20.)
5. ✅ **Excel-native, not AG-Grid-plus-extensions** (see §0). Fresh Excel-shape data model + fresh worker pipeline. Existing cgrid pivot (Cycle 18) untouched; ExcelPivotGrid does not inherit its assumptions. Foundation cost grows from ~4 weeks to ~6–8 weeks; ceiling gets much higher.

**Still open (lower priority — can decide during Cycle 22 kickoff):**

- Which Show Values As modes are must-have? (§6 Q4)
- Calculated Fields formula language: Excel-syntax / JS / mid-DSL? (§6 Q5)
- Slicers + Pivot Charts scope? (§6 Q6)

**Next step:** implementation plan for Cycle 20 (foundation-only cycle). Should specify the extension points needed on `VelocityGrid`, the delta-aware PivotPass design, the `deltaApply` protocol for AggFuncRegistry, the perf harness spec, and the `ExcelPivotGrid` facade class shape.
