// @cgrid/edit - pure preview classification for confirm dialogs.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md
// section 1.1.2 (patch model), section 3.3 (preview never mutates).
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.1.
//
// Pure module: imports ONLY types from ./types - no journal, no grid surface,
// no Date. previewPatches performs NO grid access whatsoever; the projected
// values already live in patch.newValue, so there is nothing to preserve or
// restore at preview time.

import type { CellPatch, EditValidationResult, PatchValidator } from './types';

export interface PreviewRow {
  patch: CellPatch;
  result: EditValidationResult;
}

/** Classifies each patch with `validator` (default: every patch 'valid'),
 *  tallying totals in a single pass. `rows` preserves input order, one
 *  PreviewRow per input patch, at the same reference. */
export function previewPatches(
  patches: CellPatch[],
  validator?: PatchValidator,
): { total: number; valid: number; invalid: number; warnings: number; rows: PreviewRow[] } {
  let valid = 0;
  let invalid = 0;
  let warnings = 0;
  const rows: PreviewRow[] = [];

  for (const patch of patches) {
    const result = validator ? validator(patch) : 'valid';
    if (result === 'invalid') invalid++;
    else if (result === 'warning') warnings++;
    else valid++;
    rows.push({ patch, result });
  }

  return { total: patches.length, valid, invalid, warnings, rows };
}

/** Runs validators in argument order against a single patch: the first
 *  'invalid' short-circuits (later validators NOT invoked for that patch);
 *  otherwise any 'warning' makes the combined result 'warning'; zero
 *  validators or all-'valid' resolves to 'valid'. */
export function combineValidators(...validators: PatchValidator[]): PatchValidator {
  return (patch: CellPatch): EditValidationResult => {
    let sawWarning = false;
    for (const validator of validators) {
      const result = validator(patch);
      if (result === 'invalid') return 'invalid';
      if (result === 'warning') sawWarning = true;
    }
    return sawWarning ? 'warning' : 'valid';
  };
}
