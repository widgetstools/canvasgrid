// Condition string → CompiledCondition.
// parse → diff-aware AST rewrite ([col.old]/[col.new] → __cgridDiff
// injection) → compile → strict-boolean matcher.
//
// CSP-safe: closure composition via @wellsfargo-starui/velocity-grid-expression only — no new
// Function / eval anywhere in this package. Date-free: zero clock access.
//
// Authoritative reference:
// docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §3.3 + §3.4.

import { compile, evaluate, parse, EvalError } from '@wellsfargo-starui/velocity-grid-expression';
import type { AstNode, FieldNode, Schema } from '@wellsfargo-starui/velocity-grid-expression';
import { compileFormat } from '@wellsfargo-starui/velocity-grid-format';
import type { RuleValidationError, StyleRule } from './types';

export interface CompiledCondition {
  /** Strict-boolean evaluation; `row` may carry a `__cgridDiff` injection. */
  matches(row: Record<string, unknown>): boolean;
  /** True when the condition references `[col.old]` — evaluated only against diff-map members. */
  diffAware: boolean;
  /** Column ids the condition reads (drives watched-column diffing). */
  watchedColIds: ReadonlySet<string>;
}

export interface CompileConditionOptions {
  /** Invoked once per occurrence when evaluation throws EvalError; the rule
   *  is treated as non-matching for that cell (never breaks paint). */
  onEvalError?: () => void;
}

/** The synthetic root the diff rewrite targets. RuleEngine injects it as
 *  `{ ...row, __cgridDiff: { [colId]: { old } } }` for diff-map rows (Task 4). */
export const DIFF_ROOT = '__cgridDiff';

interface RewriteState {
  diffAware: boolean;
  watched: Set<string>;
  schema: Schema | undefined;
}

function rewriteField(node: FieldNode, state: RewriteState): FieldNode {
  // FieldNode.path is guaranteed nonempty by the parser (`[colId]` is the
  // minimal field reference); noUncheckedIndexedAccess still types index 0
  // as possibly-undefined, so guard explicitly rather than asserting.
  const head = node.path[0];
  if (head === undefined) return node;
  if (head !== DIFF_ROOT) state.watched.add(head);
  if (node.path.length !== 2) return node;
  const tail = node.path[1];
  if (tail !== 'old' && tail !== 'new') return node;
  // With a schema, rewrite only when the head is a known field — a
  // 2-segment path over an unknown head stays a nested-object read.
  if (state.schema && !Object.prototype.hasOwnProperty.call(state.schema.fields, head)) {
    return node;
  }
  if (tail === 'old') {
    state.diffAware = true;
    return { ...node, path: [DIFF_ROOT, head, 'old'] };
  }
  // [col.new] — the current row value IS the new value (spec §3.4).
  return { ...node, path: [head] };
}

function rewriteNode(node: AstNode, state: RewriteState): AstNode {
  switch (node.kind) {
    case 'literal':
      return node;
    case 'field':
      return rewriteField(node, state);
    case 'unary':
      return { ...node, arg: rewriteNode(node.arg, state) };
    case 'binary':
      return {
        ...node,
        left: rewriteNode(node.left, state),
        right: rewriteNode(node.right, state),
      };
    case 'ternary':
      return {
        ...node,
        test: rewriteNode(node.test, state),
        consequent: rewriteNode(node.consequent, state),
        alternate: rewriteNode(node.alternate, state),
      };
    case 'call':
      return { ...node, args: node.args.map((a) => rewriteNode(a, state)) };
    case 'aggregate':
    case 'prev':
      // 21b's parser never emits these; if a future parse does, compile()
      // rejects them with 'not-yet-implemented' — pass through untouched.
      return node;
  }
}

