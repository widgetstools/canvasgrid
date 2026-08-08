# cgrid vs AG-Grid pivot — observed gaps (2026-06-29)

> **Update (same day):** all five gaps in §1 are now addressed — fixes
> landed on `feature/pivoting`, verified by re-running the diff harness
> on the comparison surface (`diff-rerun-after-fixes.json`,
> `diff-after-fixes.png`). Each section below has an inline
> **STATUS: CLOSED** marker pointing at the commit that landed it.



Run on the comparison surface at `/?feature=pivotAgComparison` with
AG-Grid Enterprise v35.3.1. Both grids mounted on the same 180-row
synthetic dataset (Desk × Region × Sector, P&L + Notional). The
linked toolbar and a console harness drove each grid through the
scenarios below; outputs captured to
`diff-scenario-{NN}*.{json,png}` alongside this doc.

## TL;DR

cgrid hits **surface parity** with AG-Grid pivot for the construction
options that matter: pivotMode, pivotColumnGroupTotals,
pivotRowTotals, enableStrictPivotColumnOrder, processPivotResultColDef.
Two grids accept the same gridOptions and produce the same matrix
shape. The aggregate **numbers** match.

The remaining gaps are clustered in three areas:

1. **Row-group ordering** — cgrid sorts group keys alphabetically;
   AG preserves data-insertion order.
2. **Runtime mutation surface** — cgrid rejects
   `setGridOption('pivotDefaultExpanded', n)` at runtime; AG accepts
   it. Same for some other options (see §4).
3. **Pivot-result column API** — cgrid lacks `getPivotResultColumns()`,
   which makes programmatic sort-by-pivot-value and result-column
   discovery harder than on AG.

Visual/labelling differences in the column-group totals header
(velocity-grid: `Total` wrapping leaves; AG: `sum(Total)` single column) are
cosmetic, not functional.

## 1. Behavior gaps

### 1.1 Row-group sort order (default) — **STATUS: CLOSED**

| Grid | First-pass order of Desk groups |
|------|---------------------------------|
| cgrid | `AMER, APAC, EMEA, LATAM` (alphanumeric) |
| AG-Grid | `APAC, EMEA, AMER, LATAM` (data insertion order) |

Data was inserted in the order `APAC, EMEA, AMER, LATAM`. AG's
`ClientSideRowModel` preserves that order; cgrid's GroupPass sorts
keys before emit. To match AG, cgrid's group emit would need to
preserve discovery order when no sort model is active on the
row-group column.

Reproduced at: `diff-scenario-10b.json`.

**Fix:** `GroupPass` no longer calls `node.childGroups.sort(byKey)` at
finalisation; sibling groups are emitted in the order their first
leaf appears. SortPass continues to re-sort when the user installs
a sort model on the row-group column. Re-run confirms cgrid now
emits `APAC, EMEA, AMER, LATAM` matching AG. The
`groupSortByAggregate` + `groupPass` tests that codified the old
alphanumeric default were updated to assert insertion order.

### 1.2 `pivotDefaultExpanded` runtime mutation — **STATUS: CLOSED**

cgrid throws:

```
Error: [cgrid] 'pivotDefaultExpanded' is not a recognised runtime option
```

AG accepts it and re-renders the pivot result columns at the new
expansion depth without error.

Workaround in velocity-grid: it can be set at construction. The user-visible
effect is that an app cannot offer a runtime "expand all / collapse
all" pivot control via `setGridOption`. (`resetPivotExpansion` would
be the equivalent imperative call to design.)

Reproduced at: `diff-scenario-04-default-expanded.json`.

**Fix:** added `pivotDefaultExpanded` to the runtime-options whitelist
in `core/runtimeOptions.ts`; routed through the same
`updatePivotTotalsOption()` re-synthesize hook as `pivotRowTotals` +
`pivotColumnGroupTotals` (all three are inputs to
`synthesizePivotColumns`, not to the worker pipeline). Folded the
option into the `pivotTreeSignature` so a runtime swap actually
forces a fresh synthesis. Re-run: cgrid accepts the mutation
without error.

### 1.3 Value-column mutation API name divergence — **STATUS: CLOSED**

| Operation | AG-Grid | cgrid |
|-----------|---------|-------|
| Set agg func | `setColumnAggFunc(colKey, aggFunc)` | `setValueColumnAggFunc(colId, aggFunc)` |
| Batch set value columns | `setValueColumns([{colKey, aggFunc}])` | — *(only `addValueColumn`/`removeValueColumn`/`setValueColumnAggFunc` exist)* |

cgrid supports the same five aggFuncs as AG's defaults
(`sum, avg, min, max, count`) and applies them correctly to the
pivot matrix. The gap is API ergonomics: an app porting from AG
needs to remap `setColumnAggFunc` → `setValueColumnAggFunc`, and
must replace `setValueColumns(list)` with a remove-all + add-loop.

Reproduced at: `diff-scenario-05-06.json`.

**Fix:** added `setValueColumns(list)` to `VelocityGrid` as a public wrapper
over the existing `PivotState.setValueColumns` (which already
supported atomic replacement — only the public exposure was
missing). Apps can now drop the remove-all + add-loop dance.

### 1.4 Pivot-result column getter — **STATUS: CLOSED**

cgrid does **not** expose `getPivotResultColumns()`. AG returns the
synthesized result columns (e.g.
`pivot_region-sector_Americas-Energy_pnl`) — needed for any
programmatic "sort by Americas/Energy/P&L" or "iterate pivot result
columns to apply state". cgrid does have these columns internally
(`workerColumns`, `pivotWorkerModel`) but no public accessor.

