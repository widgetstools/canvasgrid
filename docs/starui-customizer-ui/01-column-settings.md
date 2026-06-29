# 01 — Column Settings

> The largest editor in the customizer. Per-column overrides across 10 feature bands (header, layout, templates, cell style, header style, value format, filter, row grouping, cell editor, cell renderer).

Engine module: [column-customization](../starui-customizer/05-column-customization.md)

## Purpose

Let users override almost any column setting (header, filter type, editor, renderer, formatter, styling, grouping) without touching developer-authored `columnDefs`. Per-column overrides flow through the column-customization engine module.

## Invocation

Settings Sheet → Columns → Column Customization. Auto-selects first column on open. Also reachable via right-click on a cell → "Settings".

## Layout

```
┌────────────────────────────┬──────────────────────────────────────┐
│ 🔍 Filter columns           │ [headerName input]  [Reset][Save]   │
│ COLUMNS: 42                │──────────────────────────────────────│
│────────────────────────────│ Sticky meta strip:                   │
│   col1                     │ COLID │ TYPE │ OVERRIDES │ TEMPLATES │
│ ✓ col2 (LED)               │──────────────────────────────────────│
│   col3 (•overridden)       │ 01 HEADER                            │
│   col4                     │   headerName [input]                 │
│   col5                     │   headerTooltip [input]              │
│   …                        │ 02 LAYOUT                            │
│ (windowed when >60 cols,   │   initialWidth [number]              │
│  33px rows)                │   pinned [select: none/left/right]   │
│                            │   hide [toggle]                      │
│                            │   sortable [toggle], resizable [tog] │
│                            │ 03 TEMPLATES                         │
│                            │   [chip][chip][+]                    │
│                            │ 04 CELL STYLE                        │
│                            │   <StyleEditor inline>               │
│                            │ 05 HEADER STYLE                      │
│                            │   <StyleEditor inline>               │
│                            │ 06 VALUE FORMAT                      │
│                            │   <FormatterPicker inline>           │
│                            │ 07 FILTER                            │
│                            │   kind [select] + filter-specific UI │
│                            │ 08 ROW GROUPING                      │
│                            │   enableRowGroup [toggle]            │
│                            │   aggFunc [select] / custom expr     │
│                            │ 09 CELL EDITOR                       │
│                            │   kind [select], values, valuesSource│
│                            │ 10 CELL RENDERER                     │
│                            │   name [select] + config             │
└────────────────────────────┴──────────────────────────────────────┘
```

## Component tree

- **ColumnSettingsList** (left rail; exports `ListPane`)
  - Filter input + count badge
  - Windowed CockpitList (60+ col threshold triggers virtualization; otherwise plain list)
  - Per-row: LED dot (dirty), column name, override indicator
- **ColumnSettingsEditor** (right pane; exports `EditorPane`)
  - Empty-state placeholder when no selection
  - **ColumnSettingsEditorInner**
    - **ColumnEditorHeader** — title input + Save/Reset
    - **ColumnMetaStrip** — sticky meta bar (colId, type, override count, template count)
    - Scrollable band area:
      - HeaderBand
      - LayoutBand
      - TemplatesBand
      - CellStyleBand → renders StyleEditor inline
      - HeaderStyleBand → renders StyleEditor inline
      - ValueFormatBand → renders FormatterPicker inline
      - FilterBandWrapper → FilterEditor (filter-kind-specific UI)
      - RowGroupingBandWrapper → RowGroupingEditor
      - CellEditorBandWrapper → CellEditorEditor
      - CellRendererBand → CellRendererEditor

Sub-editors live under `editors/` in the module folder.

## Props

- `ListPane`: `{ selectedId: string | null; onSelect: (id: string) => void }`
- `EditorPane`: `{ selectedId: string | null }`

(Both panes get their state from the engine module + a draft controller.)

## Internal state

| Pane | State |
|---|---|
| List | filter query, dirty col IDs (subscribed from DirtyBus), windowing range |
| Editor | draft assignment for selected col, expanded bands set, validation errors per band |

## Interaction flows

**Search columns:**
```
type in filter → updates query → filters list by headerName + colId →
  if currently-selected col is filtered out, leave selection alone (just hidden)
```

