# cgrid vs AG Grid Pivot — full gap analysis (2026-07-03)

Scope: cgrid's Cycle 18 AG-parity pivot (`@cgrid/kernel`, `pivotMode: true`)
versus AG Grid Enterprise v35 `PivotModule`, across **features, function,
behavior, look & feel, and UX**. Sources:

- Kernel source inventory (`core/pivotState|pivotEngine|pivotColumns.ts`,
  `worker/passes/pivotPass.ts`, `interaction/pivotPanel/*`,
  `interaction/toolPanels/*`).
- AG Grid v35 docs (ag-mcp) + `docs/catalog/11-pivoting.md`.
- Prior parity audit `2026-06-29-cgrid-vs-ag-pivot-gaps.md` (all 5 behavior
  gaps CLOSED on `feature/pivoting`; statuses re-checked today).
- Live side-by-side run today at `/?feature=pivotAgComparison`
  (AG Enterprise v35.3.1, 180-row Desk × Region × Sector dataset).

`@cgrid/excel-pivot` is an **empty scaffold** (Cycle 21a); Excel-native
capabilities (Show Values As, calculated fields, date hierarchies, item
filters, drill-through) are Cycle 20 scope and are *not* AG-parity gaps —
AG lacks them too. They are out of scope here.

---

## TL;DR

Core pivot parity with AG is **real and verified**: same construction
options, same matrix shape, matching aggregate numbers (re-confirmed today
including row totals). The remaining gaps cluster in five areas:

1. **Declarative config** — no `pivot`/`pivotIndex`/`aggFunc`-driven
   activation from colDefs; cgrid pivot is imperative-API-only.
2. **Result-column customization** — no `pivotComparator`, no
   `setPivotResultColumns`, `getPivotResultColumns()` returns colIds not
   column objects.
3. **Header/expansion semantics** — deliberate divergence: runtime role
   changes always re-open the tree fully (AG honours `pivotDefaultExpanded`);
   leaf headers omit the `sum(...)` agg prefix with no
   `suppressAggFuncInHeader` equivalent; no `suppressExpandablePivotGroups`.
4. **UX affordances** — no hover header menu (⋮) on pivot result columns
   (right-click context menu only); no per-chip agg picker on Values pills.
5. **Ecosystem integration** — no SSRM pivot, no integrated charts from
   pivot, pivoted Excel/CSV export unverified.

cgrid also has **superpowers AG lacks**: `pivotGrandTotals` (Excel-style
pinned grand-total row+column), worker-thread pivot recompute (ticking-data
friendly), nested `Total` sub-groups per column group, and sort-by-pivot-value
that reorders whole group levels.

---

## 1. Feature matrix

### 1.1 Grid options

| AG Grid v35 | cgrid | Status |
|---|---|---|
| `pivotMode` | `pivotMode` | ✅ parity (construction + runtime) |
| `pivotDefaultExpanded` | `pivotDefaultExpanded` | ⚠️ parity at construction; **diverges on runtime role change** (§3.1) |
| `pivotColumnGroupTotals: 'before'\|'after'` | same | ✅ parity (header shape differs, §4.2) |
| `pivotRowTotals: 'before'\|'after'` | same (+ `null`) | ✅ parity — numbers re-verified today |
| `pivotPanelShow: 'always'\|'onlyWhenPivoting'\|'never'` | same | ✅ parity |
| `pivotMaxGeneratedColumns` | same (default **5000**; AG default none/∞) | ⚠️ default differs; event name differs (§1.4) |
| `processPivotResultColDef` | same | ✅ parity (verified: formatter applied identically) |
| `processPivotResultColGroupDef` | same | ✅ parity — but cgrid does **not** forward the row-totals wrapper group |
| `enableStrictPivotColumnOrder` | same | ✅ parity |
| `pivotSuppressAutoColumn` | — | ❌ missing (mainly SSRM/viewport use case) |
| `suppressExpandablePivotGroups` | — | ❌ missing |
| `pivotHeaderHeight` / `pivotGroupHeaderHeight` | — | ❌ missing (regular header heights apply) |
| `suppressAggFuncInHeader` | — (always suppressed) | ⚠️ inverted default, no opt-out (§4.1) |
| `aggFuncs` (custom aggs) | `aggFuncs` via shared `AggFuncRegistry` | ✅ parity; cgrid also supports ordered fallback lists `['p99','avg']` |
| `grandTotalRow` | `grandTotalRow` + **`pivotGrandTotals`** | ✅ + cgrid-only superpower (§6) |

### 1.2 Column definition properties

