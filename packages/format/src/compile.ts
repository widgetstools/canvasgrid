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
import { parse as parseExpr, compile as compileExpr, evaluate as evaluateExpr } from '@wellsfargo-starui/velocity-grid-expression';
import { tokenize, type Token } from './tokenizer';
import { parseExcel, type ExcelFormatTree } from './excel/parser';
import { evaluateExcel } from './excel/evaluator';
import { parseTier1Brackets, type Tier1Node } from './tier1/parser';
import { resolveStyle, resolveIcon, evaluateIfSelector } from './tier1/resolver';
import { compileFragments, resolveFragments, resolveCellBackground, type CompiledFragmentPlan } from './tier2/fragmentResolver';
import { formatTick, parseTickFormat } from './excel/tick';

export function compileFormat(source: FormatSource, opts?: CompileFormatOptions): CompileFormatResult {
  const locale = opts?.locale ?? 'en-US';
  const currency = opts?.currency ?? 'USD';

  if (typeof source !== 'string') {
    return compileCompositeColDef(source, opts);
  }

  // Fixed-income tick tokens — whole-string sections (spec §3.1). Handled
  // before tokenization: `TICK32` would otherwise lex as literals.
  const tick = parseTickFormat(source);
  if (tick) {
    const program: FormatProgram = {
      source,
      tiers: { tier0: true, tier1: false, tier2: false },
      formatText: (ctx: FormatEvalContext): string => formatTick(ctx.value, tick.denom, tick.halves),
      resolveStyle: (): StyleObj | null => null,
      resolveIcon: (): IconRef | null => null,
      resolveFragments: (): ResolvedFragment[] | null => null,
    };
    return { ok: true, program };
  }

  // `=expr` value-formatter form (spec §3.3): the expression's stringified
  // result IS the formatted output. `value` is bound over the row so it
  // wins field collisions; eval NEVER throws out of formatText.
  const trimmed = source.trimStart();
  if (trimmed.startsWith('=')) {
    const parsed = parseExpr(trimmed.slice(1));
    if (!parsed.ok) {
      return {
        ok: false,
        error: { kind: 'compile-format', code: 'expression-parse', message: parsed.error.message, loc: parsed.error.loc },
      };
    }
    const compiled = compileExpr(parsed.ast);
    if (!compiled.ok) {
      return {
        ok: false,
        error: { kind: 'compile-format', code: 'expression-compile', message: compiled.error.message, loc: compiled.error.loc },
      };
    }
    const exprProgram: FormatProgram = {
      source,
      tiers: { tier0: true, tier1: false, tier2: false },
      formatText: (ctx: FormatEvalContext): string => {
        try {
          const out = evaluateExpr(compiled.compiled, { row: { ...ctx.row, value: ctx.value } });
          return out === null || out === undefined ? '' : String(out);
        } catch {
          return '';
        }
      },
      resolveStyle: (): StyleObj | null => null,
      resolveIcon: (): IconRef | null => null,
      resolveFragments: (): ResolvedFragment[] | null => null,
    };
    return { ok: true, program: exprProgram };
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

  // Tier 1 `[if <expr>]` section selectors. The brackets were stripped
  // from the Excel token stream above, which loses their section
  // membership — recover it by counting section separators before each
  // bracket's source position. Selection: first section (in order)
  // whose predicate evaluates true wins; when none match, fall back to
  // the first section WITHOUT a selector; when every section carries a
  // failing selector, standard sign routing applies.
  const separatorStarts = tokens
    .filter((t) => t.kind === 'section-separator')
    .map((t) => t.loc.start);
  const sectionIndexForPos = (pos: number): number => {
    let idx = 0;
    for (const s of separatorStarts) {
      if (pos > s) idx++;
      else break;
    }
    return idx;
  };
  const ifSelectors: Array<{ sectionIndex: number; node: Tier1Node }> = [];
  tier1Nodes.forEach((node) => {
    if (node.channel !== 'if') return;
    ifSelectors.push({ sectionIndex: sectionIndexForPos(node.loc.start), node });
  });
  const selectIfSection = (ctx: FormatEvalContext): number | undefined => {
    if (ifSelectors.length === 0) return undefined;
    for (const s of ifSelectors) {
      if (evaluateIfSelector(s.node, ctx)) return s.sectionIndex;
    }
    const withSelector = new Set(ifSelectors.map((s) => s.sectionIndex));
    for (let i = 0; i < excelTree.sections.length; i++) {
      if (!withSelector.has(i)) return i;
    }
    return undefined;
  };

  const tier0 = excelTokens.length > 0;
  const tier1 = tier1Nodes.length > 0 || iconTokens.length > 0;
  const tier2 = false;
  // Cycle 21e: any bracket that carried a rule:<id> — pure ([color=rule:hot],
  // ast === null, accessor-resolved) or mixed (ref baked to literal null by
  // sugar.ts). Kernel Task 14 uses this to bypass the format-eval memo.
  const hasRuleRefs = tier1Nodes.some((n) => n.ruleRefs.length > 0);

  const program: FormatProgram = {
    source,
    tiers: { tier0, tier1, tier2 },
    ...(hasRuleRefs ? { hasRuleRefs: true } : {}),
    formatText: (ctx: FormatEvalContext): string => {
      const result = evaluateExcel(excelTree, {
        value: ctx.value, locale, currency, forceSectionIndex: selectIfSection(ctx),
      });
      return result.text;
    },
    resolveStyle: (ctx: FormatEvalContext): StyleObj | null => {
      const excelStyle = evaluateExcel(excelTree, {
        value: ctx.value, locale, currency, forceSectionIndex: selectIfSection(ctx),
      }).style;
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

  // Cycle 21e: composite programs carry rule refs via fragment-style
  // [<expr>] shorthands (dynamic channels) and the cellBackground program.
  const nodesHaveRefs = (nodes: Tier1Node[] | null): boolean =>
    nodes !== null && nodes.some((n) => n.ruleRefs.length > 0);
  const hasRuleRefs =
    plan.fragments.some(
      (f) =>
        f.kind === 'expr' &&
        (nodesHaveRefs(f.dynamicColor) || nodesHaveRefs(f.dynamicBg) ||
         nodesHaveRefs(f.dynamicWeight) || nodesHaveRefs(f.dynamicItalic)),
    ) || nodesHaveRefs(plan.cellBackgroundProgram?.nodes ?? null);

  const program: FormatProgram = {
    source: colDef,
    tiers: { tier0: false, tier1: false, tier2: true },
    ...(hasRuleRefs ? { hasRuleRefs: true } : {}),
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
