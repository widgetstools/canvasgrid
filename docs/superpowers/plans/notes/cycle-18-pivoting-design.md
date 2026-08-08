# Cycle 18 — Pivoting — Design Notes

> Living document. Each task in this cycle appends its design-pass output
> here so Task N+1 inherits the vocabulary. Cite this file in every
> commit message for a UI task in this cycle.

**Source plan:** `docs/superpowers/plans/2026-06-24-canvasgrid-feature-parity.md` § Cycle 18
**FM coverage:** Area 11 — ~40 of 42 rows
**Depends on:** Cycle 15 (row grouping), Cycle 14 (aggregation), Cycle 4 (column groups via `HeaderGroupSubgrid`)

---

## Mental model: pivot = grouping × aggregation × column synthesis

Pivot mode takes three inputs:

1. **`rowGroupCols`** — which columns become the ROW dimension
   (the existing Cycle 15 grouping axis).
2. **`pivotCols`** — which columns' distinct values become COLUMN
   headers.
3. **`aggCols`** — which columns get measured per
   (rowGroup × pivotValue) intersection.

…and synthesizes a NEW column tree where each leaf column is
`<pivotValue>_<aggFunc>_<aggCol>` (e.g.
`Sector_TECH_sum_PnL`). The CELL VALUES are the cross-tab
aggregates.

```
Row dim:   [Region, Desk]      (existing rowGroupCols)
Pivot dim: [Sector]            (new pivotCols)
Agg:       [Sum(PnL), Avg(Q)]  (existing aggCols)

         ┌─ Sector=TECH ──┐  ┌─ Sector=FIN ───┐
         │ Sum(PnL) Avg(Q)│  │ Sum(PnL) Avg(Q)│
─────────┼────────────────┼──┼────────────────┤
EMEA      │  1.2M    32.4  │  │  500K    18.9  │
  London  │  720K    28.1  │  │  300K    19.4  │
  Paris   │  480K    36.7  │  │  200K    18.4  │
APAC      │  ...           │  │   ...          │
```

The synthesized column tree slots into Cycle 4's
`HeaderGroupSubgrid` — pivot levels ARE column-group levels. No
new header rendering machinery is needed.

---

## Task 1 — `PivotPass` on worker

**Goal:** New pipeline stage that runs AFTER `GroupPass` (Cycle 15)
and BEFORE the chunk is sent to the main thread. Takes:

- `groupedRows: GroupPassOutput` (rows already bucketed by
  `rowGroupCols`).
- `pivotColIds: string[]` (the pivot dimensions, in order).
- `aggCols: { colId: string; aggFunc: string }[]`.

…and produces:

```typescript
interface PivotPassOutput {
  // The synthesized column tree (becomes column-groups via Cycle 4).
  pivotColumnTree: CColGroupDef[];
  // Per-(groupKey × pivotKey × aggCol) measured values.
  // Keyed: `${groupKey}::${pivotKey}::${aggCol}` → number.
  pivotValues: Map<string, number>;
  // Distinct pivot keys discovered (for column synthesis).
  pivotKeysByLevel: string[][];
}
```

**Algorithm:** One pass over the leaves of every group bucket. For
each leaf, derive its pivotKey = `[pivotCol1.value, …,
pivotColN.value]`. Accumulate into `pivotValues[groupKey, pivotKey,
aggCol]` via the agg function (sum/avg/min/max/count/custom).

**Worker file:** `worker/passes/pivotPass.ts` (new). Pipeline:
`FilterPass → GroupPass → PivotPass (if pivotMode) → AggPass →
SortPass`.

---

## Task 2 — Pivot column synthesis

**Goal:** The worker emits `pivotColumnTree` alongside the chunk;
main thread merges it into `columnOrder` for the lifetime of pivot
mode.

**Column id convention:**
`pivot_<level1Val>_<level2Val>_…_<aggFunc>_<aggCol>`

**Main-thread integration:** `velocityGrid.ts` keeps a flag `pivotMode:
boolean`. While true, the user's original `columnDefs` are HIDDEN
(`hide: true` applied) and the synthesized pivot columns are
APPENDED. The auto-group column (Cycle 15) STAYS visible —
it's the row-dim axis.

**Reverting pivot mode** (`setPivotMode(false)`) restores the
original `columnDefs` with their original visibility — the synthetic
columns are dropped en masse.

---

## Task 3 — Pivot column groups (Cycle 4 HeaderGroupSubgrid reuse)

**Goal:** Each pivot-level becomes a column-group LEVEL in the
header. A 3-level pivot (Sector → SubSector → AssetClass) creates
a 3-row column header band.

**No new painter:** `HeaderGroupSubgrid` (Cycle 4) renders these
verbatim. `pivotColumnTree` is a `CColGroupDef[]` — same shape
the column-tree resolver already understands.

**Header span widths:** each header group spans all its leaf
columns (Sum(PnL), Avg(Q), Count, …) — same span math as
non-pivot column groups.

---

## Task 4 — `pivotMode`, `pivot` per column, `aggFunc` per column