| AG Grid v35 | cgrid | Status |
|---|---|---|
| `enablePivot` / `enableRowGroup` / `enableValue` | same | ✅ parity (gate drag-to-zone; API bypasses, same as AG) |
| `pivot: true` / `initialPivot` | `pivot` round-trips **opaquely** in ColumnState | ❌ **no declarative activation** — colDef `pivot:true` does not pivot the grid (§2.1) |
| `pivotIndex` / `initialPivotIndex` | round-trips opaquely | ❌ same as above |
| `aggFunc: 'sum'` on colDef | read as *default* agg when dropped into Values | ⚠️ partial — does not auto-add column to Values in pivot mode |
| `pivotComparator` | — (alphanumeric key order only) | ❌ missing (explicit TODO at `pivotPass.ts:449`) |
| `pivotValueColumn` etc. (result-col internals) | `cellSpecById` internal | ➖ different architecture, not consumer-visible |

### 1.3 API

| AG Grid v35 | cgrid | Status |
|---|---|---|
| `isPivotMode` | `isPivotMode` | ✅ |
| `setPivotColumns/addPivotColumns/removePivotColumns/getPivotColumns` | same (singular verbs `addPivotColumn` etc. + `movePivotColumn`) | ✅ minor naming drift; cgrid adds `move*` |
| `setValueColumns/addValueColumns/removeValueColumns/getValueColumns` | same incl. batch `setValueColumns` (closed 2026-06-29) | ✅ |
| `setColumnAggFunc` | `setValueColumnAggFunc` | ⚠️ name drift only |
| `getPivotResultColumns(): Column[]` | `getPivotResultColumns(): string[]` | ⚠️ colIds only — no column objects/metadata (§2.2) |
| `getPivotResultColumn(pivotKeys, valueCol)` | — (consumer must know `` colId encoding) | ❌ missing |
| `setPivotResultColumns(colDefs)` (custom secondary cols, SSRM) | — | ❌ missing |
| — | `movePivotColumn`, `moveValueColumn`, pivot-panel drag API (`resolveDragTargetRole`, `commitPivotPanelDrop`, cross-panel move) | ➕ cgrid-only |

### 1.4 Events

| AG Grid v35 | cgrid | Status |
|---|---|---|
| `columnPivotModeChanged`, `columnPivotChanged`, `columnValueChanged` (granular, with `source`) | single `pivotStateChanged` with `source: 'mode'\|'set'\|'add'\|'remove'\|'move'\|'aggFunc'\|'restore'` | ⚠️ consolidated — all info present, event names differ |
| `pivotMaxColumnsExceeded` | `pivotMaxColumnsReached` | ⚠️ name drift; payload `{generatedColumns, cap}` vs AG `{message}` — cgrid's is richer |
| `newColumnsLoaded` (secondary cols swapped) | — (implied by `pivotStateChanged` + column tree events) | ⚠️ no direct equivalent |

---

## 2. Function gaps (code-level, confirmed in source)

### 2.1 No declarative pivot from column defs
AG activates pivot from `columnDefs` alone (`pivot: true`, `pivotIndex`,
`aggFunc` + `pivotMode: true`). cgrid requires imperative setup
(`setPivotColumns`, `addValueColumn`, `setPivotMode`); `pivot`/`pivotIndex`
in ColumnState "round-trip opaquely" (`column.ts:628-629`). Apps porting AG
configs must translate declarative colDefs into API calls (exactly what the
comparison demo does). **Highest-leverage parity item remaining.**

### 2.2 Pivot result column addressing
- `getPivotResultColumns()` returns synthesized colIds (24 vs AG's 30 on the
  audit dataset — AG includes rollup/total columns as result columns; cgrid
  models those as header groups).
- No `getPivotResultColumn(pivotKeys, valueColKey)` lookup; consumers must
  reconstruct the `PIVOT_ID_SEP`-encoded colId.
