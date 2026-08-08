// @wellsfargo-starui/velocity-grid-edit — public re-exports.
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

export {
  collectBulkUpdateTargets,
  bulkUpdateValueKind,
  parseBulkUpdateValue,
  buildBulkUpdatePatches,
  makeDistinctValuesFeed,
} from './bulkUpdate';

export { makeExpressionEvaluate, resolveNudgeForCell, buildNudgePatches } from './plusMinus';
export type { NudgeEvaluate } from './plusMinus';

export {
  collectShortcutKeys,
  matchShortcutForCell,
  buildShortcutPatches,
  detectShortcutConflicts,
} from './shortcuts';

export { wireEditIntoKernel } from './bridge';
export type { WireEditOptions, EditBridgeHandle } from './bridge';