**Goal:** Pivot configuration flows through column state.

**Per-column slots:**

```typescript
interface CColDef<TRow> {
  // ... existing ...
  pivot?: boolean;       // include in pivotCols when pivotMode = true
  pivotIndex?: number;   // pivot dimension order
  aggFunc?: string | string[] | AggFunc;  // existing (Cycle 14)
}

interface VelocityGridOptions {
  pivotMode?: boolean;
  pivotPanelShow?: 'always' | 'onlyWhenPivoting' | 'never';
  pivotRowTotals?: 'before' | 'after' | null;
  pivotColumnGroupTotals?: 'before' | 'after' | null;
  pivotMaxGeneratedColumns?: number; // default 5000
  pivotResultFields?: string[];
  removePivotHeaderRowWhenSingleValueColumn?: boolean;
}
```

**Column state round-trip:** `getColumnState()` (Cycle 6) gains
`pivot` and `pivotIndex` slots; `applyColumnState` round-trips them.

---

## Task 5 — Pivot totals (row totals + col-group totals)

**Goal:** Optional totals columns at every pivot-level boundary.

**Two flavours:**

| Option | Effect |
|---|---|
| `pivotRowTotals: 'after'` | At each row-group level, an extra column appended showing the row-group total across ALL pivot values |
| `pivotColumnGroupTotals: 'after'` | At each pivot-LEVEL boundary, append a "subtotal" leaf column under the parent group header |

Both reuse the per-group aggregator from Cycle 14 — no new agg math.

---

## Task 6 — `processPivotResultColDef` / `processPivotResultColGroupDef`

**Goal:** App-provided callbacks let the user mutate the synthesized
column defs before they hit the resolver (e.g., set
`valueFormatter`, override `headerName`, add `cellStyle`).

```typescript
processPivotResultColDef?: (colDef: CColDef) => void;
processPivotResultColGroupDef?: (groupDef: CColGroupDef) => void;
```

Called once per synthetic column / group at synthesis time.

---

## Task 7 — Pivot panel in side bar

**Goal:** Cycle 11's Columns tool panel gains a "Column Labels" drop
zone (pivot columns) and a "Values" drop zone (agg columns) ABOVE
the existing "Row Groups" drop zone.

**Drag-drop semantics:**

| From → To | Effect |
|---|---|
| Column list → Row Groups | `rowGroupCols.push(colId)` |
| Column list → Column Labels | `pivotCols.push(colId)` (sets `pivot: true`) |
| Column list → Values | `aggCols.push({colId, aggFunc: defaultAggFunc})` |
| Column Labels → Column list | Removes pivot status |
| Reorder within a zone | Updates `pivotIndex` / order |

**Visual chrome:** Three drop zones use IDENTICAL pill vocabulary
established in Cycle 15.5 (pill background, hairline border on
hover, drag handle on left, ✕ on right). One drop-zone idiom across
all three. Auto-group column rendering remains the visible row-dim
axis.

---

## Task 8 — `pivotMaxGeneratedColumns` cap

**Goal:** Pivoting by a high-cardinality column (e.g., `tradeId`)
would synthesize millions of columns — a DoS for the renderer.

**Behaviour:**
- Cap is checked DURING `PivotPass`.
- When exceeded: pass STOPS early, emits a warning event
  `pivotMaxColumnsReached` carrying `{ generatedColumns:
  number, cap: number }`.
- Demo app catches the event and shows a toast.
- Default cap: 5000 (mirrors ag-grid).

---

## Task 9 — Pivot events

- `pivotModeChanged` — `{ pivotMode: boolean }`.
- `pivotChanged` — `{ pivotCols: string[], pivotIndex: Map }`.
- `pivotMaxColumnsReached` — see Task 8.
- `columnPivotChanged` — per-column pivot status toggled.

---

## Visual chrome reuse

Pivot mode brings NO new tokens. Synthesized column headers use the
same `--vg-header-bg` / `--vg-header-fg` as user-defined columns;
their depth is rendered via Cycle 4's `HeaderGroupSubgrid`. Totals
cells (Task 5) reuse Cycle 14's totals signature
(`--vg-totals-bg`, hairline lift, +1 weight stop). One vocabulary
across grouping / pivoting / totals.

---

## Performance gates

- Pivot 100k rows × 5 row-group cols × 3 pivot cols × 3 measures
  ≤ 800 ms (cold).
- Toggling `pivotMode: true` ≤ one frame for already-grouped data.
- Synthesized column count is bounded by `pivotMaxGeneratedColumns`.
- Pivot column synthesis is INCREMENTAL on filter change — only
  re-run when `pivotKeysByLevel` changes; aggregate-only changes
  bypass synthesis.

---

## Exit criteria recap

- FM Area 11 ≥ 90 % ✅.
- Demo: pivot positions by `Sector` × `AssetClass`, sum P&L + count.
- Pivot panel drop zones work via drag from column list.
- `pivotMode: true` round-trips through `getState()` /
  `setState()` (Cycle 23 will lean on this).
