// Merged ColumnOverride → kernel pre-resolve ColDef patch.
//
// Target keys VERIFIED against packages/kernel/src/types/column.ts
// (2026-07-02): `headerName` (:97), `width` (:98), `valueFormatter` — string
// form compiles via @cgrid/format at ColDef-resolve time (:126-128),
// `cellRenderer` (:151), `editable` (:272), `cellStyle` (:348), `hide` (:421).
// Patches write the LIVE `hide`/`width` keys, never `initialHide` (:427) /
// `initialWidth` (:437): initial* is first-construction-only and
// resolveColDef folds `merged.hide ?? merged.initialHide ?? false`
// (core/propertyChain.ts:1066) — override state must win on every rebuild.

import type { ColumnOverride } from './types';

export function overrideToKernelPatch(
  merged: ColumnOverride,
  opts: { isCalcColumn: boolean },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (merged.headerName !== undefined) patch.headerName = merged.headerName;
  if (merged.format !== undefined) patch.valueFormatter = merged.format;
  if (merged.cellStyle !== undefined) patch.cellStyle = { ...merged.cellStyle };
  if (merged.headerStyle !== undefined) patch.headerStyle = { ...merged.headerStyle };
  if (merged.cellRenderer !== undefined) patch.cellRenderer = merged.cellRenderer;
  // Calc columns are pinned non-editable (spec §6.5) — an override's
  // `editable` is honored for DATA columns only; for calc columns the
  // synthesized `editable: false` (Task 7) stands.
  if (merged.editable !== undefined && !opts.isCalcColumn) patch.editable = merged.editable;
  if (merged.hide !== undefined) patch.hide = merged.hide;
  if (merged.width !== undefined) patch.width = merged.width;
  return patch;
}
