// Aggregate-site AST rewrite: replaces every aggregate call site with a synthetic
// FieldNode ['__cgridAgg', String(slot)] and every PREV([col]) with
// ['__cgridPrev', colId], returning the pre-pass AggSpec[] alongside.
// Ships in Task 2. See docs/superpowers/specs/2026-07-02-cycle-21d-calc-design.md §1.1.1, §6.2, §6.4.
//
// LOCKED design notes (do not drift — see Task-1 brief Phase-B decisions):
// - The per-row program compiles with the UNTOUCHED 21b `expression.compile`; it never
//   sees an AggregateNode/PrevNode. Those reserved kinds are constructed INTERNALLY by
//   this transform for validation clarity but are never emitted into the rewritten AST.
// - Default scope is `{ kind: 'visible' }`; the worker promotes visible→group at
//   evaluation time when grouping is active (Stage B, owned by Task 10).
// - Scope wire format is the trailing string literal: `SUM([x], 'group')`. The pretty
//   `scope: group` form is 21i editor sugar (bare `scope:` cannot parse — `:` is the
//   ternary token); the editor emits the string-literal form.
// - Schema unknown fields map to CalcValidationError code 'bad-shape' with message
//   `unknown field '<path>'` (no 'unknown-field' code exists in the locked union).
// - PERCENTILE([price], 95) records fn: 'PERCENTILE(95)' (percent points 0-100,
//   `String(p)`, `95.0` normalizes to `'95'`) — the Task-5 registry's suffix parse is
//   the authoritative consumer. Dedup keys work unchanged.

import type { Ast, Schema } from '@cgrid/expression';
import type { AggSpec, CalcValidationError } from './types';

/** Aggregate names calc ships (superset of any expression-package list: statistical + share families). */
export const CALC_AGGREGATE_NAMES: readonly string[] = [];

/** Aggregate names reserved (grammar-honest) but not yet implemented: order-dependent families. */
export const ORDER_DEPENDENT_NAMES: readonly string[] = [];

export function transformAggregates(
  _ast: Ast,
  _schema?: Schema,
): { ok: true; ast: Ast; prePass: AggSpec[]; usesPrev: boolean } | { ok: false; error: CalcValidationError } {
  throw new Error('not-yet-implemented: transformAggregates ships in Task 2');
}

/**
 * Column ids referenced by aggregate/PREV call sites, collected from the PRE-rewrite ast
 * (excludes the synthetic __cgridAgg/__cgridPrev roots introduced by transformAggregates).
 * Module-level export only — NOT re-exported from index.ts. Consumed by compileCalc (Task 3).
 */
export function collectWatchedColIds(_ast: Ast): ReadonlySet<string> {
  throw new Error('not-yet-implemented: collectWatchedColIds ships in Task 2');
}
