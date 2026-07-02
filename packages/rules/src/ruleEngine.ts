// RuleEngine — setRules compile + indexes, evaluateCell fold, theme
// resolution, resolveRuleRef. Match counts / transactions land in Task 4;
// expiry + flash directives in Task 5 (their methods still throw here).
//
// Authoritative reference:
// docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §3.5 + §4.2.

import type { Schema } from '@cgrid/expression';
import { compileFormat } from '@cgrid/format';
import type { FormatProgram } from '@cgrid/format';
import { compileCondition, validateRuleShape } from './conditionCompiler';
import type { CompiledCondition } from './conditionCompiler';
import type {
  FlashDirective,
  RowChangeSet,
  RuleCellResult,
  RuleEvalContext,
  RuleIndicator,
  RuleValidationError,
  SetRulesResult,
  StyleRule,
  StyleSlice,
  ThemeAwareStyle,
  ThemeKind,
  Unsubscribe,
} from './types';

interface IndexedRule {
  rule: StyleRule;
  condition: CompiledCondition;
  /** Compiled valueFormatter (style rules only); null when absent. */
  formatProgram: FormatProgram | null;
  /** Position in the setRules array — stable tiebreak for equal priority. */
  order: number;
}

function byPriority(a: IndexedRule, b: IndexedRule): number {
  return a.rule.priority - b.rule.priority || a.order - b.order;
}

/** base ⊕ theme slice, per-property (ThemeAwareStyle contract, spec §3.1). */
function resolveThemeStyle(style: ThemeAwareStyle, theme: ThemeKind): StyleSlice | null {
  const slice = theme === 'dark' ? style.dark : style.light;
  if (!style.base) return slice ?? null;
  if (!slice) return style.base;
  return { ...style.base, ...slice };
}

const EMPTY_MATCHED: string[] = [];
Object.freeze(EMPTY_MATCHED);

/** Shared zero-allocation result for cells no rule matches (spec §4.2). */
const EMPTY_RESULT: RuleCellResult = Object.freeze({
  matched: EMPTY_MATCHED,
  style: null,
  indicator: null,
  formatProgram: null,
});

export class RuleEngine {
  #schema: Schema | undefined;
  /** Full supplied set — incl. invalid + disabled (serializable snapshot). */
  #rules: StyleRule[] = [];
  /** Enabled, valid, compiled rules — priority asc, stable. */
  #indexed: IndexedRule[] = [];
  #byId = new Map<string, IndexedRule>();
  #cellByColId = new Map<string, IndexedRule[]>();
  #rowScope: IndexedRule[] = [];
  /** Lazily merged (row-scope + cell-scope) candidate lists per colId. */
  #mergedByColId = new Map<string, IndexedRule[]>();
  /** Row-scope condition memo, keyed by row object identity (paint pass). */
  #rowMemo = new WeakMap<Record<string, unknown>, Map<string, boolean>>();
  /** Eval errors per ruleId since last setRules (getter ships in Task 4). */
  #evalErrors = new Map<string, number>();

  constructor(opts?: { schema?: Schema; now?: () => number }) {
    this.#schema = opts?.schema;
    // opts.now is consumed by Task 5 (expiry heap); accepted from the first
    // shipped task so the constructor contract is stable.
  }

  /** Replace the rule set. Invalid rules are skipped + reported; valid rules apply. */
  setRules(rules: StyleRule[]): SetRulesResult {
    const errors: RuleValidationError[] = [];
    const indexed: IndexedRule[] = [];
    for (let order = 0; order < rules.length; order++) {
      // noUncheckedIndexedAccess types this as possibly-undefined even
      // though the loop bound guarantees it; guard explicitly rather than
      // asserting (same pattern as conditionCompiler's rewriteField).
      const rule = rules[order];
      if (rule === undefined) continue;
      const ruleErrors = validateRuleShape(rule);
      let formatProgram: FormatProgram | null = null;
      if (rule.kind === 'style' && typeof rule.valueFormatter === 'string') {
        const fmt = compileFormat(rule.valueFormatter);
        if (fmt.ok) {
          formatProgram = fmt.program;
        } else {
          ruleErrors.push({
            ruleId: rule.id,
            code: 'format-compile',
            message: fmt.error.message,
            loc: fmt.error.loc,
          });
        }
      }
      let condition: CompiledCondition | null = null;
      if (typeof rule.condition === 'string' && rule.condition.trim().length > 0) {
        const res = compileCondition(rule.condition, rule.id, this.#schema, {
          onEvalError: () =>
            this.#evalErrors.set(rule.id, (this.#evalErrors.get(rule.id) ?? 0) + 1),
        });
        if (res.ok) condition = res.compiled;
        else ruleErrors.push(res.error);
      }
      if (ruleErrors.length > 0 || condition === null) {
        errors.push(...ruleErrors);
        continue; // invalid rule skipped; valid ones still apply
      }
      if (rule.enabled) indexed.push({ rule, condition, formatProgram, order });
    }
    indexed.sort(byPriority);

