// @wellsfargo-starui/velocity-grid-ext/edit — preview.test.ts
// Covers previewPatches, combineValidators.
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §1.1.2, §3.3.
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 4 Step 1 (9 cases).

import { describe, it, expect, vi } from 'vitest';
import { previewPatches, combineValidators } from '../../src/edit/preview';
import type { CellPatch, EditValidationResult, PatchValidator } from '../../src/edit/types';

function patch(overrides?: Partial<CellPatch>): CellPatch {
  return {
    rowId: 'r1',
    colId: 'px',
    field: 'px',
    oldValue: 1,
    newValue: 2,
    ...overrides,
  };
}

/** Maps colId to a fixed classification, for building mixed-result fixtures. */
function classifyByColId(map: Record<string, EditValidationResult>): PatchValidator {
  return (p) => map[p.colId] ?? 'valid';
}

describe('previewPatches', () => {
  it('no validator: every row valid', () => {
    const patches = [patch({ colId: 'px' }), patch({ colId: 'qty' }), patch({ colId: 'sym' })];
    const result = previewPatches(patches);
    expect(result).toEqual({
      total: 3,
      valid: 3,
      invalid: 0,
      warnings: 0,
      rows: [
        { patch: patches[0], result: 'valid' },
        { patch: patches[1], result: 'valid' },
        { patch: patches[2], result: 'valid' },
      ],
    });
  });

  it('rows preserve input order and patch identity', () => {
    const patches = [
      patch({ rowId: 'r2', colId: 'z' }),
      patch({ rowId: 'r1', colId: 'a' }),
      patch({ rowId: 'r3', colId: 'm' }),
    ];
    const result = previewPatches(patches);
    expect(result.rows).toHaveLength(patches.length);
    result.rows.forEach((row, i) => {
      expect(row.patch).toBe(patches[i]);
    });
  });

  it('counts add up under a mixed validator', () => {
    const patches = [
      patch({ rowId: 'r1', colId: 'a' }),
      patch({ rowId: 'r2', colId: 'b' }),
      patch({ rowId: 'r3', colId: 'c' }),
      patch({ rowId: 'r4', colId: 'd' }),
    ];
    const classifications: EditValidationResult[] = ['valid', 'invalid', 'warning', 'valid'];
    const validator = classifyByColId({ a: 'valid', b: 'invalid', c: 'warning', d: 'valid' });
    const result = previewPatches(patches, validator);
    expect(result.total).toBe(4);
    expect(result.valid).toBe(2);
    expect(result.invalid).toBe(1);
    expect(result.warnings).toBe(1);
    expect(result.total).toBe(result.valid + result.invalid + result.warnings);
    result.rows.forEach((row, i) => {
      expect(row.result).toBe(classifications[i]);
    });
  });

  it('empty patches: zeroed result, validator never invoked', () => {
    const validator = vi.fn<PatchValidator>(() => 'valid');
    const result = previewPatches([], validator);
    expect(result).toEqual({ total: 0, valid: 0, invalid: 0, warnings: 0, rows: [] });
    expect(validator).not.toHaveBeenCalled();
  });

  it('purity: no mutation of input patches, no grid access', () => {
    const patches = [patch({ colId: 'px' }), patch({ colId: 'qty', oldValue: 5, newValue: 6 })];
    const snapshot = JSON.parse(JSON.stringify(patches));
    const validator: PatchValidator = () => 'warning';
    previewPatches(patches, validator);
    expect(JSON.parse(JSON.stringify(patches))).toEqual(snapshot);
  });
});

describe('combineValidators', () => {
  it('fail-fast on invalid: later validators not invoked', () => {
    const v1: PatchValidator = () => 'invalid';
    const v2 = vi.fn<PatchValidator>(() => 'valid');
    const combined = combineValidators(v1, v2);
    expect(combined(patch())).toBe('invalid');
    expect(v2).not.toHaveBeenCalled();
  });

  it('worst-of warning: all validators invoked, no short-circuit on warning', () => {
    const calls: string[] = [];
    const mk = (name: string, result: EditValidationResult): PatchValidator => (p) => {
      calls.push(name);
      return result;
    };
    const combined = combineValidators(mk('a', 'valid'), mk('b', 'warning'), mk('c', 'valid'));
    expect(combined(patch())).toBe('warning');
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('all-valid and zero-validators edges both resolve to valid', () => {
    const combinedAllValid = combineValidators(
      () => 'valid',
      () => 'valid',
      () => 'valid',
    );
    expect(combinedAllValid(patch())).toBe('valid');

    const combinedNone = combineValidators();
    expect(combinedNone(patch())).toBe('valid');
  });

  it('composes with previewPatches: per-row short-circuit, not global', () => {
    const invalidCol = 'bad';
    const warnCol = 'warn';
    const vA: PatchValidator = (p) => (p.colId === invalidCol ? 'invalid' : 'valid');
    const vB = vi.fn<PatchValidator>((p) => (p.colId === warnCol ? 'warning' : 'valid'));
    const combined = combineValidators(vA, vB);

    const patches = [
      patch({ rowId: 'r1', colId: invalidCol }),
      patch({ rowId: 'r2', colId: warnCol }),
      patch({ rowId: 'r3', colId: 'ok' }),
    ];
    const result = previewPatches(patches, combined);

    expect(result).toMatchObject({ total: 3, valid: 1, invalid: 1, warnings: 1 });
    expect(result.rows.map((r) => r.result)).toEqual(['invalid', 'warning', 'valid']);
    // vB is invoked for every row EXCEPT the one vA already marked invalid
    // (fail-fast is per-row, applied by the combined validator itself).
    expect(vB).toHaveBeenCalledTimes(2);
  });
});
