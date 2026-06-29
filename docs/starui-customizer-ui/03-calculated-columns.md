# 03 — Calculated Columns

> Virtual columns with expression-derived values. The simplest master-detail editor.

Engine module: [calculated-columns](../starui-customizer/02-calculated-columns.md)

## Purpose

Author virtual columns whose values are computed at render time from an expression over row data. Examples: `[price] * [quantity]`, `IF([status]='active', [premium] * 1.1, [premium])`, `CONCAT([firstName], ' ', [lastName])`.

## Invocation

Settings Sheet → Columns → Calculated Columns.

## Layout

```
┌──────────────────────────┬────────────────────────────────────────┐
│ COLUMNS: 03 [+]          │ [Header name input]  [Reset][Save]    │
│──────────────────────────│────────────────────────────────────────│
│ ✓ col_lineTotal (LED)    │ Sticky meta strip:                     │
│   col_pnl                │ COLID │ REFS │ FORMATTER │ WIDTH       │
│   col_fullName           │ [colId input]                          │
│                          │────────────────────────────────────────│
│                          │ 01 EXPRESSION                          │
│                          │   <ExpressionEditor multiline, 3 rows> │
│                          │   placeholder: "[price] * [quantity]"  │
│                          │                                        │
│                          │ 02 VALUE FORMATTER                     │
│                          │   <FormatterPicker compact>            │
│                          │   "OPTIONAL · APPLIED BEFORE DISPLAY"  │
└──────────────────────────┴────────────────────────────────────────┘
```

## Component tree

- **CalculatedColumnsList** (left rail; `ListPane`)
  - `[+]` add button
  - CockpitList of virtual columns
  - Per-row: name + LED + trash on hover
- **CalculatedColumnsEditor** (right pane; `EditorPane`)
  - Empty placeholder when no selection
  - **VirtualColumnEditor** (memoized)
    - ObjectTitleRow (header name + Save/Reset)
    - Sticky meta bar (colId, base column refs count, formatter status, initial width)
    - Band 01 EXPRESSION → ExpressionEditor (multiline, 3-line height)
    - Band 02 VALUE FORMATTER → FormatterPicker compact mode

## Props

Standard `ListPane` + `EditorPane` shape.

## Internal state

- Selected virtual column ID
- Draft: `{ colId, headerName, expression, valueFormatterTemplate, cellDataType, initialWidth, position }`

## Interaction flows

**Add column:**
```
[+] → generate colId (vcol_<timestamp>) → create {
  colId, headerName: 'New Column', expression: '', position: length
} → select
```

**Live expression editing:**
```
type in ExpressionEditor → onChange fires per keystroke → draft.expression updates →
  Save button enables → validation errors render inline if expression engine flags issues
```

**Apply formatter:**
```
pick from FormatterPicker (compact) → preset/excelFormat/expression template →
  draft.valueFormatterTemplate updates
```

**Delete:**
```
trash → remove from virtualColumns array → re-select next/previous → editor empty if none left
```

## Engine wiring

- **Reads**: `calculated-columns.virtualColumns` array
- **Commit**: via draft → matches by colId → updates array
- **Available base columns**: from grid's column list, fed to ExpressionEditor autocomplete

## Shared primitives used

- CockpitList, Band, ObjectTitleRow, SummaryChip
- ExpressionEditor (multiline mode)
- FormatterPicker (compact mode)
- ChromeButton, GhostIconButton

## Design decisions worth copying

1. **Live expression validation.** Per-keystroke; SAVE button reflects validity. Don't wait for blur — users want feedback as they type a long formula.

2. **Compact FormatterPicker reuse.** Same component used by the formatting toolbar. Just a `compact` prop toggle.

3. **Meta bar shows refs count.** "REFS 3" tells the user how many base columns the expression touches. Useful for spotting unintended refs (e.g., a typo like `[Price]` instead of `[price]`).

4. **AUTO width default.** Width meta shows "AUTO" until user sets `initialWidth`. Saves a column-sizing decision for later.

## cgrid translation

Smallest master-detail editor — good place to start the pattern.

1. **`<cgrid-calculated-columns-list>`** + **`<cgrid-calculated-columns-editor>`** as Lit custom elements.
2. **ExpressionEditor** must be ready (Monaco lazy-load + cgrid expression DSL grammar). Provide autocomplete via the column list.
3. **FormatterPicker** must be ready (compact + inline variants).
4. **Engine bridge**: virtual columns get a synthesized `colDef` (via `buildVirtualColDef`) injected into cgrid's `columnDefs` array. The valueGetter closure captures the compiled expression.
5. **Worker concern**: `SUM([col])`-style refs need worker-side aggregation. See [calculated-columns engine doc](../starui-customizer/02-calculated-columns.md#cgrid-translation) for the proposed RPC pattern.

Build in Phase 4 after ExpressionEditor + FormatterPicker are ready.
