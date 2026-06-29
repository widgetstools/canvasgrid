# cgrid vs AG-Grid pivot side-by-side comparison — design

## Goal

Add a side-by-side visual + behavioral comparison surface to the
cgrid showcase so we can see cgrid's pivot rendering and AG-Grid's
pivot rendering at once, driving both with linked controls + the
same data. Result: a persistent diff tool for the Cycle 18 pivot
work — every gap we ship a fix for can be re-checked against AG in
one place.

## Non-goals

- Building a separate AG-Grid app (the user redirected: use the
  showcase).
- Buying an AG-Grid license. Enterprise watermark is acceptable in
  dev.
- Behavioral parity with AG for THIS task. We're surfacing the diff,
  not closing it. Closing gaps happens in follow-up work.

## Architecture

### One new feature page

`apps/cgrid-showcase/src/features/pivotAgComparison.ts`. Registers
through `features/index.ts` like every other feature.

### Layout: split host

The feature's `gridHost` is a single div the showcase passes in. We
flex it into two columns:

```
┌──────────────────┬──────────────────┐
│   cgrid pivot    │   AG-Grid pivot  │
│                  │                  │
└──────────────────┴──────────────────┘
```

A small header strip above each side labels which is which. The
`controls` slot (the toolbar above the grid area, provided by the
showcase shell) holds the linked controls.

### Linked controls

Single toolbar above the split:
- **Pivot On/Off**: toggles `pivotMode` on both grids
- **Row totals: off / after / before**: cycles `pivotRowTotals` on
  both
- **Col-group totals: off / after / before**: cycles
  `pivotColumnGroupTotals` on both
- **Reset state**: re-applies the pre-seeded config to both

Independent controls (option B) was rejected — the comparison only
works if both grids react to the same mutations.

### Same data

Both grids consume `makeRows(120)` from `../seedData`. Same
`ShowcaseRow` shape.

### Same config

Both:
- Row group: `desk`
- Pivot columns: `region`, `sector`
- Value columns: `sum(pnl)`, `sum(notional)`
- pivotMode: true
- pivotColumnGroupTotals: 'after'
- processPivotResultColDef: £-prefix formatter

AG specifics:
- `sideBar: 'columns'` (cgrid's `sideBar.toolPanels: ['columns']`)
- No top-of-grid pivot panel on AG (matches cgrid's
  `pivotPanelShow: 'always'` would need translation; for the first
  pass we leave AG with its default `pivotPanelShow: 'never'` to
  isolate the matrix comparison).

## Dependencies

Add to `apps/cgrid-showcase/package.json`:

```json
"dependencies": {
  "ag-grid-community": "^32",
  "ag-grid-enterprise": "^32"
}
```

AG-Grid Enterprise watermark accepted in dev.

Import on first mount of this feature only (lazy via `await import`)
so existing showcase startup time is unaffected.

## Files touched / created

- NEW `apps/cgrid-showcase/src/features/pivotAgComparison.ts`
- `apps/cgrid-showcase/src/features/index.ts` — register
- `apps/cgrid-showcase/package.json` — deps
- (potential) `apps/cgrid-showcase/src/style.css` — flex split
  classes if not already present

## Acceptance

Open `/?feature=pivotAgComparison` in the showcase:
- Two grids, ~50/50 split
- Both rendering the same matrix shape (4 desks × region × sector
  × P&L+Notional)
- Toggling any toolbar button updates both grids
- AG-Grid watermark visible in its bottom-right corner (expected)

Once shipped, follow-up work will catalogue visual + behavioural
gaps as a separate document in `docs/superpowers/specs/`.

## Out of scope / deferred

- AG-Grid context menu wiring (we have ours; AG's is different)
- AG sideBar advanced toolbox sections
- License key plumbing
- Theming match (AG and cgrid use different theme systems — we
  accept the visual mismatch; the matrix structure is what matters)
