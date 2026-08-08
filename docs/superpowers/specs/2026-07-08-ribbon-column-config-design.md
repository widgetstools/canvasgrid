# VelocityGridExt — Quick Column Configuration from the Ribbon

- **Status:** Approved design; ready for implementation planning.
- **Date:** 2026-07-08
- **Branch lineage:** continues `cgridext/ribbon-density`.

## 1. Goal

Configure the focused/selected column(s)' common features directly from the
ribbon: floating filter on/off, filter type (incl. **set** filter), groupable,
pivotable, aggregation (which function + whether it shows in the header), and
the high-value behavior knobs (sortable, resizable, editable, pinned, hidden).
Elegant and immediate — no trip to the settings sheet. The ribbon's dead
placeholder **Edit** and **Group** groups (pills stuck on "None") are replaced
by this surface.

## 2. Mechanism split (the load-bearing decision)

Two kinds of knobs, two pipes — chosen so EVERYTHING persists correctly:

1. **Def-level flags ride the calc own-template pipeline** (like `editable`/
   `hide`/`width` today): `floatingFilter`, `filter`
   (`'text' | 'number' | 'date' | 'set'`, `null` = revert to type default),
   `enableRowGroup`, `enablePivot`, `sortable`, `resizable`,
   `suppressAggFuncInHeader`. Phase A adds them to calc's `ColumnEditPatch` +
   `EDITABLE_SCALAR_KEYS` + `overrideToKernelPatch`, so `editColumn` writes
   them into the column's own template and they persist through profiles,
   layouts, and export automatically. No `updateGridOptions({columnDefs})`
   def-churn, no persistence gap.
2. **Aggregation uses the existing runtime value-column APIs** (`addValueColumn`,
   `setValueColumnAggFunc`, `removeValueColumn`, `getValueColumns`) — agg
   already lives in grid state and persists there; routing it through
   templates would double-own it. Pinned/hidden quick actions may also use
   `setColumnsPinned`/`setColumnsVisible` where those are the canonical
   state paths (hidden: `editColumn({hide})` already exists and persists via
   templates — the panel uses that for consistency with the Phase-A keys;
   pinned uses `setColumnsPinned`, which rides columnState).

## 3. Phase A — calc/kernel plumbing

- `ColumnEditPatch` gains: `floatingFilter?: boolean`, `filter?: 'text' |
  'number' | 'date' | 'set' | null`, `enableRowGroup?: boolean`,
  `enablePivot?: boolean`, `sortable?: boolean`, `resizable?: boolean`,
  `suppressAggFuncInHeader?: boolean`.
- All join the scalar merge in `editColumn` (defined-falsy values land;
  `filter: null` deletes the key from the own template — same null-removal
  convention as `format`/`cellIcon`).
- `overrideToKernelPatch` forwards each to the kernel colDef patch verbatim.
- Round-trip tests: edit → `resolvedPatchFor` carries the keys → a real grid's
  resolved def reflects them (floating-filter row appears, header sort
  affordance follows `sortable`, etc. — kernel integration test level), and
  the keys survive `getState`/`setState` via the existing template modules.

## 4. Phase B — the ribbon Column group

Replaces `grp('Edit', …)` and `grp('Group', …)` with ONE group:

```
┌─ Column ────────────────────────────┐
│ [⚙ Column ⌄]        [Σ Sum ⌄]      │   row A
│ [⛃] [⊞G] [Σh]                      │   row B (instant toggles)
└─────────────────────────────────────┘
```

- **`⚙ Column ⌄` trigger** — labeled-control chrome (same as `Add icon`);
  opens the Column settings popover (below).
- **Agg pill** — shows the focused column's live agg (`Σ None` / `Σ Sum` …);
  its dropdown lists None + sum/avg/min/max/count/first/last (from the agg
  registry). Picking applies via the value-column APIs to every target column.
- **Row-B instant toggles** (iconic, `is-on` state, tooltips): floating filter,
  groupable (`enableRowGroup`), agg-in-header (inverse of
  `suppressAggFuncInHeader`).

### The Column popover (`toolbar/columnPanel.ts`)

`menu()`-anchored (align left, ~300px, format-picker chrome), sections of
compact rows — each row = label + control, state read live per focused column:

- **FILTER** — `Floating filter` switch; `Filter type` segmented control
  `Auto · Text · Number · Date · Set` (Auto = `filter: null`, i.e. the
  cellDataType default; **Set** = the set filter).
- **GROUPING** — `Groupable` switch; `Pivotable` switch.
- **AGGREGATION** — `Function` select (None/sum/avg/min/max/count/first/last);
  `Show in header` switch (`suppressAggFuncInHeader` inverted; disabled when
  Function is None).
- **BEHAVIOR** — `Sortable`, `Resizable`, `Editable` switches; `Pinned`
  segmented `Left · – · Right` (`setColumnsPinned`); `Hidden` switch
  (`editColumn({hide})`).

Interaction rules:
- Every control applies IMMEDIATELY to all `targetCols()` (so the Selected/All
  scope toggle fans changes grid-wide); the popover stays open for multiple
  edits; Escape closes.
- Multi-column selection with mixed values renders the control indeterminate
  (switches: mid-state style; segments/selects: blank) — first change
  normalizes all targets.
- No target columns → the popover renders the standard "Select a cell or
  column first" hint; row-B toggles + agg pill disabled.
- `refresh()` (existing ribbon sync) repaints the quick toggles + agg pill on
  focus/selection/template changes; the popover re-reads state on open and
  after each apply.
- Switch/segmented controls are built from the shared factory vocabulary
  (`menu()`, `stateToggle`-derived row switch, `colorSwatch` unaffected) — no
  hand-rolled popup/positioning code.

## 5. Error handling

Kernel/calc throws surface non-fatally (row-level error tint + title, same
pattern as the format picker's custom input); value-column APIs on non-numeric
columns follow kernel semantics (the panel doesn't pre-judge eligibility —
`enableValue` isn't required to set an aggFunc via APIs; if the kernel
rejects, the row shows the error state).

## 6. Testing

- **Calc unit:** each new patch key merges, null-removal for `filter`,
  atomicity (bad patch leaves template untouched), resolvedPatchFor output.
- **Kernel integration:** template-borne `floatingFilter`/`sortable`/
  `enableRowGroup` reach the resolved def and the painted/behavioral surface
  (floating-filter row toggles, sort click gated, columns panel groupability).
- **Ext unit (happy-dom):** popover anatomy per section, live state read-back,
  mixed-state rendering, apply fan-out over a stub grid, agg pill sync,
  disabled empty-state, destroy cleanup.
- **E2E (ext demo):** floating filter toggles the filter row for the column;
  filter type Set → set-filter popup opens from the header; groupable off
  removes the column from the row-group panel's draggables; agg Sum shows
  `sum(...)` header caption, then Show-in-header off hides it; pinned Left
  moves the column; persistence across reload for a template-borne knob +
  the agg. Full demo suite green = done-gate; single batch closeout review +
  one fix wave (standing rule).

## 7. Out of scope

- Filter UI itself (set-filter popup etc. — kernel-owned, already exists).
- Per-cell / conditional variants of these settings.
- The kernel Columns tool panel (unchanged; it reflects groupability etc.
  automatically via resolved defs).
- Editor-type selection (the old Edit group's "Editor: None" pill concept) —
  can ride the same popover later; not in this cycle.
