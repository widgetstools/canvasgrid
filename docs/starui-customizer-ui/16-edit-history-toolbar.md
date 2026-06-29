# 16 — Edit History Toolbar

> Tiniest toolbar. Undo + Redo + entry count.

Engine modules: [editing-core](../starui-customizer/01-editing-core.md) + [data-change-history](../starui-customizer/11-data-change-history.md). See [11-data-change-history](11-data-change-history.md) for the settings panel.

## Purpose

Global undo/redo for all cell edits, with current entry count displayed inline.

## Invocation

Optional row in the editing toolbar (visible when `DataChangeHistoryState.enabled`). Usually persistent alongside smart-edit and bulk-update toolbars.

## Layout

```
[History] [⟲ Undo] [⟳ Redo] ← {N} entries
```

Buttons disabled when nothing to undo/redo.

## Component tree

- **EditHistoryToolbar** → thin wrapper
- **EditHistoryToolbarBody**
  - EditingToolbarSegment (chrome) with meta showing entry count
  - EditingToolbarOpGroup — clusters the two buttons
  - EditingToolbarIconButton × 2 — Undo2 / Redo2 icons (lucide)
  - Tooltip on each — action descriptions

## Props

`EditHistoryToolbarBody({ layout? })` — `'standalone' | 'segment'`.

## Internal state

None local. Reads `journal.canUndo` / `journal.canRedo` from the live edit journal.

## Interaction flows

**Edit happens (upstream):**
```
user edits cell → entry added to journal undo stack → entry count increments → meta refreshes
```

**Undo:**
```
click Undo → journalUndo(platform, journal, api) → reverses last edit → moves entry to redo stack
```

**Redo:**
```
click Redo → journalRedo() → re-applies last undone edit → moves entry back to undo stack
```

## Engine wiring

- **State**: `DataChangeHistoryState.enabled` (toolbar visibility)
- **Journal**: `useEditJournal()` → live edit journal from editing-core
- **Stack size**: `journalUndoStackSize(journal)` for display
- **Operations**: `journalUndo(platform, journal, api)` / `journalRedo()` — async

## Shared primitives used

- EditingToolbarSegment, EditingToolbarOpGroup, EditingToolbarIconButton
- Tooltip

## Design decisions worth copying

1. **Journal as a black box.** Toolbar never reads journal's internal structure. Just calls `journalUndo()` / `journalRedo()` and checks `canUndo` / `canRedo`. Keeps journal implementation flexible.

2. **Minimal chrome.** Two buttons + count. No "Clear history" or "Show entries" — those live in the [data-change-history panel](11-data-change-history.md). Don't duplicate.

3. **Count in segment label.** "History · 24 entries" — at-a-glance "is there much to undo?" signal.

## cgrid translation

Trivial. ~50 LOC of Lit.

1. **`<cgrid-edit-history-toolbar>`** with two icon buttons + meta label.
2. **Subscribe to editing-core's journal** via Lit context — re-render when stack size changes.
3. Build in Phase 1 alongside editing-core; this toolbar is a great end-to-end smoke test that the journal works.
