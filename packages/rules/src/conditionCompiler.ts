// Condition string → CompiledCondition. Ships in Task 2.
import type { Schema } from '@cgrid/expression';
import type { RuleValidationError, StyleRule } from './types';

export interface CompiledCondition {
  /** Strict-boolean evaluation; `row` may carry a `__cgridDiff` injection. */
  matches(row: Record<string, unknown>): boolean;
  /** True when the condition references `[col.old]` — evaluated only against diff-map members. */
  diffAware: boolean;
  /** Column ids the condition reads (drives watched-column diffing). */
  watchedColIds: ReadonlySet<string>;
}

export function compileCondition(
  _condition: string,
  _ruleId: string,
  _schema?: Schema,
): { ok: true; compiled: CompiledCondition } | { ok: false; error: RuleValidationError } {
  throw new Error('not-yet-implemented: compileCondition ships in Task 2');
}

export function validateRule(
  _rule: StyleRule,
  _schema?: Schema,
): RuleValidationError[] {
  throw new Error('not-yet-implemented: validateRule ships in Task 2');
}
