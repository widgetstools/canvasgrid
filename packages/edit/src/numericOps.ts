// @wellsfargo-starui/velocity-grid-edit — numeric arithmetic for smart-edit (multiply/divide/add/subtract/
// set) and cell-data-type numeric detection, centralized here so plus/minus
// (Task 8) and shortcuts (Task 9) share one implementation.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md
// section 1.1.3 (smart-edit ops), section 2.3 (keystroke-path — never throw).
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.3
// (StarUI 'set' parity — current must be finite even for 'set').
//
// Pure functions only — no kernel imports, no Date, no grid surface.

import type { SmartEditOp } from './types';

/** Applies a smart-edit arithmetic op to `current`. StarUI parity (recon A.3):
 *  `current` must be a FINITE number for EVERY op, including 'set' — a
 *  null/undefined/NaN/string/Infinity current always yields null (the patch
 *  is skipped upstream by buildPatchesFromTargets' null-skip). Divide-by-zero
 *  and non-finite results (e.g. overflow) also yield null. Never throws. */
export function applyNumericOp(current: unknown, op: SmartEditOp, operand: number): number | null {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null;

  let result: number;
  switch (op) {
    case 'multiply':
      result = current * operand;
      break;
    case 'divide':
      if (operand === 0) return null;
      result = current / operand;
      break;
    case 'add':
      result = current + operand;
      break;
    case 'subtract':
      result = current - operand;
      break;
    case 'set':
      result = operand;
      break;
  }

  return Number.isFinite(result) ? result : null;
}

/** True iff `cellDataType` is exactly `'number'` (strict — undefined/'text'/
 *  'date'/'boolean' all → false). */
export function isNumericCellDataType(cellDataType?: string): boolean {
  return cellDataType === 'number';
}