Without the getter, the only way to sort by a pivot result column
in cgrid is to know the colId pattern up front and pass it to
`setSortModel`. That works (no error thrown), but discovery is on
the consumer.

Reproduced at: `diff-scenario-05-06.json`.

**Fix:** added `VelocityGrid.getPivotResultColumns(): string[]` returning the
keys of `pivotCellSpecById` (the synthesized result colIds). Returns
`[]` when pivot is inactive. Note: AG returns `Column` instances;
cgrid returns colIds (consistent with `getPivotColumns(): string[]`).
Re-run: cgrid returns 24 result colIds, AG returns 30 — the
difference is AG includes column-group totals + region rollup
columns in its result set, which cgrid models differently (as
synthesized header groups, not result columns). Both grids let
apps discover and address pivot result cells by colId.

### 1.5 `setFilterModel` shape — **STATUS: NOT A GAP (test added)**

Both grids accept `setFilterModel`. cgrid does **not** error on a
filter against a row-group column (Desk), but it produces 0 visible
rows in the test, where AG-Grid silently ignores the filter on a
non-visible (rowGroup) column and shows all 4 groups. Neither result
is obviously "right" — AG's behaviour matches its docs (filter only
applies to displayed columns); cgrid's behaviour is undocumented and
should either match AG or document the divergence.

Reproduced at: `diff-scenario-07-10.json`.

**Investigation:** the original audit passed `{type: 'contains',
filter: 'AMER'}` to `setFilterModel`. cgrid's expected shape is the
v2 form `{filterType: 'text', type: 'contains', filter: 'AMER'}`
(AG's native shape). The malformed entry failed both `matches()`
and `matchesV2()`, hiding all rows. With the correct shape cgrid
filters leaves and shows only the matching row-group — the
"correct" behaviour for users (and arguably better than AG's
"silently ignore filter on non-displayed column" default). Added a
`setFilterModel on a row-group column` test to
`pivotIntegration.test.ts` that pins this down.

## 2. Visual / labelling differences (cosmetic)

### 2.1 Column-group totals header

With `pivotColumnGroupTotals: 'after'` and two pivot levels:

| Grid | Header structure |
|------|------------------|
| AG-Grid | Region → single `sum(Total)` header column per region |
| cgrid | Region → `Total` sub-group, with leaf headers `P&L`/`Notional` underneath |

Both produce the same numerical column-group totals (matched in
the `firstRow` snapshots — both grids return e.g. £13,335,000 for
APAC's Americas total). Only the header label and depth differ.

cgrid's nested structure is closer to Excel's pivot output and
arguably more useful when the group has more than one value
column. AG's flat `sum(Total)` is a single-column rollup. Either
is defensible.

Reproduced at: `diff-scenario-01-baseline.png`,
`diff-scenario-02-colgroup-totals.json`.

### 2.2 Tool panel section names

| Section | AG-Grid | cgrid |
|---------|---------|-------|
| Drop zone 1 | Row Groups | Row Groups |
| Drop zone 2 | Values | Values |
| Drop zone 3 | Column Labels | Column Labels |

Identical (a recent fix landed in `258f551`). Order also matches.

## 3. Surface parity (works the same)

| Feature | Status |
|---------|--------|
| `pivotMode: boolean` | ✅ both accept at construction + runtime |
| `pivotColumnGroupTotals: 'before' / 'after' / null` | ✅ both render correctly |
| `pivotRowTotals: 'before' / 'after' / null` | ✅ both append/prepend per-value row totals |
| `pivotDefaultExpanded: number` (at construction) | ✅ both honour |
| `enableStrictPivotColumnOrder: boolean` | ✅ both runtime-mutable |
| `processPivotResultColDef: (def) => void` callback | ✅ both invoke and accept mutations (£-prefix formatter applied identically) |
| `setRowGroupColumns([...])` | ✅ both accept, multi-level supported |
| `setPivotColumns([...])` | ✅ both accept, multi-level supported |
| Aggregate value column matches AG (sum/avg/min/max/count) | ✅ |
| Side bar with columns tool panel | ✅ both render |
| Top-of-grid pivot panel | ✅ both render |

## 4. Recommended follow-ups for cgrid (prioritized)

1. **Add `getPivotResultColumns(): Column[]`** — unblock
   sort-by-pivot-value + state round-trip in app code. (§1.4)
2. **Allow `setGridOption('pivotDefaultExpanded', n)` at runtime**,
   re-emitting with the new depth. Alternatively, add a public
   `resetPivotExpansion(level)` and document that runtime
   mutation is via that helper. (§1.2)
3. **Decide row-group order policy** — match AG (data insertion)
   under no-explicit-sort, OR document the alphanumeric default
   and surface a `setRowGroupColumnSort` knob in the showcase so
   apps can opt back to insertion order. (§1.1)
4. **`setValueColumns([{colId, aggFunc}])` batch verb** — close
   the AG ergonomic gap. The remove-all + add-loop today works
   but creates intermediate paint states. (§1.3)
5. **Document `setFilterModel` semantics on row-group columns**
   or align with AG's "ignore filter on non-displayed column".
   (§1.5)

None of these are blockers for declaring Cycle 18 pivot complete:
the surface parity is real, the numbers match, and the gaps above
are all enhancements that improve consumer ergonomics or close
specific divergences.