export function compileCondition(
  condition: string,
  ruleId: string,
  schema?: Schema,
  opts?: CompileConditionOptions,
): { ok: true; compiled: CompiledCondition } | { ok: false; error: RuleValidationError } {
  const parsed = parse(condition);
  if (!parsed.ok) {
    return {
      ok: false,
      error: { ruleId, code: 'parse', message: parsed.error.message, loc: parsed.error.loc },
    };
  }
  const state: RewriteState = { diffAware: false, watched: new Set(), schema };
  const rewritten = rewriteNode(parsed.ast, state);
  const compiled = compile(rewritten);
  if (!compiled.ok) {
    // Compile codes pass through verbatim: 'unknown-fn' | 'arity' |
    // 'not-yet-implemented' (reserved aggregates/PREV — Cycle 21d).
    return {
      ok: false,
      error: {
        ruleId,
        code: compiled.error.code,
        message: compiled.error.message,
        loc: compiled.error.loc,
      },
    };
  }
  const program = compiled.compiled;
  const onEvalError = opts?.onEvalError;
  const matches = (row: Record<string, unknown>): boolean => {
    try {
      // Strict boolean (spec §3.3): a number/string result never matches.
      return evaluate(program, { row }) === true;
    } catch (err) {
      if (err instanceof EvalError) {
        onEvalError?.();
        return false; // non-matching — never breaks paint
      }
      throw err;
    }
  };
  return {
    ok: true,
    compiled: { matches, diffAware: state.diffAware, watchedColIds: state.watched },
  };
}

function shapeError(ruleId: string, message: string): RuleValidationError {
  return { ruleId, code: 'bad-shape', message, loc: null };
}

/**
 * Structural checks only — no condition/formatter compilation. Exported for
 * RuleEngine.setRules (Task 3), which compiles condition + valueFormatter
 * itself to keep the compiled artifacts; not re-exported from index.ts.
 */
export function validateRuleShape(rule: StyleRule): RuleValidationError[] {
  const errors: RuleValidationError[] = [];
  const ruleId = typeof rule.id === 'string' ? rule.id : '';
  if (typeof rule.id !== 'string' || rule.id.length === 0) {
    errors.push(shapeError(ruleId, 'rule.id must be a nonempty string'));
  }
  if (typeof rule.name !== 'string' || rule.name.length === 0) {
    errors.push(shapeError(ruleId, 'rule.name must be a nonempty string'));
  }
  if (typeof rule.priority !== 'number' || !Number.isFinite(rule.priority)) {
    errors.push(shapeError(ruleId, 'rule.priority must be a finite number'));
  }
  if (typeof rule.condition !== 'string' || rule.condition.trim().length === 0) {
    errors.push(shapeError(ruleId, 'rule.condition must be a nonempty string'));
  }
  const scope = rule.scope as unknown as { kind?: unknown; columnIds?: unknown };
  const scopeOk =
    typeof scope === 'object' &&
    scope !== null &&
    (scope.kind === 'row' ||
      (scope.kind === 'cell' &&
        Array.isArray(scope.columnIds) &&
        scope.columnIds.length > 0 &&
        scope.columnIds.every((colId) => typeof colId === 'string' && colId.length > 0)));
  if (!scopeOk) {
    errors.push(
      shapeError(
        ruleId,
        "rule.scope must be { kind: 'row' } or { kind: 'cell', columnIds: [nonempty colIds] }",
      ),
    );
  }
  if (rule.kind === 'style') {
    if (typeof rule.style !== 'object' || rule.style === null) {
      errors.push(shapeError(ruleId, 'style rules require a style object'));
    }
  } else if (rule.kind === 'indicator') {
    if (typeof rule.indicator !== 'object' || rule.indicator === null) {
      errors.push(shapeError(ruleId, 'indicator rules require an indicator object'));
    }
  } else {
    errors.push(
      shapeError(ruleId, `unknown rule kind '${String((rule as { kind?: unknown }).kind)}'`),
    );
  }
  return errors;
}

export function validateRule(rule: StyleRule, schema?: Schema): RuleValidationError[] {
  const errors = validateRuleShape(rule);
  if (rule.kind === 'style' && typeof rule.valueFormatter === 'string') {
    const fmt = compileFormat(rule.valueFormatter);
    if (!fmt.ok) {
      errors.push({
        ruleId: rule.id,
        code: 'format-compile',
        message: fmt.error.message,
        loc: fmt.error.loc,
      });
    }
  }
  if (typeof rule.condition === 'string' && rule.condition.trim().length > 0) {
    const cond = compileCondition(rule.condition, rule.id, schema);
    if (!cond.ok) errors.push(cond.error);
  }
  return errors;
}
