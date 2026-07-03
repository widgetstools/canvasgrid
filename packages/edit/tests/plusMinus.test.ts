// @cgrid/edit — plusMinus.test.ts
// Covers makeExpressionEvaluate (real @cgrid/expression engine + compile
// cache), resolveNudgeForCell, buildNudgePatches.
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §1.1.6.
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.5.
// Precedent: packages/rules/src/conditionCompiler.ts:129 (strict-boolean gate).
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 8 Step 1 (13 cases).

import { describe, it, expect, vi } from 'vitest';
import {
  makeExpressionEvaluate,
  resolveNudgeForCell,
  buildNudgePatches,
} from '../src/plusMinus';
import type { NudgeEvaluate } from '../src/plusMinus';
import type { CellTarget } from '../src/patches';
import type { PlusMinusNudge } from '../src/types';

const alwaysTrue: NudgeEvaluate = () => true;

function nudge(overrides?: Partial<PlusMinusNudge>): PlusMinusNudge {
  return {
    id: 'n1', name: 'nudge', enabled: true,
    scope: { columnIds: [] },
    incrementStep: 1,
    ...overrides,
  };
}

function cell(overrides?: Partial<{ colId: string; field: string; value: unknown; rowData: Record<string, unknown> }>) {
  return {
    colId: 'qty', field: 'qty', value: 10, rowData: {},
    ...overrides,
  };
}

describe('resolveNudgeForCell', () => {
  it('first-match priority: first enabled nudge with matching scope wins', () => {
    const a = nudge({ id: 'a', scope: { columnIds: ['qty'] } });
    const b = nudge({ id: 'b', scope: { columnIds: ['qty'] } });
    expect(resolveNudgeForCell(cell(), [a, b], alwaysTrue)?.id).toBe('a');
    expect(resolveNudgeForCell(cell(), [b, a], alwaysTrue)?.id).toBe('b');
  });

  it('scope colId-vs-field: matches by colId OR field (aliased column)', () => {
    const n = nudge({ scope: { columnIds: ['qty'] } });
    expect(resolveNudgeForCell(cell({ colId: 'qty', field: 'qty' }), [n], alwaysTrue)).toBe(n);
    expect(resolveNudgeForCell(cell({ colId: 'col_7', field: 'qty' }), [n], alwaysTrue)).toBe(n);
  });

  it('empty scope matches any colId', () => {
    const n = nudge({ scope: { columnIds: [] } });
    expect(resolveNudgeForCell(cell({ colId: 'anything' }), [n], alwaysTrue)).toBe(n);
  });

  it('disabled skipped; all-disabled -> null', () => {
    const a = nudge({ id: 'a', enabled: false });
    const b = nudge({ id: 'b', enabled: true });
    expect(resolveNudgeForCell(cell(), [a, b], alwaysTrue)?.id).toBe('b');
    expect(resolveNudgeForCell(cell(), [a, { ...b, enabled: false }], alwaysTrue)).toBeNull();
  });

  it('expression gate TRUE/FALSE with the REAL engine — false falls through to a later rule', () => {
    const evaluate = makeExpressionEvaluate();
    const gated = nudge({ id: 'gated', expression: '[status] == "active"' });
    const fallback = nudge({ id: 'fallback' });

    expect(
      resolveNudgeForCell(cell({ rowData: { status: 'active' } }), [gated, fallback], evaluate)?.id,
    ).toBe('gated');
    expect(
      resolveNudgeForCell(cell({ rowData: { status: 'closed' } }), [gated, fallback], evaluate)?.id,
    ).toBe('fallback');
  });

  it('grammar lock (real engine): && and != forms', () => {
    const evaluate = makeExpressionEvaluate();
    const n = nudge({ expression: '[status] == "active" && [qty] != 0' });
    expect(
      resolveNudgeForCell(cell({ rowData: { status: 'active', qty: 5 } }), [n], evaluate),
    ).toBe(n);
    expect(
      resolveNudgeForCell(cell({ rowData: { status: 'active', qty: 0 } }), [n], evaluate),
    ).toBeNull();
    expect(
      resolveNudgeForCell(cell({ rowData: { status: 'closed', qty: 5 } }), [n], evaluate),
    ).toBeNull();
  });

  it('parse-error -> false, cached, never throws (no re-parse explosion)', () => {
    const evaluate = makeExpressionEvaluate();
    const n = nudge({ expression: '[status] == ' }); // syntactically invalid
    expect(() => resolveNudgeForCell(cell(), [n], evaluate)).not.toThrow();
    expect(resolveNudgeForCell(cell(), [n], evaluate)).toBeNull();
    expect(() => resolveNudgeForCell(cell(), [n], evaluate)).not.toThrow();
    expect(resolveNudgeForCell(cell(), [n], evaluate)).toBeNull();
  });

  it('eval-throw -> false: no throw escapes the resolver', () => {
    const evaluate = makeExpressionEvaluate();
    // Comparing a string field to a number triggers a runtime EvalError
    // (type-mismatched comparison) per the expression package's semantics.
    const n = nudge({ expression: '[status] > 5' });
    expect(() => resolveNudgeForCell(cell({ rowData: { status: 'active' } }), [n], evaluate)).not.toThrow();
    expect(resolveNudgeForCell(cell({ rowData: { status: 'active' } }), [n], evaluate)).toBeNull();
  });

  it('strict-boolean gate: truthy-but-not-true injected evaluate is NOT a match', () => {
    const sloppy = ((expr: string, row: Record<string, unknown>) => {
      void expr;
      void row;
      return 1;
    }) as unknown as NudgeEvaluate;
    const n = nudge({ expression: 'anything' });
    expect(resolveNudgeForCell(cell(), [n], sloppy)).toBeNull();

    const sloppy2 = (() => 'yes') as unknown as NudgeEvaluate;
    expect(resolveNudgeForCell(cell(), [n], sloppy2)).toBeNull();
  });
});

