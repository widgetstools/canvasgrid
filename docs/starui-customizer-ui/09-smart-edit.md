# 09 — Smart Edit (Settings Panel)

> Configuration panel for the smart-edit module. Toggles ops, magnitude parsing, safety guards.

Engine module: [smart-edit](../starui-customizer/12-smart-edit.md). See [14-smart-edit-toolbar](14-smart-edit-toolbar.md) for the toolbar UI.

## Purpose

Configure smart-edit behavior: which ops appear in the toolbar (× ÷ + − Set), the default increment step, K/M/B suffix parsing on cell editors, confirm threshold, single-column enforcement, preview-before-apply, history recording.

## Invocation

Settings Sheet → Editing → Smart Edit.

## Layout

```
┌──────────────────────────────────────┐
│ Smart Edit              [Reset][Save]│
├──────────────────────────────────────┤
│ 01 GLOBAL                            │
│   ENABLED          [toggle]          │
│   INCREMENT STEP   [number: 0.0001]  │
│   K/M/B SHORTCUTS  [toggle]          │
├──────────────────────────────────────┤
│ 02 OPERATIONS                        │
│   TOOLBAR OPS      [×][÷][+][−][Set] │  ← button group (variant toggles)
├──────────────────────────────────────┤
│ 03 SAFETY                            │
│   CONFIRM ABOVE N  [number: 0]       │  (0 = never)
│   SINGLE COLUMN    [toggle]          │
│   PREVIEW BEFORE   [toggle]          │
│   RECORD HISTORY   [toggle]          │
└──────────────────────────────────────┘
```

## Component tree

- **SmartEditPanel** (memo, no props)
  - ObjectTitleRow ("Smart Edit" + Save/Reset)
  - Scrollable body
    - Band 01 GLOBAL → SettingsRow × 3 (BoolControl, NumberControl, BoolControl)
    - Band 02 OPERATIONS → SettingsRow with 5-button group
    - Band 03 SAFETY → SettingsRow × 4

## Props

None — reads from `useModuleDraft` context.

## Internal state

- `draft: SmartEditSettings`
- `dirty: boolean`

## Interaction flows

```
toggle ENABLED → updateSetting('enabled', v)
adjust INCREMENT STEP → updateSetting('incrementStep', v)
toggle K/M/B → updateSetting('magnitudeShortcutsEnabled', v)

click operation button → toggleOp(op): mutate Set → convert to array → setDraft
adjust CONFIRM ABOVE N → updateSetting('confirmThreshold', v)
toggle SAFETY flags → updateSetting(key, v)

Save → commit
Reset → discard
```

## Engine wiring

- **State**: `SmartEditState` (moduleId=`SMART_EDIT_MODULE_ID`, itemId='settings')
- **Selector**: `selectItem: (s) => s.settings`
- **Commit**: `commitItem(settings)` → reducer that sets `{ ...s, settings }`

## Shared primitives used

- ObjectTitleRow, Band, SettingsRow
- BoolControl, NumberControl
- Base Button (for operation toggle)

## Design decisions worth copying

1. **Operation set as a Set, persisted as array.** `Set` is efficient for membership testing during the toggle handler. Convert to array on commit so it serializes cleanly to JSON.

2. **Increment step precision (0.0001 min).** Sub-penny step for trading scenarios. Don't enforce integers.

3. **Three bands for ~10 fields.** Even small panels benefit from grouping. GLOBAL / OPERATIONS / SAFETY tells the user "these are arithmetic settings" / "these are op preferences" / "these are guards".

4. **Hint on RECORD HISTORY.** "Logs operations to undo/redo journal." Cross-links to the data-change-history module without forcing the user to learn the relationship.

## cgrid translation

Smallest editor with the draft pattern. Good Phase 1 warmup.

1. **`<cgrid-smart-edit-panel>`** as a Lit custom element.
2. **`<cgrid-op-toggle-group>`** — reusable button group component (used here, in [shortcuts editor](07-shortcuts.md), and in the [smart-edit toolbar](14-smart-edit-toolbar.md)).
3. **Engine wiring**: write a `valueParser` transformer for K/M/B parsing — see engine doc.

Build in Phase 1.
