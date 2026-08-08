// @wellsfargo-starui/velocity-grid-edit — settings defaults, defensive merge, shouldRecord.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md
// §1.1.8 (merge discipline) + docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.2 (shouldRecord).

import type {
  EditSettings,
  DataChangeHistorySettings,
  SmartEditSettings,
  SmartEditOp,
  BulkUpdateSettings,
  PlusMinusSettings,
  ShortcutsSettings,
  EditSource,
} from './types';

/** Structural deep-partial: every property, at every depth, becomes optional.
 *  No external dep — scoped to this module's merge needs. */
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

const SMART_EDIT_OPS: readonly SmartEditOp[] = ['multiply', 'divide', 'add', 'subtract', 'set'];

export const DEFAULT_EDIT_SETTINGS: EditSettings = {
  history: {
    enabled: true,
    maxEntries: 50,
    suspended: false,
    unifyUndo: true,
    recordSources: {
      smartEdit: true,
      bulkUpdate: true,
      plusMinus: true,
      shortcuts: true,
      cellEditor: true,
      stream: false,
    },
  },
  smartEdit: {
    enabled: true,
    incrementStep: 1,
    magnitudeShortcutsEnabled: true,
    enabledOps: ['multiply', 'divide', 'add', 'subtract', 'set'],
    confirmThreshold: 0,
    enforceSingleColumn: true,
    previewBeforeApply: true,
    recordHistory: true,
  },
  bulkUpdate: {
    enabled: true,
    confirmThreshold: 0,
    showDistinctValues: true,
    maxDropdownValues: 20,
    enforceSingleColumn: true,
    recordHistory: true,
  },
  plusMinus: { enabled: true, recordHistory: true },
  shortcuts: { enabled: true, recordHistory: true },
};

/** Defensive deserialization for persisted/host-supplied settings (spec §1.1.8).
 *  Plain per-slice shallow merge over `DEFAULT_EDIT_SETTINGS`, except:
 *  - `history.recordSources`: merged key-by-key against the six known keys —
 *    unknown keys in the input are dropped, not carried through.
 *  - `smartEdit.enabledOps`: replaced wholesale when present, filtered against
 *    the `SmartEditOp` union; if filtering leaves it empty, falls back to defaults. */
export function mergeEditSettings(partial?: DeepPartial<EditSettings>): EditSettings {
  const defaults = DEFAULT_EDIT_SETTINGS;

  const historyPartial = partial?.history;
  const recordSourcesPartial = historyPartial?.recordSources;
  const history: DataChangeHistorySettings = {
    enabled: historyPartial?.enabled ?? defaults.history.enabled,
    maxEntries: historyPartial?.maxEntries ?? defaults.history.maxEntries,
    suspended: historyPartial?.suspended ?? defaults.history.suspended,
    unifyUndo: historyPartial?.unifyUndo ?? defaults.history.unifyUndo,
    recordSources: {
      smartEdit: recordSourcesPartial?.smartEdit ?? defaults.history.recordSources.smartEdit,
      bulkUpdate: recordSourcesPartial?.bulkUpdate ?? defaults.history.recordSources.bulkUpdate,
      plusMinus: recordSourcesPartial?.plusMinus ?? defaults.history.recordSources.plusMinus,
      shortcuts: recordSourcesPartial?.shortcuts ?? defaults.history.recordSources.shortcuts,
      cellEditor: recordSourcesPartial?.cellEditor ?? defaults.history.recordSources.cellEditor,
      stream: recordSourcesPartial?.stream ?? defaults.history.recordSources.stream,
    },
  };

  const smartEditPartial = partial?.smartEdit;
  const requestedOps = smartEditPartial?.enabledOps as SmartEditOp[] | undefined;
  const filteredOps = requestedOps?.filter((op) => SMART_EDIT_OPS.includes(op));
  const smartEdit: SmartEditSettings = {
    ...defaults.smartEdit,
    ...smartEditPartial,
    enabledOps: filteredOps && filteredOps.length > 0 ? filteredOps : [...defaults.smartEdit.enabledOps],
  };

  const bulkUpdate: BulkUpdateSettings = { ...defaults.bulkUpdate, ...partial?.bulkUpdate };
  const plusMinus: PlusMinusSettings = { ...defaults.plusMinus, ...partial?.plusMinus };
  const shortcuts: ShortcutsSettings = { ...defaults.shortcuts, ...partial?.shortcuts };

  return { history, smartEdit, bulkUpdate, plusMinus, shortcuts };
}

/** kebab-case `EditSource` wire values → their `recordSources` key. Exhaustive
 *  switch (never-default) so a future `EditSource` union member fails to compile here. */
export function recordSourceKey(source: EditSource): keyof DataChangeHistorySettings['recordSources'] {
  switch (source) {
    case 'smart-edit': return 'smartEdit';
    case 'bulk-update': return 'bulkUpdate';
    case 'plus-minus': return 'plusMinus';
    case 'shortcut': return 'shortcuts';
    case 'cell-editor': return 'cellEditor';
    case 'stream': return 'stream';
    default: {
      const exhaustive: never = source;
      throw new Error(`unreachable EditSource: ${String(exhaustive)}`);
    }
  }
}

/** recon A.2: disabled or suspended history never records, regardless of source;
 *  otherwise the per-source `recordSources` flag decides. */
export function shouldRecord(source: EditSource, settings: DataChangeHistorySettings): boolean {
  if (!settings.enabled || settings.suspended) return false;
  return settings.recordSources[recordSourceKey(source)];
}
