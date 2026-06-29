# 07 — Shortcuts

> Letter-key bindings for numeric ops (×, ÷, +, −). Sibling of [plus-minus](06-plus-minus.md) — no expression gate, single-letter key per rule.

Engine module: [shortcuts](../starui-customizer/15-shortcuts.md)

## Purpose

Bind single letters (a-z) to arithmetic ops on numeric cells. Press the letter with a numeric cell focused → operation applies. Scoped by column.

## Invocation

Settings Sheet → Options → Shortcuts.

## Layout

```
┌──────────────────────────┬────────────────────────────────────────┐
│ Module settings (header) │ GLOBAL: [enable] [record history]      │
│  ENABLED         [tog]   │ "Focus a numeric cell and press a key" │
│  RECORD HISTORY  [tog]   │────────────────────────────────────────│
│                          │ Band 01 SHORTCUT                       │
│ [+ Add shortcut]         │   NAME [input]                         │
│──────────────────────────│   ENABLED [toggle]                     │
│ ✓ H → ×2.5 (LED)         │   KEY [input: 1 letter]                │
│   on: quant · ×2.5       │   OPERATION [×][÷][+][−]               │
│   Q → +500               │   VALUE [number]                       │
│   on: bid · +500         │   COLUMNS [input: comma-sep colIds]    │
│   Z → ÷10                │                                        │
│                          │ Help: "Letter shortcuts apply to numeric│
│                          │  cells when focused."                  │
│                          │ Available columns: quant, midPrice, …  │
└──────────────────────────┴────────────────────────────────────────┘
```

Each shortcut row's meta: `[on/off] · KEY → op·value · scope`.

## Component tree

- **ShortcutsPanel** (flat wrapper; exports `ShortcutsList` and `ShortcutsEditor`)
  - Module settings strip (ENABLED, RECORD HISTORY)
  - Two-column body:
    - **ShortcutListBody** (left)
      - `[+ Add shortcut]` button
      - CockpitList with multiline rows
    - **ShortcutEditorBody** (right)
      - Band 01 SHORTCUT — NAME, ENABLED, KEY, OPERATION (4-button group), VALUE, COLUMNS
      - Help text footer (2 lines)

## Props

`ListPane` + `EditorPane` shape. Module settings draft (itemId='settings').

## Internal state

- Module settings: `{ enabled, recordHistory }` via draft
- Selected shortcut ID
- Draft shortcut: `{ id, name, enabled, shortcutKey: string, operation: 'multiply'|'divide'|'add'|'subtract', shortcutValue: number, scope: { columnIds } }`

## Interaction flows

**Key input validation:**
```
type in KEY field → validate /^[a-zA-Z]$/ → auto-downcase → maxLength 1 →
  reject non-letter input (don't insert character)
```

**Operation picker:**
```
4-button group [×][÷][+][−] → click → toggle (active button gets primary style) →
  draft.operation updates
```

**Add shortcut:**
```
[+ Add shortcut] → defaultShortcut() → append → select
```

**Delete:**
```
trash → remove → re-select neighbor
```

## Engine wiring

- **Reads**: `shortcuts.settings`; `shortcuts.shortcuts` array
- **Module commit**: via draft (itemId='settings')
- **Shortcut commit**: via draft, by id match

## Shared primitives used

- CockpitList, CockpitListItemMeta (multiline)
- Band, ObjectTitleRow, SettingsRow
- BoolControl, NumberControl, Input, Switch, Button (for op group)

## Design decisions worth copying

1. **Single-letter key field with regex validation.** Rejects non-letter input at the input level — no error message needed, just don't accept it. Auto-downcase on accept.

2. **Op buttons with symbol-only labels.** `×` `÷` `+` `−` — easier to scan than "Multiply / Divide / Add / Subtract" text.

3. **No expression gate.** Differentiates from plus-minus. Shortcuts are deterministic per-cell; predictability matters more than flexibility for letter keys.

4. **Available columns hint.** Footer lists first 8 available columns (truncated with "…" if more). Helps users author scope without leaving the editor.

5. **Meta format `KEY → op·value · scope`.** Sortable by key, glanceable. "H → ×2.5 on quant".

## cgrid translation

Almost identical to [plus-minus](06-plus-minus.md). Build them together.

1. **`<cgrid-shortcuts-panel>`**, **`<cgrid-shortcuts-list>`**, **`<cgrid-shortcuts-editor>`**.
2. **Reuse the multiline-row CockpitList** from plus-minus.
3. **Op button group**: a Lit custom element `<cgrid-op-toggle-group>` (since this same UI shows up in smart-edit too).
4. **Engine wiring**: same `suppressKeyboardEvent` requirement as plus-minus.
5. **Conflict detection** (mentioned in engine doc): if two shortcuts bind the same key + overlapping columns, only the first fires. Editor should warn — add a `<cgrid-conflict-warning>` chip on the list row when detected.

Build in Phase 4 alongside plus-minus.
