# 12 — Visual Excel

> The smallest editor: one toggle. Controls whether display formatters and conditional-style colors carry through to XLSX exports.

Engine module: [visual-excel](../starui-customizer/10-visual-excel.md)

## Purpose

Single setting: "apply display formatters and style-rule colors when exporting to Excel". When enabled, exports look like the on-screen grid; when disabled, exports use plain AG-Grid Excel defaults.

## Invocation

Settings Sheet → Data → Visual Excel.

## Layout

```
┌──────────────────────────────────────────┐
│ Visual Excel              [Reset][Save] │
├──────────────────────────────────────────┤
│ ENABLED                       [toggle]   │
│ Apply display formatters and style-rule │
│ colours when exporting to Excel.        │
└──────────────────────────────────────────┘
```

No Band wrapper. Just a single SettingsRow with the toggle and a hint.

## Component tree

- **VisualExcelPanel** (memo, no props)
  - ObjectTitleRow ("Visual Excel" + Save/Reset)
  - Scrollable body
    - Single SettingsRow (label + hint + BoolControl)

## Props

None.

## Internal state

- `draft: VisualExcelSettings`
- `dirty: boolean`

## Interaction flows

```
toggle ENABLED → setDraft({ enabled: v })
Save → commit; Reset → discard
```

## Engine wiring

- **State**: `VisualExcelState` (moduleId=`VISUAL_EXCEL_MODULE_ID`, itemId='settings')

## Shared primitives used

- ObjectTitleRow, SettingsRow, BoolControl

## Design decisions worth copying

1. **No Band wrapper for single-setting panels.** Don't force structure where there isn't any. A 1-field panel is just a label + control + hint.

2. **Hint text inline (not tooltip).** This is a setting users glance at once and forget. Inline hint > tooltip the user has to discover.

3. **Default disabled.** Plain Excel exports are safer (more compatible). Users opt-in to styling.

## cgrid translation

Trivial. 30 lines of Lit.

1. **`<cgrid-visual-excel-panel>`** with a single toggle.
2. **Engine wiring**: when enabled, the export pipeline calls `buildVisualExcelStyles()` and passes the registry to the worker XLSX writer.

Build in Phase 1 — easy win to validate the panel-creation pattern.
