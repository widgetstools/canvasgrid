# 11 — Data Change History

> Settings + live monitor. Configure recording behavior and view the actual journal entries with per-entry undo.

Engine module: [data-change-history](../starui-customizer/11-data-change-history.md) (consumer of [editing-core](../starui-customizer/01-editing-core.md))

## Purpose

Configure the edit journal — recording on/off, suspend, max entries, unify-undo, which sources to record. Plus a live monitor showing recent journal entries with per-entry undo buttons.

## Invocation

Settings Sheet → Editing → Edit History.

## Layout

```
┌─────────────────────────────────────────────┐
│ Edit History              [Reset]  [Save]   │
├─────────────────────────────────────────────┤
│ 01 GLOBAL                                   │
│   ENABLED         [toggle]                  │
│   SUSPENDED       [toggle]                  │
│   MAX ENTRIES     [number: 50, min 5]       │
│   UNIFY UNDO      [toggle] (hint)           │
├─────────────────────────────────────────────┤
│ 02 RECORD SOURCES                           │
│   SMART EDIT      [toggle]                  │
│   BULK UPDATE     [toggle]                  │
│   PLUS / MINUS    [toggle]                  │
│   SHORTCUTS       [toggle]                  │
│   CELL EDITOR     [toggle]                  │
│   STREAM UPDATES  [toggle]                  │  (live ticker writes — off by default)
├─────────────────────────────────────────────┤
│ ─── monitor divider ──────                  │
├─────────────────────────────────────────────┤
│ 03 MONITOR                                  │
│   ┌───────────────────────────────────────┐ │
│   │ Smart Edit · 23:45 · ×2 (47 cells)    │ │
│   │                              [Undo]    │ │
│   │ Stream · 23:44 · 12 cell updates       │ │
│   │                              [Undo]    │ │
│   │ Cell Editor · 23:42 · qty=15          │ │
│   │                              [Undo]    │ │
│   │ (scrollable, most recent first)        │ │
│   └───────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Component tree

- **DataChangeHistoryPanel** (memo, no props)
  - ObjectTitleRow ("Edit History" + Save/Reset)
  - Flex container (column):
    - Scrollable settings area
      - Band 01 GLOBAL → 4 SettingsRows
      - Band 02 RECORD SOURCES → 6 SettingsRows (one per source)
    - Monitor section (flex-shrink: 0, top border)
      - Band 03 MONITOR (flush layout)
        - **EditHistoryMonitor**
          - Entries list (most recent first)
          - Per-entry: source label + time + label + [Undo] button

## Props

None.

## Internal state

- `draft: DataChangeHistorySettings`
- `dirty: boolean`
- `journal: EditJournal` (from `useEditJournal()`)

## Interaction flows

**Live suspend sync (not deferred to Save):**
```
toggle SUSPENDED → updateSetting('suspended', v) →
  useSyncJournalSuspend(draft.suspended) syncs to live journal IMMEDIATELY (not on Save)
```

This is special — most settings wait for Save. Suspended syncs live because users want to pause recording NOW (e.g., before a bulk import they don't want logged).

**Other settings:**
```
toggle ENABLED / source toggle → updateSetting(key, v) → Save commits
adjust MAX ENTRIES → updateSetting('maxEntries', v)
toggle UNIFY UNDO → updateSetting('unifyUndo', v)
```

**Undo an entry:**
```
[Undo] on entry → undoEntry(entryId) → journalUndoEntry(platform, journal, api, entryId) →
  cascade undo: this entry AND all later ones (per editing-core semantics)
```

## Engine wiring

- **Settings state**: `DataChangeHistoryState` (moduleId=`DATA_CHANGE_HISTORY_MODULE_ID`, itemId='settings')
- **Live journal**: `useEditJournal()` returns the current `EditJournal` from editing-core
- **Live suspend**: `useSyncJournalSuspend(value)` writes through to the journal immediately
- **Undo callback**: `journalUndoEntry(platform, journal, api, entryId)` is a side-effect function

## Shared primitives used

- ObjectTitleRow, Band, SettingsRow
- BoolControl, NumberControl
- **EditHistoryMonitor** (custom — entry list with per-row undo button)

## Design decisions worth copying

1. **Live suspend sync (deferred everything else).** Settings normally wait for Save. Suspend is the exception because the user's intent is "stop recording NOW." Recognize when an immediate-effect makes more sense than a deferred-effect.

2. **Monitor as a separate section anchored at the bottom.** Settings scroll; monitor stays visible. Lets users adjust recording config while watching journal entries flow.

3. **Per-source toggles.** Six checkboxes (smartEdit, bulkUpdate, plusMinus, shortcuts, cellEditor, stream). Users opt out of noisy sources (typically stream).

4. **Stream off by default.** Live tickers can flood the journal. Default off; user opts in for debugging.

5. **Cascade undo from a specific entry.** "Undo this 5-edit-old entry" rolls back this AND everything since. Matches user mental model better than "undo last 5 things one at a time."

## cgrid translation

1. **`<cgrid-data-change-history-panel>`** as the main panel.
2. **`<cgrid-edit-history-monitor>`** as the live entries list. Subscribes to the journal via a Lit context.
3. **Engine wiring**: build editing-core first (the `EditJournal` class + dirty bus). This panel is just a settings + monitor on top.
4. **Live suspend hook** = a method on the Lit controller that calls `journal.setSuspended(value)` directly (bypassing the draft).

Build in Phase 1 alongside the editing-core foundation.
