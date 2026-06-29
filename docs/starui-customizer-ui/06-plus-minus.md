# 06 — Plus/Minus

> Keyboard nudge rules editor. Module-level toggles at top, nudge list + editor below.

Engine module: [plus-minus](../starui-customizer/14-plus-minus.md)

## Purpose

Configure nudge rules for +/- keys on numeric cells: name, scope (column IDs), increment/decrement steps, and an optional expression that gates the rule per-row.

## Invocation

Settings Sheet → Editing → Plus / Minus.

## Layout

```
┌──────────────────────────┬────────────────────────────────────────┐
│ Module settings (header) │ GLOBAL: [enable] [record history]      │
│  ENABLED         [tog]   │ "When enabled, +/- keys use nudges…"   │
│  RECORD HISTORY  [tog]   │────────────────────────────────────────│
│                          │ Band 01 NUDGE                          │
│ [+ Add nudge]            │   NAME [input]                         │
│──────────────────────────│   ENABLED [toggle]                     │
│ ✓ Qty +1 (LED) [trash]   │   COLUMNS [input: comma-sep colIds]    │
│   on: quant · ±1         │   INCREMENT [number]                   │
│   Price +0.25            │   DECREMENT [number, optional]         │
│   on: bid,ask · +0.25/-… │ Band 02 EXPRESSION (optional gate)     │
│                          │   <ExpressionEditor compact>           │
└──────────────────────────┴────────────────────────────────────────┘
```

Each nudge row has a 2-line "meta" format: `[on/off] · step · scope`.

## Component tree

- **PlusMinusPanel** (flat wrapper; exports `PlusMinusList` and `PlusMinusEditor`)
  - Module settings strip (top): ObjectTitleRow + Band (ENABLED, RECORD HISTORY toggles + help text)
  - Two-column body:
    - **NudgeListBody** (left)
      - `[+ Add nudge]` button
      - CockpitList of nudges with multiline rows (name + meta)
    - **NudgeEditorBody** (right, conditional on selectedId)
      - Band 01 NUDGE — NAME, ENABLED, COLUMNS, INCREMENT, DECREMENT
      - ExpressionBand (multiline Monaco, optional gate)

## Props

`ListPane` + `EditorPane` shape. Plus module settings have their own draft (itemId='settings').

## Internal state

- Module settings: `{ enabled, recordHistory }` via draft (itemId='settings')
- Selected nudge ID
- Draft nudge: `{ id, name, enabled, incrementStep, decrementStep, scope: { columnIds }, expression? }`

## Interaction flows

**Module-level toggle:**
```
ENABLED switch → draft (itemId='settings') updates → Save commits
```

**Add nudge:**
```
[+ Add nudge] → defaultPlusMinusNudge() (name: "New nudge", incrementStep: 1) →
  append to nudges array → select
```

**Edit column scope:**
```
COLUMNS input (comma-separated) → parsed on blur into string[] → empty = all numeric editable columns
```

**Live expression (optional gate):**
```
type in ExpressionEditor → auto-saves to draft → engine evaluates per-cell when key pressed
```

**Delete:**
```
trash → remove from nudges array → re-select next/previous
```

## Engine wiring

- **Reads**: `plus-minus.settings` (module); `plus-minus.nudges` (array)
- **Module commit**: via draft with itemId='settings'
- **Nudge commit**: via draft, by id match
- **Validation**: ExpressionEditor binds to expression engine for live validation

## Shared primitives used

- CockpitList, CockpitListItemMeta (multiline rows), Band, ObjectTitleRow
- SettingsRow
- ExpressionBand (shared)
- BoolControl, NumberControl, Switch, Input
- ChromeButton

## Design decisions worth copying

1. **Module settings use the same draft pattern with `itemId='settings'`.** Rather than special-casing module settings, treat them as a single "item" in the draft system. Keeps the Save/Reset semantics consistent.

2. **Compact column scope input.** Plain text input, comma-separated, parsed on blur. Empty string = all numeric editable columns. Simpler than a multi-select for a small list.

3. **Optional decrement.** Defaults to increment value if not specified — symmetric nudging is the default; asymmetric (+10 / -5) is the exception.

4. **Meta line per nudge.** `[on/off] · ±step · column scope` — lets users scan the list and understand each rule without opening it.

5. **Expression gate is optional.** Most nudges don't need a per-row condition. ExpressionBand defaults to empty; rule applies to all matching cells.

## cgrid translation

Simpler editor — good warmup for the master-detail pattern.

1. **`<cgrid-plus-minus-panel>`** wraps module settings + list + editor.
2. **`<cgrid-cockpit-list>`** with multiline support — pass an additional slot for meta content.
3. **Engine wiring**: cgrid needs per-column `suppressKeyboardEvent` so the keyboard feature chain claims +/- keys before they trigger inline edit (covered in engine doc).
4. **Expression gate** uses the same ExpressionEditor (smaller multi-line variant, ~2 rows).

Build in Phase 4 after master-detail substrate works. Smaller scope makes this a good test case.
