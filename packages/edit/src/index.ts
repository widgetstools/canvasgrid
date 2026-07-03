// @cgrid/edit — public re-exports.
// See docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md.

export {
  DEFAULT_EDIT_SETTINGS,
  mergeEditSettings,
  recordSourceKey,
  shouldRecord,
} from './settings';
export type { DeepPartial } from './settings';

export type {
  CellPatch,
  EditJournalEntry,
  EditSource,
  DataChangeHistorySettings,
  SmartEditSettings,
  SmartEditOp,
  BulkUpdateSettings,
  PlusMinusNudge,
  PlusMinusSettings,
  ShortcutDefinition,
  ShortcutsSettings,
  EditValidationResult,
  PatchValidator,
  EditSettings,
} from './types';

export { EditJournal } from './journal';
export type { EditJournalOptions } from './journal';

export {
  dedupePatches,
  buildPatchesFromTargets,
  buildRowUpdatesFromPatches,
  assertSingleColumnSelection,
} from './patches';
export type { CellTarget } from './patches';

export { previewPatches, combineValidators } from './preview';
export type { PreviewRow } from './preview';

export { applyNumericOp, isNumericCellDataType } from './numericOps';

export { collectTargetCells, buildSmartEditPatches } from './smartEdit';
export type { TargetSurface } from './smartEdit';

export { parseMagnitudeSuffix, applyMagnitudeColDefTransforms } from './magnitude';