    this.#rules = rules.slice();
    this.#indexed = indexed;
    this.#byId = new Map(indexed.map((ir) => [ir.rule.id, ir]));
    this.#cellByColId = new Map();
    this.#rowScope = [];
    for (const ir of indexed) {
      if (ir.rule.scope.kind === 'row') {
        this.#rowScope.push(ir);
      } else {
        for (const colId of ir.rule.scope.columnIds) {
          let list = this.#cellByColId.get(colId);
          if (!list) {
            list = [];
            this.#cellByColId.set(colId, list);
          }
          list.push(ir);
        }
      }
    }
    this.#mergedByColId = new Map();
    this.#rowMemo = new WeakMap();
    this.#evalErrors = new Map();
    return { ok: errors.length === 0, errors };
  }

  getRules(): StyleRule[] {
    return this.#rules.slice();
  }

  /** Paint-path entry. Pure w.r.t. engine state; cheap when no rules target the cell. */
  evaluateCell(ctx: RuleEvalContext): RuleCellResult {
    const candidates = this.#candidatesFor(ctx.colId);
    if (candidates.length === 0) return EMPTY_RESULT;
    let matched: string[] | null = null;
    let style: StyleSlice | null = null;
    let indicator: RuleIndicator | null = null;
    let formatProgram: FormatProgram | null = null;
    for (const ir of candidates) {
      if (!this.#ruleMatches(ir, ctx)) continue;
      (matched ??= []).push(ir.rule.id);
      if (ir.rule.kind === 'style') {
        const slice = resolveThemeStyle(ir.rule.style, ctx.theme);
        // TS narrowing note: reassigning `style` inside this loop body
        // defeats control-flow narrowing on the ternary condition across
        // iterations (loop-local widening quirk) — use Object.assign into a
        // fresh object instead of a `prev ? {...prev,...slice} : {...slice}`
        // spread ternary so the compiler doesn't need to narrow `style`.
        if (slice) style = Object.assign({}, style, slice);
        if (ir.rule.indicator) indicator = ir.rule.indicator;
        if (ir.formatProgram) formatProgram = ir.formatProgram;
      } else {
        indicator = ir.rule.indicator; // last matching indicator wins
      }
    }
    if (matched === null) return EMPTY_RESULT;
    return { matched, style, indicator, formatProgram };
  }

  /** rule:<ruleId> color accessor for @cgrid/format (Task 9 threads it).
   *  Condition-level match — scope column targeting governs where the rule
   *  paints, not whether a format rule-ref may read its color. */
  resolveRuleRef(ruleId: string, ctx: RuleEvalContext): string | null {
    const ir = this.#byId.get(ruleId); // only enabled+valid rules are indexed
    if (!ir || ir.rule.kind !== 'style') return null;
    if (!this.#ruleMatches(ir, ctx)) return null;
    const slice = resolveThemeStyle(ir.rule.style, ctx.theme);
    return slice?.color ?? null;
  }

  #candidatesFor(colId: string | null): IndexedRule[] {
    if (colId === null) return this.#rowScope;
    let merged = this.#mergedByColId.get(colId);
    if (merged === undefined) {
      const cell = this.#cellByColId.get(colId);
      if (!cell || cell.length === 0) merged = this.#rowScope;
      else if (this.#rowScope.length === 0) merged = cell;
      else merged = [...this.#rowScope, ...cell].sort(byPriority);
      this.#mergedByColId.set(colId, merged);
    }
    return merged;
  }

  /** Single matching gate for evaluateCell + resolveRuleRef.
   *  Task 4 reroutes this through the diff-map injection; Task 5 adds the
   *  activeDurationMs window check. */
  #ruleMatches(ir: IndexedRule, ctx: RuleEvalContext): boolean {
    if (ir.rule.scope.kind === 'row') {
      let memo = this.#rowMemo.get(ctx.row);
      if (!memo) {
        memo = new Map();
        this.#rowMemo.set(ctx.row, memo);
      }
      const hit = memo.get(ir.rule.id);
      if (hit !== undefined) return hit;
      const res = ir.condition.matches(ctx.row);
      memo.set(ir.rule.id, res);
      return res;
    }
    return ir.condition.matches(ctx.row);
  }

  // ─── Tasks 4–5 ─────────────────────────────────────────────────────────

  matchCount(_ruleId: string): number {
    throw new Error('not-yet-implemented: matchCount ships in Task 4');
  }
  recount(_rows: Iterable<{ rowId: string; row: Record<string, unknown> }>): void {
    throw new Error('not-yet-implemented: recount ships in Task 4');
  }
  applyChanges(_changes: RowChangeSet): FlashDirective[] {
    throw new Error('not-yet-implemented: applyChanges ships in Task 4');
  }
  endTick(): void {
    throw new Error('not-yet-implemented: endTick ships in Task 4');
  }
  onExpire(
    _fn: (cells: Array<{ rowId: string; colId: string | null }>) => void,
  ): Unsubscribe {
    throw new Error('not-yet-implemented: onExpire ships in Task 5');
  }
  evalErrorCount(_ruleId: string): number {
    throw new Error('not-yet-implemented: evalErrorCount ships in Task 4');
  }
}
