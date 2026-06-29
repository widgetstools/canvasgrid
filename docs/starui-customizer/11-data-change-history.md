# 11 — data-change-history

> Tiny settings module. Decides which edit-source events the [edit journal](01-editing-core.md) records. ~70 lines total.

## Purpose

Let users configure the undo/redo and audit-log behavior — stack depth, which edit sources to capture, whether to suspend recording, whether to replace AG-Grid's built-in undoRedo with the unified journal.

## Config schema

```ts
interface DataChangeHistoryState {
  settings: DataChangeHistorySettings;
}

interface DataChangeHistorySettings {
  enabled: boolean;                  // master switch
  maxEntries: number;                // undo/redo stack depth (default 50)
  suspended: boolean;                // pause recording without dropping past entries
  unifyUndo: boolean;                // when true, disable AG-Grid's undoRedoCellEditing and route through this journal
  recordSources: {
    smartEdit: boolean;
    bulkUpdate: boolean;
    plusMinus: boolean;
    shortcuts: boolean;
    cellEditor: boolean;
    stream: boolean;                 // off by default — live ticker writes
  };
}
```

## Runtime behavior

The module itself does nothing at runtime beyond holding settings. The heavy lifting is in [editing-core](01-editing-core.md)'s `EditJournal`. data-change-history is a **consumer** of the journal that filters which source events get recorded.

```ts
// In the journal recorder:
function shouldRecord(source: EditSource, settings: DataChangeHistorySettings): boolean {
  if (!settings.enabled || settings.suspended) return false;
  const key = recordSourceKey(source);   // 'smart-edit' → 'smartEdit', etc.
  return settings.recordSources[key];
}
```

## Source key mapping

`recordSourceKey()` translates between editing-core's kebab-case `EditSource` enum and the camelCase config keys (e.g., `'smart-edit'` → `'smartEdit'`). Keeps the config schema UI-friendly while the engine uses string IDs.

## UI surface

None in engine. Host renders:
- History/audit panel: list of journal entries with timestamp, source, label, undo/redo buttons
- Settings dialog: stack depth slider, source toggles, unify-undo checkbox

## Persistence

Settings only. Undo/redo entries live in-memory; never persisted.

## Dependencies

- [editing-core](01-editing-core.md): `EditSource` enum; `EditJournal` is the actual machinery

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/data-change-history/state.ts](../../../starui/packages/shared/engine/src/customizer/modules/data-change-history/state.ts)

## Design decisions worth copying

- **Stream source off by default.** Live ticks and `applyTransaction`-style writes flood the journal if recorded. Default off; users opt in for debugging.
- **Suspended vs disabled distinction.** Suspended preserves past entries (you can still undo old edits); disabled drops everything. Different UX intentions, both useful.
- **unifyUndo flag.** Lets users choose: AG-Grid's native undo (per-cell) OR the unified journal (per-batch). Defaults to unified because batch undo matches user mental model (`smart-edit ×2` should undo as one operation, not 50).
- **Lightweight config carrier.** No transforms, no runtime. The module exists purely to namespace a settings slice so the host can build a config UI without knowing about journal internals.
- **Defensive deserialization.** Unknown sources silently skipped; partial settings merged over defaults.

## cgrid translation

Build editing-core first, then this module drops in. ~50 LOC of config + a `shouldRecord` helper the journal consults on every `record()` call.

cgrid's "stream" source equivalent is worker-driven `applyRowData` updates (live data feeds). Default off, same as starui.

The `unifyUndo` flag is moot if cgrid's editing surface doesn't have a separate per-cell undo to compete with. If cgrid only ever uses the journal, simplify and drop the flag.
