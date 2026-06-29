# 10 — Bulk Update (Settings Panel)

> Configuration panel for the bulk-update module. Mirrors [smart-edit](09-smart-edit.md) in structure.

Engine module: [bulk-update](../starui-customizer/13-bulk-update.md). See [15-bulk-update-toolbar](15-bulk-update-toolbar.md) for the toolbar UI.

## Purpose

Configure bulk-update: enabled flag, confirm threshold, single-column enforcement, history recording, and dropdown behavior (distinct values picker, max dropdown size).

## Invocation

Settings Sheet → Editing → Bulk Update.

## Layout

```
┌──────────────────────────────────────┐
│ Bulk Update             [Reset][Save]│
├──────────────────────────────────────┤
│ 01 GLOBAL                            │
│   ENABLED            [toggle]        │
│   CONFIRM THRESHOLD  [number: 0]     │  (0 = never)
│   SINGLE COLUMN      [toggle]        │
│   RECORD HISTORY     [toggle]        │
├──────────────────────────────────────┤
│ 02 DROPDOWN                          │
│   DISTINCT VALUES    [toggle]        │
│   MAX DROPDOWN       [number: 100]   │
└──────────────────────────────────────┘
```

## Component tree

- **BulkUpdatePanel** (memo, no props)
  - ObjectTitleRow ("Bulk Update" + Save/Reset)
  - Scrollable body
    - Band 01 GLOBAL → SettingsRow × 4
    - Band 02 DROPDOWN → SettingsRow × 2

## Props

None.

## Internal state

- `draft: BulkUpdateSettings`
- `dirty: boolean`

## Interaction flows

```
toggle ENABLED / SINGLE COLUMN / RECORD HISTORY → updateSetting(key, v)
adjust CONFIRM THRESHOLD → updateSetting('confirmThreshold', v)
toggle DISTINCT VALUES → updateSetting('showDistinctValues', v)
adjust MAX DROPDOWN → updateSetting('maxDropdownValues', v)
Save → commit; Reset → discard
```

## Engine wiring

- **State**: `BulkUpdateState` (moduleId=`BULK_UPDATE_MODULE_ID`, itemId='settings')
- **Selector**: `selectItem: (s) => s.settings`

## Shared primitives used

Same as smart-edit: ObjectTitleRow, Band, SettingsRow, BoolControl, NumberControl.

## Design decisions worth copying

1. **Dropdown separated as its own band.** UI-specific settings (DISTINCT VALUES, MAX DROPDOWN) belong with each other, not mixed with safety guards.

2. **Mirrored layout with Smart Edit.** Same band structure, same primitives — feels cohesive in the customizer. Users learn one settings panel = they understand the other.

3. **MAX DROPDOWN default 100.** Big enough for most enum columns; bounded enough that a full-table scan stays fast.

## cgrid translation

Trivial port — copy the [smart-edit panel](09-smart-edit.md) and swap the schema.

1. **`<cgrid-bulk-update-panel>`** as a Lit custom element.
2. Reuse all the same primitives.
3. **Engine wiring**: distinct-values fetch is the only worker concern — covered in engine doc.

Build in Phase 1 alongside smart-edit.