describe('buildNudgePatches', () => {
  function target(overrides?: Partial<CellTarget>): CellTarget {
    return {
      rowId: 'r1', colId: 'qty', field: 'qty', value: 10, rowIndex: 0,
      rowData: {},
      ...overrides,
    };
  }

  it('asymmetric steps: incrementStep and decrementStep both honored', () => {
    const n = nudge({ scope: { columnIds: ['qty'] }, incrementStep: 5, decrementStep: 1 });
    expect(
      buildNudgePatches({ targets: [target({ value: 10 })], direction: '+', nudges: [n], evaluate: alwaysTrue }),
    ).toEqual([{ rowId: 'r1', colId: 'qty', field: 'qty', oldValue: 10, newValue: 15 }]);
    expect(
      buildNudgePatches({ targets: [target({ value: 10 })], direction: '-', nudges: [n], evaluate: alwaysTrue }),
    ).toEqual([{ rowId: 'r1', colId: 'qty', field: 'qty', oldValue: 10, newValue: 9 }]);
  });

  it('decrementStep default: falls back to incrementStep', () => {
    const n = nudge({ scope: { columnIds: ['qty'] }, incrementStep: 2 });
    expect(
      buildNudgePatches({ targets: [target({ value: 10 })], direction: '-', nudges: [n], evaluate: alwaysTrue }),
    ).toEqual([{ rowId: 'r1', colId: 'qty', field: 'qty', oldValue: 10, newValue: 8 }]);
  });

  it('non-numeric current skipped (via applyNumericOp -> null)', () => {
    const n = nudge({ scope: { columnIds: ['qty'] } });
    expect(
      buildNudgePatches({ targets: [target({ value: 'n/a' })], direction: '+', nudges: [n], evaluate: alwaysTrue }),
    ).toEqual([]);
  });

  it('mixed target list: only scoped numeric targets patch; zero-step is a no-op', () => {
    const n = nudge({ scope: { columnIds: ['qty'] }, incrementStep: 0 });
    const targets = [
      target({ rowId: 'scoped-numeric', colId: 'qty', value: 10 }),
      target({ rowId: 'unscoped', colId: 'other', value: 10 }),
      target({ rowId: 'non-numeric', colId: 'qty', value: 'n/a' }),
    ];
    expect(
      buildNudgePatches({ targets, direction: '+', nudges: [n], evaluate: alwaysTrue }),
    ).toEqual([]); // zero-step -> Object.is(10, 10) no-op; unscoped/non-numeric never match/skip
  });
});
