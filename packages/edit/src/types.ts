// @cgrid/edit — public types.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §2.2
// (core models, copied verbatim) + §2.3 (engine discipline).

export interface CellPatch {
  rowId: string; colId: string; field: string;
  oldValue: unknown; newValue: unknown;
}
export interface EditJournalEntry {
  id: string;                 // journal-assigned, monotonic per session
  timestamp: number;          // HOST-STAMPED via injectable now() — engine stays Date-free
  source: EditSource;
  label: string;              // "× 1.1", "Set Status = Approved", "Qty +1"
  patches: CellPatch[];       // atomic batch
}
export type EditSource =
  | 'smart-edit' | 'bulk-update' | 'plus-minus' | 'shortcut' | 'cell-editor' | 'stream';

export interface DataChangeHistorySettings {
  enabled: boolean;             // default true
  maxEntries: number;           // default 50 (undo depth); monitor list separately capped (100)
  suspended: boolean;           // pause recording, KEEP past entries (≠ disabled)
  /** When true, EditJournal owns undo (Markets unifyUndo). Persisted for
   *  profile parity; hosts may disable native cell-undo when this is on. */
  unifyUndo: boolean;           // default true
  recordSources: { smartEdit: boolean; bulkUpdate: boolean; plusMinus: boolean;
                   shortcuts: boolean; cellEditor: boolean; stream: boolean };  // stream default FALSE
}
export interface SmartEditSettings {
  enabled: boolean; incrementStep: number;            // default 1
  magnitudeShortcutsEnabled: boolean;                 // K/M/B valueParser wrap
  enabledOps: SmartEditOp[];                          // default all five
  confirmThreshold: number;                           // 0 = never
  enforceSingleColumn: boolean;                       // default true
  previewBeforeApply: boolean; recordHistory: boolean;
}
export type SmartEditOp = 'multiply' | 'divide' | 'add' | 'subtract' | 'set';
export interface BulkUpdateSettings {
  enabled: boolean; confirmThreshold: number;
  showDistinctValues: boolean; maxDropdownValues: number;   // default 20
  enforceSingleColumn: boolean; recordHistory: boolean;
}
export interface PlusMinusNudge {
  id: string; name: string; enabled: boolean;
  scope: { columnIds: string[] };      // empty = all numeric editable; matches colId OR field
  expression?: string;                 // optional row gate; ctx {data, x, value}; falsy/throw = skip
  incrementStep: number; decrementStep?: number;      // defaults to incrementStep
}
export interface ShortcutDefinition {
  id: string; name: string; enabled: boolean;
  shortcutKey: string;                 // /^[a-z]$/ stored; matched case-insensitively
  operation: 'add' | 'subtract' | 'multiply' | 'divide';
  shortcutValue: number;               // negative/fractional allowed
  scope: { columnIds: string[] };
}

// ─── Feature-level settings (task 1 extension — not spelled out verbatim in
//     §2.2's model block but required by the `EditSettings` aggregate below) ──

/** Global plus/minus feature toggle + history recording. */
export interface PlusMinusSettings {
  enabled: boolean;
  recordHistory: boolean;
}

/** Global shortcuts feature toggle + history recording. */
export interface ShortcutsSettings {
  enabled: boolean;
  recordHistory: boolean;
}

// ─── Validation ────────────────────────────────────────────────────────────

/** Verdict returned by a `PatchValidator` for a single candidate patch. */
export type EditValidationResult = 'valid' | 'invalid' | 'warning';

/** Plugs into the (later-task) commit pipeline to gate/flag individual patches. */
export type PatchValidator = (patch: CellPatch) => EditValidationResult;

// ─── Aggregate settings ─────────────────────────────────────────────────────

/** One slice per editing-op family; `DEFAULT_EDIT_SETTINGS` / `mergeEditSettings`
 *  in settings.ts own its defaults and defensive-merge discipline (spec §1.1.8). */
export interface EditSettings {
  history: DataChangeHistorySettings;
  smartEdit: SmartEditSettings;
  bulkUpdate: BulkUpdateSettings;
  plusMinus: PlusMinusSettings;
  shortcuts: ShortcutsSettings;
}
