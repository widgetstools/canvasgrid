# 13 — Formatting Toolbar

> The composite formatting UI. Same component renders inline as a toolbar AND as a popped-out OS window via [Poppable](00-foundations.md#2-floating-windows-poppable--popoutportal). Composes 8 modules (Type, Format, Color, Paint, Context, Library, Clear, Grouping).

Engine modules touched: [column-customization](../starui-customizer/05-column-customization.md), [column-templates](../starui-customizer/07-column-templates.md), and value formatting plumbing across several modules.

## Purpose

Quick-apply formatting (typography, color, format, filter, editor, grouping) to the current selection — without opening the full Column Settings panel. Save / apply / manage reusable templates. Pop out to a dedicated inspector window for sustained styling work.

## Invocation

- Inline: grid toolbar → style-paint icon (always-visible toolbar row)
- Popped out: external-link icon on the inline toolbar → opens OS window with the same modules vertically stacked

## Layout — inline (horizontal)

```
Row 1: [Scope ▼] [Type ▼] [Paint color]
Row 2: [Format ▼▼] [Edit ▼] [Group ▼] [Templates +] [Clear 🗑] [⎋ popout]
```

## Layout — popped out (vertical inspector)

```
┌─ Formatting — gridId ─────────────┐
│ [Scope ▼]                         │
├───────────────────────────────────┤
│ Type ▼                            │
│ Paint color picker                │
│ Format ▼ currency 2dp             │
│ Edit ▼ template picker            │
│ Group ▼ agg function              │
│ Templates: [saved list]           │
├───────────────────────────────────┤
│ Clear all _____ [confirm]         │
└───────────────────────────────────┘
```

Same 8 modules; different sequence + layout.

## Component tree

- **FormattingToolbar** → entry point, wraps **Poppable**
- **Poppable** → render-props
  - When `!popped`: **FormatterToolbar** (horizontal row layout)
  - When `popped`: **FormatterPanel** (vertical inspector)
- Both surfaces compose 8 module components:
  - **ModuleContext** — scope toggles (cell, row, column, all)
  - **ModuleType** — cell-data-type selector
  - **ModulePaint** — color / fill picker
  - **ModuleFormat** — Excel format + currency quick-insert
  - **ModuleEditorFilter** — filter condition builder
  - **ModuleGrouping** — row group + aggregate function
  - **ModuleLibrary** — TemplateManager (saved templates)
  - **ModuleClear** — destructive clear-all action with confirm

## Props

- `FormattingToolbar`: empty interface (shape reserved for wrapping by design system)
- `FormatterToolbar`: `{ state, actions, popoutSlot? }`
- `FormatterPanel`: `{ state, actions, frameless?, onClose?, titleText? }`
- `Poppable`: `{ name, title, width, height, alwaysOnTop?, frame?, expandedHeight?, onClose?, children }`

## Internal state (via `useFormatter()` context)

- `state`: selection context (colLabel, rowCount, scope), per-module settings (format, type, paint colors, filters, group config)
- `actions`: apply/revert per-module settings, undo/redo, save/load templates, clear

Module-level draft state lives in each module component; no cross-module shared mutable state above.

## Interaction flows

**Cell or column selection → quick format:**
```
user selects → modules populate based on selection →
  user picks "Currency" in ModuleFormat → preview updates inline →
  click "Apply" (or some modules commit immediately for style)
```

**Popout toggle:**
```
inline → click external-link icon → setPopped(true) →
  PopoutPortal opens OS window → same module tree renders inside →
  window stays on top (OpenFin) or floats (browser) →
  user adjusts → close button or window.close() → onClose fires → setPopped(false) → back to inline
```

**Template save:**
```
no active template → click "Save" → inline input appears → type name →
  click [+] → snapshot of current formatter state → saved to profile →
  future selections can apply with one click
```

**Clear all:**
```
ModuleClear → click "Clear all" → confirmation chip appears →
  click "Confirm" → applyClearAll() resets all module settings for the current selection
```

## Engine wiring

- `useFormatter()` → `FormatterState` from engine (current selection, applied style, pending edits)
- `FormatterActions` mutations:
  - Apply/revert style changes (per module)
  - Manage templates (snapshot / apply / delete)
  - Trigger undo/redo
- All mutations flow through actions; modules never write engine state directly
- Selection changes upstream trigger re-render; modules are pure functions of state

## Shared primitives used

- **Poppable** (the star primitive here)
- **PopoutPortal**
- **TemplateManager** (in ModuleLibrary)
- **FormatterPicker** (compact in ModuleFormat)
- **ColorPicker** (in ModulePaint)
- **StyleEditor**? (No — modules handle styling individually; full StyleEditor is used in [Column Settings](01-column-settings.md))
- ToolbarGroup / PanelGroup — section headers in toolbar vs panel orientation
- ModuleDivider — visual separation between groups
- TitleBar — custom draggable chrome for frameless popouts

## Design decisions worth copying

1. **Orientation-agnostic module composition.** Each module exports a single render function ignoring orientation. The two top-level shells (`FormatterToolbar`, `FormatterPanel`) choose sequence + grouping. Modules don't know horizontal vs vertical; CSS flex handles layout. **Decouples polish from module logic.**

2. **Poppable as a render-props primitive.** Factored out for reuse by future toolbars. Caller passes a function receiving `{ popped, PopoutButton, close }`; Poppable toggles the tree's location without re-mounting. Same tree, two places.

3. **Selection-driven UI.** Each module reads `FormatterState.selection` and disables controls when selection doesn't support the operation (e.g., "Set row height" disabled when cells are selected). Declarative — no imperative enable/disable plumbing.

4. **Templates as immutable snapshots.** Each template = `{ id, name, settings: serializedBlob }`. UI never mutates templates directly; takes a new snapshot. Keeps undo/redo + profile sync simple.

5. **Same React tree, two locations.** Popping out doesn't re-mount; React contexts (theme, store, profile) flow through unchanged. State updates instantly reflect in both places.

6. **Auto-grow window on popover open.** When a Radix popover inside the popout opens (e.g., color picker), the window auto-grows to `expandedHeight` so the popover doesn't get clipped. Shrinks back when closed.

## cgrid translation

The most architecturally interesting editor. Build last (Phase 5).

1. **`<cgrid-formatting-toolbar>`** wraps a `<cgrid-poppable>` element. The Poppable has two slots: `inline` and `popout`.
2. **`<cgrid-formatter-toolbar>`** (horizontal layout) and **`<cgrid-formatter-panel>`** (vertical) — two shells that compose the same 8 module elements.
3. **8 module Lit components**: `<cgrid-fmt-context>`, `<cgrid-fmt-type>`, `<cgrid-fmt-paint>`, `<cgrid-fmt-format>`, `<cgrid-fmt-editor-filter>`, `<cgrid-fmt-grouping>`, `<cgrid-fmt-library>`, `<cgrid-fmt-clear>`. Each is selection-aware (reads from a `<cgrid-formatter-context>` provider).
4. **Poppable in Lit**: 
   - Element with `inline` and `popout` slots
   - When toggled to popout: `window.open()` + move slot contents to popout's document (preserving DOM nodes for state continuity)
   - Use `@lit/context` to propagate state across the realm boundary (works because both windows share the main JS context — same as React contexts)
5. **PopoutPortal in Lit**: lifecycle wrapper. `MutationObserver` for popover-open detection (auto-grow), `pagehide` listener for cleanup, name registry to prevent dupes.
6. **TemplateManager + FormatterPicker + ColorPicker** must be ready (Phase 3).

This is the biggest UX win — popped-out inspector is essential for sustained formatting work. Don't skip it.
