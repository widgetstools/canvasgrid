// @wellsfargo-starui/velocity-grid-edit — numericOps.test.ts
// Covers applyNumericOp, isNumericCellDataType.
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §1.1.3, §2.3.
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.3.
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 5 Step 1.

import { describe, it, expect } from 'vitest';
import { applyNumericOp, isNumericCellDataType } from '../src/numericOps';
import type { SmartEditOp } from '../src/types';

describe('applyNumericOp', () => {
  it('happy-path table for each op', () => {
    expect(applyNumericOp(10, 'multiply', 1.1)).toBeCloseTo(11);
    expect(applyNumericOp(10, 'divide', 4)).toBe(2.5);
    expect(applyNumericOp(10, 'add', -5)).toBe(5);
    expect(applyNumericOp(10, 'subtract', 3)).toBe(7);
    expect(applyNumericOp(10, 'set', 42)).toBe(42);
  });

  it('divide by zero returns null', () => {
    expect(applyNumericOp(10, 'divide', 0)).toBeNull();
  });

  it('non-numeric current returns null for every op', () => {
    const ops: SmartEditOp[] = ['multiply', 'divide', 'add', 'subtract', 'set'];
    const nonFiniteCurrents: unknown[] = [null, undefined, NaN, '12', Infinity];
    for (const op of ops) {
      for (const current of nonFiniteCurrents) {
        expect(applyNumericOp(current, op, 2)).toBeNull();
      }
    }
  });

  // recon A.3: StarUI parity — 'set' does NOT bypass the finite-current guard,
  // even though a null-current 'set' looks like a harmless "fill empty cell"
  // that a naive implementation might special-case. Bulk-update (Task 7) is
  // the intended path for filling empty cells; smart-edit 'set' stays finite-only.
  it("StarUI 'set' parity lock: null current -> null even for set (recon A.3)", () => {
    expect(applyNumericOp(null, 'set', 42)).toBeNull();
  });

  it('non-finite result returns null (overflow to Infinity)', () => {
    expect(applyNumericOp(Number.MAX_VALUE, 'multiply', Number.MAX_VALUE)).toBeNull();
  });
});

describe('isNumericCellDataType', () => {
  it('true only for exactly "number"', () => {
    expect(isNumericCellDataType('number')).toBe(true);
  });

  it('false for undefined and non-numeric types', () => {
    expect(isNumericCellDataType(undefined)).toBe(false);
    expect(isNumericCellDataType('text')).toBe(false);
    expect(isNumericCellDataType('date')).toBe(false);
    expect(isNumericCellDataType('dateTime')).toBe(false);
    expect(isNumericCellDataType('boolean')).toBe(false);
  });
});