- No `setPivotResultColumns()` — cannot inject custom secondary columns
  (AG's SSRM/advanced path).

### 2.3 No `pivotComparator`
Worker sorts each key-trie level with `alphanumericCompare` only
(`pivotPass.ts:472-482`). AG lets apps order pivot result columns
(e.g. month names Jan→Dec). Deferred with in-code TODO.

### 2.4 Aggregations
Built-ins `sum/avg/min/max/count/first/last` — matches AG's defaults
(AG's docs set: `sum,min,max,count,avg,first,last`). Custom `aggFuncs`
supported; shared registry with row-group aggregation, so pivot and
group totals can never disagree. **Parity, plus fallback-list extension.**

### 2.5 Filtering / transactions
- Filter interplay: pivot consumes the post-filter row set — parity.
  Row-group-column filter semantics divergence resolved 2026-06-29 (§1.5 of
  prior audit): cgrid filters leaves (arguably better than AG's silent
  ignore); pinned by `pivotIntegration.test.ts`.
- Data updates: AG demonstrates `applyTransaction` delta-updating the pivot
  (adding/removing result columns in place). cgrid re-runs the worker
  pipeline; `treeSignature` caching avoids column-tree churn when the key
  set is stable. Same observable outcome, different mechanism; cgrid's is
  the design intent for ticking data. No numeric divergence observed.

### 2.6 Row model coverage
AG pivots on CSRM **and** SSRM (server-side). cgrid is worker-CSRM only —
architectural scope decision, not a defect; matters only for
larger-than-client datasets.

### 2.7 Ecosystem integrations (unverified / missing)
- **Integrated charts** from pivoted data: AG yes; cgrid has renderer-level
  charts but no chart-from-pivot-selection.
- **Excel/CSV export of the pivoted view**: AG exports the pivot result
  structure. `@cgrid/export` exists but pivot-mode export has no demo/test
  coverage — *needs verification* before claiming either way.
- Aligned grids + pivot: unsupported in **both** (AG documents the
  restriction). Non-gap.

---

## 3. Behavior divergences (confirmed live today)

### 3.1 Expansion state after runtime role changes — deliberate divergence
With identical `pivotDefaultExpanded: 1`, the live comparison shows AG
rendering sector groups **collapsed** (chevron `>`, subtotal column shown)
while cgrid renders the tree **fully expanded**. Cause (`pivotEngine.ts:502-504`):
cgrid honours `pivotDefaultExpanded` only on *initial* synthesis; any
role mutation while pivot is active re-opens fully — documented in-code as
the user's cardinal principle ("every role mutation produces a fresh,
fully-visible matrix"). AG re-applies `pivotDefaultExpanded` on every
secondary-column regeneration.
**Consequence:** any demo/app that configures pivot via runtime API calls
(as both showcase demos do) never sees `pivotDefaultExpanded` take effect.
If AG-parity screenshots matter, either pre-seed pivot state at
construction or add an opt-in `respectDefaultExpandedOnRoleChange`.

### 3.2 Collapsed-group column subset
AG's closed pivot group shows its rollup/`columnGroupShow:'closed'` subset
(single `sum(...)` total column); cgrid's closed branch shows its promoted
group-total leaves wrapped in a `Total` sub-group with per-value leaf
headers. Same numbers, different column count and header depth when
collapsed (this is §2.1 of the prior audit, still open, still assessed
cosmetic-but-visible).

### 3.3 Row-group ordering, runtime `pivotDefaultExpanded`, batch value
columns, result-column getter, filter-model shape
All five closed on `feature/pivoting` (2026-06-29 audit) — re-confirmed
present in current source (`getPivotResultColumns` at `cgrid.ts:3191`,
insertion-order GroupPass, runtime whitelist entry, `setValueColumns`).

---

## 4. Look & feel (visual, from today's side-by-side)

| Aspect | AG Quartz (v35) | cgrid | Assessment |
|---|---|---|---|
| Value leaf headers | `sum(P&L)` — truncates to `sum…` at narrow widths | `P&L` (agg prefix always suppressed) | cgrid is cleaner at pivot widths and matches Excel; AG-parity apps lose the at-a-glance agg indicator. No `suppressAggFuncInHeader` toggle to opt back. |
| Group chevrons | right side of label (`Americas <`, `Energy >`) | left side, open state (`⌄ Americas`) | Both discoverable; cgrid matches its row-group chevron convention (internal consistency > AG mimicry). |
| Column-group totals header | flat single `sum(Total)` column | `Total` sub-group with per-value leaves | cgrid closer to Excel; more useful with ≥2 value columns; wider. |
| Empty canvas below last row | plain background | ruled filler rows (grid lines continue) | Deliberate Excel-like look; flag only if AG-parity pixel tests are ever added. |
| Number rendering | proportional font, ellipsis-truncates cell values at narrow widths (`£1,655,0…`) | tabular/monospace numerals, columns sized to content | cgrid materially more readable for financial data at identical pane sizes. |
| Header menu affordance | hover ⋮ on every result column + group | none (right-click context menu) | See UX §5.2. |
| Watermark | AG Enterprise watermark (unlicensed dev) | none | n/a |
| Theming | Theming API `themeQuartz.withParams` | `--cg-pivot-panel-*` tokens, pills reuse row-group chip tokens | Both fully themeable; cgrid pivot strip has dedicated tokens incl. drop accept/reject states. |

Visual-regression coverage: **zero pivot snapshots** in `e2e-visual`
(only renderer pages). Given three pivot demos exist, this is the cheapest
guard against look-and-feel drift.

## 5. UX

### 5.1 Parity achieved
- Split top strip (row groups left / column labels right with `›`
  separators), matching AG's v35 dual-zone panel design.
- Columns tool panel: Pivot Mode toggle, search, checkbox tree, Row Groups /
  Values / Column Labels drop zones — section names and order identical to
  AG (fixed `258f551`). Values pills labelled `sum(P&L)` like AG.
- Drag & drop: header→zone, zone↔zone (cross-panel move), within-zone
  reorder with insertion line, drop accept/reject outline. Zone hit-test
  priority pivot → values → row groups.
- Pivot-mode leaf-group header click is a no-op (regression-guarded), group
  rows suppress chevrons under pivot — both match AG.

### 5.2 Gaps
- **No hover header menu (⋮)** on pivot result columns. AG exposes
  agg/sort/pin/hide per result column from the header. cgrid's equivalents
  live in the right-click context menu (incl. "Value: Aggregate <col>"
  submenu with ✓ on the active agg) — functional parity, lower
  discoverability for AG-habituated users.
- **No per-chip agg picker** on Values pills (AG: click chip → agg
  dropdown). cgrid pills are label + ✕ only; changing agg requires the
  header context menu. Two-surface round-trip for a one-click AG flow.
- **No pivot-key value filtering UI** (which Excel offers on column labels
  and AG approximates via set filters on source columns): cgrid filters
  only via upstream row filters. Same as AG functionally, but AG's filters
  tool panel remains usable on source columns in pivot mode — cgrid's
  filters panel exists but pivot-mode behavior is untested/undocumented.

### 5.3 cgrid UX advantages
- **Keyboard support on pills**: `Cmd/Ctrl+←/→` reorder, `Delete` remove,
  `tabIndex=0` + `role="button"` + aria-labels. AG's drop-zone chips have
  weaker keyboard affordances.
- Optimistic Pivot Mode toggle (instant flip, then engine confirm).
- Drop verdict feedback (accept = focus ring / reject = amber outline) is
  more explicit than AG's.

---

## 6. cgrid-only superpowers (reverse gaps)

- **`pivotGrandTotals`** — Excel-style pinned bottom Grand Total row +
  pinned right Total column ("Total Result"); no AG equivalent
  (design doc `2026-06-29-pivot-grand-totals-design.md`).
- **Worker-thread pivot recompute** — pivot pass runs off-main-thread in
  the shared data pipeline; built for 60Hz ticking (Cycle 20 target). AG
  CSRM pivots on the main thread.
- **Sort-by-pivot-value semantics** — a pivot-result sort entry reorders
  each *group level* by the matching aggregate, row-total leaves sortable
  too, and takes precedence over regular sort entries.
- Ordered agg fallback lists (`['p99','avg']`).
- Richer cap event payload (`{generatedColumns, cap}`) and a safe bypass
  (primaries render) when the cap trips.

---

## 7. Prioritized recommendations

1. **Declarative pivot activation** (`pivot`, `pivotIndex`, auto-Value from
   `aggFunc` under `pivotMode`) — biggest remaining porting-friction item;
   also unlocks state round-trips that include pivot roles (`pivotMode` is
   deliberately excluded from `getColumnState` today).
2. **`pivotComparator`** — already TODO-marked at the exact insertion point
   (`pivotPass.ts:449`); unblocks month/weekday/custom orderings.
3. **Expansion-state policy switch** — keep the fully-open cardinal
   principle as default, add opt-in AG-compatible re-application of
   `pivotDefaultExpanded` on role changes (or a `resetPivotExpansion(depth)`
   escape hatch) so the comparison surface can actually match.
4. **Per-chip agg picker** on Values pills + hover ⋮ menu on result
   columns — closes the two visible UX discoverability gaps.
5. **Verify + demo pivot-mode export** (Excel/CSV of the pivoted view);
   add at least one **visual-regression snapshot** per pivot demo.
6. Nice-to-have parity stragglers: `suppressAggFuncInHeader`,
   `suppressExpandablePivotGroups`, `pivotHeaderHeight`/
   `pivotGroupHeaderHeight`, `getPivotResultColumn(pivotKeys, valueCol)`,
   `setPivotResultColumns`, granular AG-named event aliases.

Non-goals (documented architectural decisions, not gaps): SSRM pivot,
aligned-grids pivot (AG also unsupported), Excel-native pivot features
(Cycle 20 `ExcelPivotGrid` owns Show Values As, calculated fields, date
hierarchies, item filters, drill-through).
