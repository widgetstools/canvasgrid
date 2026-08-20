import { parse as parseExpression, compile as compileExpression, type Ast } from '../../expression/index';
import type { Loc } from '../../expression/index';
import type { CompileFormatError, RuleRefNode } from '../types';
import { canonicalize } from './sugar';

export interface Tier1Node {
  channel: 'color' | 'bg' | 'weight' | 'style' | 'if';
  ast: Ast | null;             // null when the interior compiles to a rule-ref only
  ruleRefs: RuleRefNode[];
  loc: Loc;
}

export type Tier1ParseResult =
  | { ok: true; nodes: Tier1Node[] }
  | { ok: false; error: CompileFormatError };

export function parseTier1Brackets(
  brackets: Array<{ channel: Tier1Node['channel']; interior: string; interiorLoc: Loc; loc: Loc }>,
): Tier1ParseResult {
  const nodes: Tier1Node[] = [];

  for (const b of brackets) {
    const sugar = canonicalize(b.interior, b.interiorLoc);

    if (sugar.canonicalized.trim() === 'null' && sugar.ruleRefs.length > 0) {
      // Pure rule-ref — no expression to parse.
      nodes.push({ channel: b.channel, ast: null, ruleRefs: sugar.ruleRefs, loc: b.loc });
      continue;
    }

    const parseResult = parseExpression(sugar.canonicalized);
    if (!parseResult.ok) {
      return {
        ok: false,
        error: {
          kind: 'compile-format',
          code: 'expression-parse',
          message: `expression parse error inside [${b.channel}=...]: ${parseResult.error.message}`,
          loc: translateExprLocToFormatLoc(parseResult.error.loc, sugar.canonicalized, b.interior, b.interiorLoc),
          cause: { source: 'expression', inner: parseResult.error },
        },
      };
    }

    // Also compile — surfaces aggregate/prev not-yet-implemented at bracket time
    // so consumers get a clear error before eval.
    const compileResult = compileExpression(parseResult.ast);
    if (!compileResult.ok) {
      return {
        ok: false,
        error: {
          kind: 'compile-format',
          code: 'expression-compile',
          message: `expression compile error inside [${b.channel}=...]: ${compileResult.error.message}`,
          loc: translateExprLocToFormatLoc(compileResult.error.loc, sugar.canonicalized, b.interior, b.interiorLoc),
          cause: { source: 'expression', inner: compileResult.error },
        },
      };
    }

    nodes.push({ channel: b.channel, ast: parseResult.ast, ruleRefs: sugar.ruleRefs, loc: b.loc });
  }

  return { ok: true, nodes };
}

/**
 * Best-effort loc translation: canonicalized string has different offsets
 * than the original interior (sugar rewrites change lengths). We map
 * expression's loc onto the interior's loc via a simple proportional
 * scaling. For customizer editor UX, this is "good enough" — the loc
 * points into the bracket's interior, not to a specific char within.
 */
function translateExprLocToFormatLoc(
  exprLoc: Loc,
  canonicalized: string,
  interior: string,
  interiorLoc: Loc,
): Loc {
  if (canonicalized.length === 0) return interiorLoc;
  const startPct = exprLoc.start / canonicalized.length;
  const endPct = exprLoc.end / canonicalized.length;
  return {
    start: Math.floor(interiorLoc.start + interior.length * startPct),
    end: Math.ceil(interiorLoc.start + interior.length * endPct),
  };
}
