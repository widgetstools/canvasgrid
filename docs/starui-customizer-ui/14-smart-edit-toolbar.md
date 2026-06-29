# 14 — Smart Edit Toolbar

> Inline toolbar row for multi-cell arithmetic. Operand input + op buttons + preview + apply.

Engine module: [smart-edit](../starui-customizer/12-smart-edit.md). See [09-smart-edit](09-smart-edit.md) for the settings panel.

## Purpose

Apply numeric ops (× ÷ + − Set) to a selection without opening the full Column Settings or any dialog. Type a number, click an op, see preview or just apply.

## Invocation

Optional row in the editing toolbar (visible when `SmartEditState.enabled`). Hidden when disabled. Can sit alongside [bulk-update toolbar](15-bulk-update-toolbar.md) and [edit-history toolbar](16-edit-history-toolbar.md).

## Layout

```
[Smart] [operand: 1____] [×][÷][+][−][Set…] ← {count} cells · 1 col (if multi-col guard)
```

Tight row. Operand input has `inputMode="decimal"` for mobile keyboard.

## Component tree

- **SmartEditToolbar** → thin wrapper, delegates to **SmartEditToolbarBody**
- **SmartEditToolbarBody**
  - **EditingToolbarSegment** — container with label and meta info
  - Operand `<input>` — numeric, decimal inputMode
  - **EditingToolbarOpButton** × 4 — symbol buttons (× ÷ + −)
  - **EditingToolbarOpButton** (Set…) — opens a separate dialog for value input
  - **Dialog** "Bulk set value" — set-mode value picker
  - **Dialog** "Preview smart edit" — table: row · field · current · new · status
  - **AlertDialog** — confirm-threshold warning

## Props

`SmartEditToolbarBody({ layout? })` — `layout` is `'standalone' | 'segment'`:
- `'standalone'`: full-width toolbar
- `'segment'`: inline cluster within a larger toolbar (no label, smaller padding)

## Internal state

- `operand`: numeric input draft (not yet applied)
- `setDialogOpen`, `setValue`: Set… value picker state
- `confirmOp`, `previewOpen`: pending dialogs
- `pendingOp`, `pendingPatches`: snapshots awaiting preview apply or threshold confirm

## Interaction flows

**Apply an op:**
```
user selects cells → types operand → clicks × →
  if previewBeforeApply: build CellPatch[] → show preview table → user clicks Apply →
    executeApply() → applyEdits(api, targets, op, value, { journal, patches })
  else if targetCount > confirmThreshold: AlertDialog "Apply to N cells?" → Apply
  else: apply immediately
```

**Set… (value picker):**
```
click [Set…] → modal opens → user types value (K/M/B parsing if enabled, e.g. "1.5M" → 1500000) →
  click Apply → same preview/confirm pipeline → applyEdits with op='set'
```

**Selection changes:**
```
selection changes upstream → count meta updates ("47 cells · 1 col") →
  operand input doesn't reset (preserves user's draft)
```

## Engine wiring

- **State**: `SmartEditState` (settings)
- **Targets**: `resolveTargetCells(api)` → active selection cells filtered to numeric + editable
- **Patches**: `buildSmartEditPatches(targets, op, value)` → `CellPatch[]`
- **Commit**: `applyEdits(api, targets, op, value, { journal, patches })` — async, optional journal recording
- **Preview**: `previewPatches(patches)` → `{ results, allInvalid, someInvalid }`
- **Validation**: `enforceSingleColumn` checked upfront; if violated, tooltip explains constraint

## Shared primitives used

- **EditingToolbarSegment** — wrapper layout (reused by bulk-update + edit-history toolbars)
- **EditingToolbarOpButton** — symbol vs label rendering
- **EditingToolbarOpGroup** — horizontal cluster for operator buttons
- Dialog, AlertDialog — popover modals
- Table primitives — preview grid

## Design decisions worth copying

1. **Deferred mutations via patches.** Toolbar never mutates the grid directly. Builds `CellPatch[]`, shows preview, then passes patches to engine's `applyEdits()` for atomic commit. Decouples UI preview from engine validation.

2. **Optional journal recording.** Each operation can log to undo journal — caller passes `recordHistory` setting; toolbar respects it without knowing journal shape.

3. **Arithmetic guards upfront.** `enforceSingleColumn` checked before showing preview. If violated, tooltip explains. Saves the user a confirm-dialog frustration.

4. **Two-stage preview/confirm.** Preview = "see what will happen"; confirm = "this is a lot of cells, sure?". Different concerns, two layers.

5. **K/M/B parsing in Set… dialog.** Same magnitude parser used by inline cell editors. Familiar input syntax across the app.

## cgrid translation

1. **`<cgrid-smart-edit-toolbar>`** as a Lit element.
2. **`<cgrid-editing-toolbar-segment>`** — shared chrome for smart-edit, bulk-update, edit-history toolbars. Build once.
3. **`<cgrid-op-toggle-group>`** — reused from [shortcuts editor](07-shortcuts.md).
4. **Engine wiring**: `applyEdits()` lives in editing-core (Phase 0). This toolbar generates patches and feeds them in.
5. **Preview dialog**: a Lit `<dialog>` (or `<wa-dialog>`) with a table.

Build in Phase 5 after editing-core is ready.
