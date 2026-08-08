import {
  parse as parseExprForIcon,
  compile as compileExpression,
  evaluate as evaluateExpression,
  type Ast,
  type Compiled,
} from '@wellsfargo-starui/velocity-grid-expression';
import type { FormatEvalContext, StyleObj, IconRef } from '../types';
import type { Tier1Node } from './parser';

// Compile cache keyed by AST identity — the parser stage may hand us the
// same AST across multiple ctx evals in a paint loop.
const compileCache = new WeakMap<Ast, Compiled>();

function getCompiled(ast: Ast): Compiled {
  let c = compileCache.get(ast);
  if (!c) {
    const r = compileExpression(ast);
    if (!r.ok) {
      // Shouldn't happen — parseTier1Brackets already compile-tested.
      throw new Error(`Tier1 resolver: compile failed for AST — ${r.error.message}`);
    }
    c = r.compiled;
    compileCache.set(ast, c);
  }
  return c;
}

/** Evaluate an `[if <expr>]` section-selector node against a row.
 *  Returns false (never throws) on eval errors or pure rule-refs so a
 *  broken predicate degrades to "section doesn't match". */
export function evaluateIfSelector(node: Tier1Node, ctx: FormatEvalContext): boolean {
  if (node.ast === null) return false;
  try {
    return Boolean(evaluateExpression(getCompiled(node.ast), { row: ctx.row }));
  } catch {
    return false;
  }
}

export function resolveStyle(nodes: Tier1Node[], ctx: FormatEvalContext): StyleObj | null {
  if (nodes.length === 0) return null;
  let style: StyleObj | null = null;

  for (const node of nodes) {
    if (node.channel === 'if') continue;  // section selector, not a style channel

    let evaluated: unknown;
    if (node.ast === null) {
      // Pure rule-ref bracket (Cycle 21e). Consult the optional accessor;
      // the FIRST non-null resolution feeds this bracket's channel via the
      // switch below (color or background per the bracket key). Accessor
      // absent, or every ref resolving null → null contribution — exact
      // Cycle 21c reserve behavior.
      if (ctx.resolveRuleRef === undefined) continue;
      evaluated = null;
      for (const ref of node.ruleRefs) {
        const resolved = ctx.resolveRuleRef(ref.ruleId) ?? null;
        if (resolved !== null) {
          evaluated = resolved;
          break;
        }
      }
    } else {
      try {
        evaluated = evaluateExpression(getCompiled(node.ast), { row: ctx.row });
      } catch {
        continue;  // per-cell eval error — skip this channel
      }
    }
    if (evaluated === null || evaluated === undefined) continue;

    if (!style) style = {};
    switch (node.channel) {
      case 'color':
        style.color = String(evaluated);
        break;
      case 'bg':
        style.background = String(evaluated);
        break;
      case 'weight':
        style.weight = normalizeWeight(evaluated);
        break;
      case 'style':
        style.italic = String(evaluated) === 'italic';
        break;
    }
  }
  return style;
}

function normalizeWeight(v: unknown): 'normal' | 'bold' | number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'normal';
  const s = String(v);
  if (s === 'bold' || s === 'normal') return s;
  const n = Number(s);
  return Number.isFinite(n) ? n : 'normal';
}

export function resolveIcon(
  iconTokens: Array<{ name: string; dynamicExpr?: string }>,
  ctx: FormatEvalContext,
): IconRef | null {
  if (iconTokens.length === 0) return null;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const first = iconTokens[0]!;
  let name = first.name;

  if (first.dynamicExpr !== undefined && first.dynamicExpr !== '') {
    const parseResult = parseExprForIcon(first.dynamicExpr);
    if (!parseResult.ok) return null;
    const compileResult = compileExpression(parseResult.ast);
    if (!compileResult.ok) return null;
    let evaluated: unknown;
    try {
      evaluated = evaluateExpression(compileResult.compiled, { row: ctx.row });
    } catch {
      return null;
    }
    if (typeof evaluated !== 'string' || evaluated === '') return null;
    name = evaluated;
  }

  if (!name) return null;
  return { name, position: 'leading' };
}
