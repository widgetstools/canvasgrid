// RuleEngine — evaluate/fold/counts. Ships in Tasks 3–5.
import type { Schema } from '@cgrid/expression';
import type {
  FlashDirective, RowChangeSet, RuleCellResult, RuleEvalContext,
  SetRulesResult, StyleRule, Unsubscribe,
} from './types';

export class RuleEngine {
  constructor(_opts?: { schema?: Schema; now?: () => number }) {
    throw new Error('not-yet-implemented: RuleEngine ships in Task 3');
  }
  setRules(_rules: StyleRule[]): SetRulesResult { throw new Error('not-yet-implemented'); }
  getRules(): StyleRule[] { throw new Error('not-yet-implemented'); }
  evaluateCell(_ctx: RuleEvalContext): RuleCellResult { throw new Error('not-yet-implemented'); }
  matchCount(_ruleId: string): number { throw new Error('not-yet-implemented'); }
  resolveRuleRef(_ruleId: string, _ctx: RuleEvalContext): string | null { throw new Error('not-yet-implemented'); }
  recount(_rows: Iterable<{ rowId: string; row: Record<string, unknown> }>): void { throw new Error('not-yet-implemented'); }
  applyChanges(_changes: RowChangeSet): FlashDirective[] { throw new Error('not-yet-implemented'); }
  endTick(): void { throw new Error('not-yet-implemented'); }
  onExpire(_fn: (cells: Array<{ rowId: string; colId: string | null }>) => void): Unsubscribe { throw new Error('not-yet-implemented'); }
  evalErrorCount(_ruleId: string): number { throw new Error('not-yet-implemented'); }
}