**Select & edit:**
```
click row → selectedId set → editor seeds draft from assignments[colId] (or blank {colId}) →
  user edits → setDraft(patch) → dirty LED lights →
  [Save]: commit, drop entry if isEmptyAssignment(draft) → LED clears
  [Reset]: discard draft, reseed from committed
```

**Apply template (band 03):**
```
TemplatesBand chip list → [+] picker shows available templates →
  user picks → templateIds appended to draft → chip appears →
  per-chip [×] removes the template ID from draft
```

**Delete override:**
```
manually clear all fields → Save with effectively-empty assignment →
  isEmptyAssignment() returns true → entry removed from assignments map → row's override indicator clears
```

## Engine wiring

- **Reads**: `column-customization.assignments[colId]` for selected column
- **Reducers dispatched**: via draft commit, runs through `applyAssignmentsReducer` or per-section reducers (`applyColorsReducer`, `applyAlignmentReducer`, `applyBordersReducer`, `applyCellEditorKindReducer`, `applyFormatterReducer`, `applyFilterPrimaryKindReducer`, `applyAutoFormatPlanReducer`)
- **Related**: reads available cgrid columns from the grid (for the list); reads active theme to decide which `cellStyleOverrides` slice (light/dark) to patch
- **Custom aggregation**: when row-grouping `aggFunc === 'expression'`, the `customAggExpression` field opens an ExpressionEditor

## Shared primitives used

- CockpitList + CockpitListItem (from [00-foundations](00-foundations.md))
- Band, SettingsRow, ObjectTitleRow, SummaryChip, TitleInput, IconInput
- DirtyDot / LedBar
- StyleEditor (cell + header instances)
- FormatterPicker (compact mode)
- ExpressionEditor (when custom aggregation expression is used)
- ChromeButton, GhostIconButton

## Design decisions worth copying

1. **Windowed virtualization for long lists.** Render only visible rows when column count > 60. 33px row height, walks up DOM to find the overflow:auto ancestor for the scroll container. Falls back to plain render if no scroll ancestor (tests, edge cases).

2. **Per-row dirty LED via DirtyBus subscription.** `useDirtyColIds()` returns a `Set<string>` from one subscription. Each row does `set.has(colId)` for its LED — O(1) per row. Without this, 100 rows = 100 store subscriptions = render thrash.

3. **Draft seeding for never-customized columns.** Selecting a column with no entry creates `{ colId }` as the draft so the editor has something to edit. Commit checks `isEmptyAssignment()` and drops the entry if all overrides were cleared — keeps persisted state lean.

4. **Theme-aware StyleEditor.** Only patches the active theme slot via `patchActiveStyle()`. Inactive slot preserved. Flipping `data-theme` re-renders the editor against the now-active slot. Critical for "edit dark theme without touching light" workflows.

5. **Meta strip sticky.** Stays visible while bands scroll. Override count + template count + colId + dataType always in view.

6. **Filter kind synthesizes UI per kind.** FilterBandWrapper picks a sub-editor based on `filter.kind`. Text filter shows different fields than Set filter than Number filter. Avoids one mega-form with 30 conditional fields.

## cgrid translation

This is the biggest port. Strategy:

1. **Build the 10 bands as separate Lit components.** `<cgrid-band-header>`, `<cgrid-band-layout>`, etc. Each owns its sub-form. Compose them in `<cgrid-column-settings-editor>`.
2. **Reuse StyleEditor + FormatterPicker.** These are doing the heaviest lifting. Build them first as standalone Lit components (see [00-foundations](00-foundations.md)).
3. **Virtualize the list.** ~100 column grids exist; need windowing. Use [lit-virtualizer](https://github.com/lit/lit/tree/main/packages/labs/virtualizer) — official Lit virtualizer, ~4 KB. Same API surface as `react-window`.
4. **Build the DirtyBus as a Lit reactive controller.** One controller instance per grid; per-row LEDs use `@lit/context` to subscribe. Same O(1) row updates.
5. **Filter sub-editors per kind.** Match cgrid's filter system. Some kinds (set filter) need async distinct-values fetch from the worker — same as bulk-update; reuse the path.
6. **Cell editor / renderer pickers** read from cgrid's `cellEditorRegistry` and `cellRendererRegistry`. Render the editor's preview if it provides a `previewElement`.

Build this **last** in Phase 4 — depends on the foundations + StyleEditor + FormatterPicker + ExpressionEditor all being ready.
