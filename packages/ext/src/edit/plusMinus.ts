// @wellsfargo-starui/velocity-grid-ext/edit — plus/minus nudges: expression-gated rule resolution + patches.
// Authoritative reference: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md
// section 1.1.6 (plus/minus nudges).
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.5.
//
// This module is the package's ONLY runtime `@wellsfargo-starui/velocity-grid/expression` import
// (dependency declared in package.json — Task 1). Everything else in
// `@wellsfargo-starui/velocity-grid-ext/edit` stays engine-pure with zero expression-engine coupling.
//
// Strict-boolean gate + error-swallow precedent (cited per plan protocol):
// packages/rules/src/conditionCompiler.ts:129 — `evaluate(...) === true`,
// any throw (EvalError or otherwise) treated as non-matching, never breaks
// the caller.

import { compile, evaluate as evaluateCompiled, parse } from '@wellsfargo-starui/velocity-grid/expression';
import type { Compiled } from '@wellsfargo-starui/velocity-grid/expression';
import type { CellTarget } from './patches';
import { buildPatchesFromTargets } from './patches';
import type { CellPatch, PlusMinusNudge } from './types';
import { applyNumericOp } from './numericOps';

/** Injectable expression-gate seam: engine tests (and the bridge's
 *  `opts.evaluate` override) can supply a trivial fake without depending on
 *  the real expression engine wiring in `makeExpressionEvaluate`. */
export type NudgeEvaluate = (expression: string, row: Record<string, unknown>) => boolean;

function compileExpression(expression: string): Compiled | null {
  const parsed = parse(expression);
  if (!parsed.ok) return null;
  const compiled = compile(parsed.ast);
  if (!compiled.ok) return null;
  return compiled.compiled;
}

/** Binds `@wellsfargo-starui/velocity-grid/expression`'s parse/compile/evaluate with a per-expression
 *  compile cache: the first sighting of an expression string parses+compiles
 *  once; a parse/compile failure caches `null` so that expression is always
 *  `false` thereafter and is NEVER re-parsed. The evaluate result must be
 *  STRICTLY `=== true` to gate open; `EvalError` (or any other throw) is
 *  swallowed to `false` (conditionCompiler.ts:129 precedent). */
export function makeExpressionEvaluate(): NudgeEvaluate {
  const cache = new Map<string, Compiled | null>();
  return (expression: string, row: Record<string, unknown>): boolean => {
    let compiled: Compiled | null;
    if (cache.has(expression)) {
      compiled = cache.get(expression)!;
    } else {
      compiled = compileExpression(expression);
      cache.set(expression, compiled);
    }
    if (compiled === null) return false;
    try {
      return evaluateCompiled(compiled, { row }) === true;
    } catch {
      return false;
    }
  };
}

/** First ENABLED match wins (list order = priority, recon A.5). Scope rule:
 *  empty `columnIds` matches all columns; otherwise the cell's `colId` OR
 *  `field` must be a member. When the matched rule carries an `expression`,
 *  `evaluate(...)` must return `true` (false/error) — otherwise resolution
 *  CONTINUES to later rules rather than stopping. Disabled rules never
 *  match. */
export function resolveNudgeForCell(
  cell: { colId: string; field: string; value: unknown; rowData: Record<string, unknown> },
  nudges: PlusMinusNudge[],
  evaluate: NudgeEvaluate,
): PlusMinusNudge | null {
  for (const nudge of nudges) {
    if (!nudge.enabled) continue;
    const { columnIds } = nudge.scope;
    if (columnIds.length > 0 && !columnIds.includes(cell.colId) && !columnIds.includes(cell.field)) {
      continue;
    }
    if (nudge.expression !== undefined && evaluate(nudge.expression, cell.rowData) !== true) {
      continue;
    }
    return nudge;
  }
  return null;
}

/** Per target: `resolveNudgeForCell` -> null skips; a matched nudge steps by
 *  `incrementStep` ('+' direction) or `decrementStep ?? incrementStep`
 *  ('-' direction, recon A.5 asymmetric-steps allowance) through Task 5's
 *  `applyNumericOp` (non-numeric current -> null -> skip). Composed through
 *  `buildPatchesFromTargets` so the null-skip and `Object.is` no-op guard
 *  stay centralized. */
export function buildNudgePatches(opts: {
  targets: CellTarget[];
  direction: '+' | '-';
  nudges: PlusMinusNudge[];
  evaluate: NudgeEvaluate;
}): CellPatch[] {
  const { targets, direction, nudges, evaluate } = opts;
  return buildPatchesFromTargets(targets, (t) => {
    const nudge = resolveNudgeForCell(
      { colId: t.colId, field: t.field, value: t.value, rowData: t.rowData },
      nudges,
      evaluate,
    );
    if (!nudge) return null;
    const step = direction === '+' ? nudge.incrementStep : nudge.decrementStep ?? nudge.incrementStep;
    const op = direction === '+' ? 'add' : 'subtract';
    return applyNumericOp(t.value, op, step);
  });
}
