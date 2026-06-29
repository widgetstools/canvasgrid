# 01 — editing-core

> Foundation module. **Build this first.** Smart-edit, bulk-update, plus-minus, shortcuts, and data-change-history all sit on top.

## Purpose

Provides the transactional write primitives — cell patches, undo/redo journal, batch application — that every editing feature reuses. Decouples *who computes an edit* from *how the grid applies it*.

## Core types

```ts
interface CellPatch {
  rowId: string;          // stable row identifier
  colId: string;          // column id
  field: string;          // backing data field
  oldValue: unknown;
  newValue: unknown;
}

interface EditJournalEntry {
  id: string;
  timestamp: number;
  source: EditSource;     // who created the patch (see below)
  label: string;          // human-readable, e.g. "Multiply by 2"
  patches: CellPatch[];   // atomic batch
}

type EditSource =
  | 'smart-edit'
  | 'bulk-update'
  | 'plus-minus'
  | 'shortcut'
  | 'cell-editor'
  | 'stream';             // ticker / applyTransaction (off by default)

type EditValidationResult = 'valid' | 'invalid' | 'warning';
```

## Grid writer contract

The journal does not import AG Grid. It writes through a tiny interface:

```ts
interface EditGridWriter {
  applyTransactionAsync(update: RowUpdate[]): Promise<void>;
  getRowNode(rowId: string): { data: unknown } | null;
}
```

Patches are aggregated into row-shaped objects (`{ rowId, [field1]: newValue, [field2]: newValue }`) before calling `applyTransactionAsync` — one network/worker round-trip per journal entry, not one per patch.

## Journal API

```ts
class EditJournal {
  constructor(config?: { limit?: number; monitorLimit?: number });
  record(entry: { source, label, patches });   // pushes onto past[], clears future[]
  undo(): void;                                 // pop past → push future, apply reversed patches
  redo(): void;
  undoEntry(entryId: string): void;             // cascade: undo this AND all later entries
  subscribe(listener): () => void;
}
```

Two stacks (`past[]`, `future[]`) bounded by `limit` (default 50). Recording after an undo clears the redo stack. Monitor list (default 100) is a separate audit trail decoupled from the undo cap — you can review history beyond what you can redo.

## Cascade undo

Unlike linear stacks, `undoEntry(id)` rolls back to a specific prior entry by undoing it and everything that came after. Drives "undo this edit from 2 minutes ago" UX patterns. Implementation: pop entries off `past[]` until the target id pops, applying reversed patches as we go.

## Validation

```ts
function previewPatches(api, patches, validator?): {
  total: number;
  valid: number;
  invalid: number;
  warnings: number;
  rows: PreviewRow[];   // per-cell classification for UI table
};
```

UI calls `previewPatches()` before applying — shows red/yellow/green counts in a confirmation dialog. `combineValidators(a, b, c)` chains rules with fail-fast on `invalid` and worst-of semantics for `warning`.

## Public helpers

| Helper | Purpose |
|---|---|
| `buildPatchesFromTargets(cells, computeFn)` | Map target cells to patches via a per-cell computation |
| `dedupePatches(patches)` | Last-write-wins by `rowId+colId` |
| `buildRowUpdatesFromPatches(patches, rowIdField)` | Aggregate per-row for transaction |
| `applyPatches(api, patches, direction, rowIdField)` | Apply (`'forward'` or `'undo'`) — undo flips oldValue/newValue |
| `applyForwardPatches(api, patches, ...)` | Convenience wrapper |
| `assertSingleColumnSelection(targets)` | Guard for one-column-at-a-time policy |

## Persistence

**None.** Journal is session-only in-memory. Profile-level audit/recording control lives in [data-change-history](11-data-change-history.md).

## Reference files

- [../starui/packages/shared/engine/src/customizer/modules/editing-core/EditJournal.ts](../../../starui/packages/shared/engine/src/customizer/modules/editing-core/EditJournal.ts)
- [../starui/packages/shared/engine/src/customizer/modules/editing-core/types.ts](../../../starui/packages/shared/engine/src/customizer/modules/editing-core/types.ts)
- [../starui/packages/shared/engine/src/customizer/modules/editing-core/buildRowUpdates.ts](../../../starui/packages/shared/engine/src/customizer/modules/editing-core/buildRowUpdates.ts)
- [../starui/packages/shared/engine/src/customizer/modules/editing-core/previewPatches.ts](../../../starui/packages/shared/engine/src/customizer/modules/editing-core/previewPatches.ts)

## Design decisions worth copying

- **Patch-first design.** Editing features generate `CellPatch[]`. They don't talk to the grid directly. This is what makes them all undoable, validatable, and auditable with zero per-module wiring.
- **Dual-stack undo/redo.** Standard but worth stating: don't try to be clever with a single ring buffer.
- **Cascade undo by entry ID.** Adds 20 lines of code and unlocks substantial UX.
- **Validator composition.** Decouples editing modules from validation rules (alerts, conditional-styling, business logic) — each contributes a validator, journal composes them.
- **Monitor list ≠ undo stack.** Auditing wants more depth than undo. Two bounded lists, two limits.

## cgrid translation

The grid-writer contract needs to map onto cgrid's worker-backed row updates:

```ts
class CGridEditWriter implements EditGridWriter {
  constructor(private grid: CGrid) {}
  async applyTransactionAsync(updates: RowUpdate[]) {
    // route through worker; cgrid currently does this via `applyRowData` patches
  }
  getRowNode(rowId: string) {
    return this.grid.getRowById(rowId);   // need accessor — verify it exists
  }
}
```

Things to verify in cgrid:
- Is there a stable `getRowById(rowId)` accessor today? (Likely — `getRowId` is in `initialOnlyOptions`.)
- Does cgrid emit a "cell value changed" event with old + new value? Both conditional-styling and alerts will need this. If only the new value is exposed today, the worker needs a small change to surface the prior value too.
- Worker round-trip cost: 50ms-ish for large `applyTransactionAsync` calls is fine; smart-edit batches make this a non-issue. Single-cell typed edits should be near-instant.
