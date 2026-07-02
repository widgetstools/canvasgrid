import type {
  CompileFormatOptions,
  CompileFormatResult,
  CompositeColDef,
  FormatEvalContext,
  FormatProgram,
  FormatSource,
  StyleObj,
  IconRef,
  ResolvedFragment,
} from './types';
import { tokenize, type Token } from './tokenizer';
import { parseExcel, type ExcelFormatTree } from './excel/parser';
import { evaluateExcel } from './excel/evaluator';
import { parseTier1Brackets, type Tier1Node } from './tier1/parser';
import { resolveStyle, resolveIcon } from './tier1/resolver';
import { compileFragments, resolveFragments, resolveCellBackground, type CompiledFragmentPlan } from './tier2/fragmentResolver';

export function compileFormat(source: FormatSource, opts?: CompileFormatOptions): CompileFormatResult {
  const locale = opts?.locale ?? 'en-US';
  const currency = opts?.currency ?? 'USD';

  if (typeof source !== 'string') {
    return compileCompositeColDef(source, opts);
  }

  const tokens = tokenize(source);

  // Split tokens: Excel tree = all non-Tier1-bracket, non-icon tokens.
  const excelTokens: Token[] = [];
  const tier1Brackets: Array<{ channel: 'color' | 'bg' | 'weight' | 'style' | 'if'; interior: string; interiorLoc: { start: number; end: number }; loc: { start: number; end: number } }> = [];
  const iconTokens: Array<{ name: string; dynamicExpr?: string }> = [];

  for (const t of tokens) {
    if (t.kind === 'tier1-bracket') {
      tier1Brackets.push({ channel: t.channel, interior: t.interior, interiorLoc: t.interiorLoc, loc: t.loc });
    } else if (t.kind === 'icon-token') {
      iconTokens.push({ name: t.name, dynamicExpr: t.dynamicExpr });
    } else {
      excelTokens.push(t);
    }
  }

  const excelResult = parseExcel(excelTokens);
  if (!excelResult.ok) {
    return {
      ok: false,
      error: {
        kind: 'compile-format',
        code: excelResult.error.code,
        message: excelResult.error.message,
        loc: excelResult.error.loc,
      },
    };
  }

  const tier1Result = parseTier1Brackets(tier1Brackets);
  if (!tier1Result.ok) {
    return { ok: false, error: tier1Result.error };
  }

  const excelTree = excelResult.tree;
  const tier1Nodes = tier1Result.nodes;

  const tier0 = excelTokens.length > 0;
  const tier1 = tier1Nodes.length > 0 || iconTokens.length > 0;
  const tier2 = false;

  const program: FormatProgram = {
    source,
    tiers: { tier0, tier1, tier2 },
    formatText: (ctx: FormatEvalContext): string => {
      const result = evaluateExcel(excelTree, { value: ctx.value, locale, currency });
      return result.text;
    },
    resolveStyle: (ctx: FormatEvalContext): StyleObj | null => {
      const excelStyle = evaluateExcel(excelTree, { value: ctx.value, locale, currency }).style;
      const tier1Style = tier1Nodes.length > 0 ? resolveStyle(tier1Nodes, ctx) : null;
      if (!excelStyle && !tier1Style) return null;
      return { ...excelStyle, ...tier1Style };  // tier1 wins per §3.2 spec
    },
    resolveIcon: (ctx: FormatEvalContext): IconRef | null => {
      if (iconTokens.length === 0) return null;
      return resolveIcon(iconTokens, ctx);
    },
    resolveFragments: (): ResolvedFragment[] | null => null,
  };

  return { ok: true, program };
}

export function compileCompositeColDef(colDef: CompositeColDef, opts?: CompileFormatOptions): CompileFormatResult {
  const plan: CompiledFragmentPlan = compileFragments(colDef, opts);

  const program: FormatProgram = {
    source: colDef,
    tiers: { tier0: false, tier1: false, tier2: true },
    formatText: (ctx: FormatEvalContext): string => {
      const fragments = resolveFragments(plan, ctx);
      return fragments.map((f) => f.text).join('');
    },
    resolveStyle: (ctx: FormatEvalContext): StyleObj | null => {
      return resolveCellBackground(plan, ctx);
    },
    resolveIcon: (): IconRef | null => null,
    resolveFragments: (ctx: FormatEvalContext): ResolvedFragment[] | null => resolveFragments(plan, ctx),
  };

  return { ok: true, program };
}
