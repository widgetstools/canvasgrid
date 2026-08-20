import { parse as parseExpr, compile as compileExpr, evaluate as evaluateExpr, type Compiled } from '../../expression/index';
import type { CompositeColDef, FragmentStyle, ResolvedFragment, FormatEvalContext, StyleObj, IconRef, CompileFormatOptions } from '../types';
import { tokenize } from '../tokenizer';
import { parseExcel } from '../excel/parser';
import { evaluateExcel } from '../excel/evaluator';
import { parseTier1Brackets, type Tier1Node } from '../tier1/parser';
import { resolveStyle, resolveIcon } from '../tier1/resolver';

interface CompiledStaticFragment { kind: 'static'; text: string; style: FragmentStyle; }
interface CompiledExprFragment {
  kind: 'expr';
  exprCompiled: Compiled;
  excelTree: ReturnType<typeof parseExcel> | null;
  /** Per-section icon tokens: sectionIcons[i] holds icons for format section i. */
  sectionIcons: Array<Array<{ name: string; dynamicExpr?: string }>>;
  staticStyle: FragmentStyle;
  dynamicColor: Tier1Node[] | null;
  dynamicBg: Tier1Node[] | null;
  dynamicWeight: Tier1Node[] | null;
  dynamicItalic: Tier1Node[] | null;
}

type CompiledFragment = CompiledStaticFragment | CompiledExprFragment;

export interface CompiledFragmentPlan {
  fragments: CompiledFragment[];
  cellBackgroundProgram: { nodes: Tier1Node[] } | null;
  locale: string;
  currency: string;
}

export function compileFragments(colDef: CompositeColDef, opts?: CompileFormatOptions): CompiledFragmentPlan {
  const locale = opts?.locale ?? 'en-US';
  const currency = opts?.currency ?? 'USD';
  const compiled: CompiledFragment[] = [];

  for (const frag of colDef.fragments) {
    if ('text' in frag) {
      compiled.push({ kind: 'static', text: frag.text, style: {} });
      continue;
    }

    const parseResult = parseExpr(frag.expr);
    if (!parseResult.ok) {
      compiled.push({ kind: 'static', text: `[parse error: ${parseResult.error.message}]`, style: {} });
      continue;
    }
    const compileResult = compileExpr(parseResult.ast);
    if (!compileResult.ok) {
      compiled.push({ kind: 'static', text: `[compile error: ${compileResult.error.message}]`, style: {} });
      continue;
    }

    let excelTree: ReturnType<typeof parseExcel> | null = null;
    // sectionIcons[i] = icons belonging to format section i (0-based).
    const sectionIcons: Array<Array<{ name: string; dynamicExpr?: string }>> = [[]];
    let currentSection = 0;
    if (frag.format !== undefined) {
      // Split tokens: Excel tokens go into excelTree; icon tokens are extracted
      // per section so multi-section formats route icons correctly (spec §3.4).
      const allTokens = tokenize(frag.format);
      const excelTokens = allTokens.filter((t) => t.kind !== 'icon-token');
      for (const t of allTokens) {
        if (t.kind === 'section-separator') {
          currentSection++;
          sectionIcons.push([]);
        } else if (t.kind === 'icon-token') {
          sectionIcons[currentSection]!.push({ name: t.name, dynamicExpr: t.dynamicExpr });
        }
      }
      excelTree = parseExcel(excelTokens);
    }

    const staticStyle: FragmentStyle = { ...(frag.style ?? {}) };
    const dynamicColor = extractDynamic(staticStyle, 'color');
    const dynamicBg = extractDynamic(staticStyle, 'background');
    const dynamicWeight = extractDynamic(staticStyle, 'weight');
    const dynamicItalic = extractDynamic(staticStyle, 'style');

    compiled.push({
      kind: 'expr',
      exprCompiled: compileResult.compiled,
      excelTree,
      sectionIcons,
      staticStyle,
      dynamicColor,
      dynamicBg,
      dynamicWeight,
      dynamicItalic,
    });
  }

  let cellBackgroundProgram: CompiledFragmentPlan['cellBackgroundProgram'] = null;
  if (colDef.cellBackground) {
    const tokens = tokenize(colDef.cellBackground);
    const brackets = tokens.filter((t) => t.kind === 'tier1-bracket' && (t.channel === 'bg' || t.channel === 'if'));
    if (brackets.length > 0) {
      const bs = brackets.map((b) => {
        if (b.kind !== 'tier1-bracket') throw new Error('unreachable');
        return { channel: b.channel, interior: b.interior, interiorLoc: b.interiorLoc, loc: b.loc };
      });
      const result = parseTier1Brackets(bs);
      if (result.ok) {
        cellBackgroundProgram = { nodes: result.nodes };
      }
    }
  }

  return { fragments: compiled, cellBackgroundProgram, locale, currency };
}

function extractDynamic(
  staticStyle: FragmentStyle,
  key: 'color' | 'background' | 'weight' | 'style',
): Tier1Node[] | null {
  const raw = staticStyle[key as keyof FragmentStyle] as unknown;
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('[') || !raw.endsWith(']')) return null;

  // The [<expr>] pattern was detected — delete the raw property so it
  // never applies as a literal CSS value, regardless of parse outcome.
  delete (staticStyle as Record<string, unknown>)[key];

  // Shorthand: `[<expr>]` → wrap as Tier 1 bracket with matching channel.
  const interior = raw.slice(1, -1);
  const channel: Tier1Node['channel'] = key === 'background' ? 'bg' : key === 'style' ? 'style' : (key as 'color' | 'weight');
  const result = parseTier1Brackets([{ channel, interior, interiorLoc: { start: 1, end: raw.length - 1 }, loc: { start: 0, end: raw.length } }]);
  if (!result.ok) {
    console.debug(`[cgrid.format] malformed [<expr>] shorthand in fragment style: ${result.error.message}`);
    return null;
  }
  return result.nodes;
}

export function resolveFragments(plan: CompiledFragmentPlan, ctx: FormatEvalContext): ResolvedFragment[] {
  return plan.fragments.map((frag) => {
    if (frag.kind === 'static') {
      return { text: frag.text, style: frag.style };
    }
    let value: unknown;
    try {
      value = evaluateExpr(frag.exprCompiled, { row: ctx.row });
    } catch {
      value = null;
    }
    let text: string;
    let sectionIndex = 0;
    if (frag.excelTree && frag.excelTree.ok) {
      const result = evaluateExcel(frag.excelTree.tree, { value, locale: plan.locale, currency: plan.currency });
      text = result.text;
      sectionIndex = result.sectionIndex;
    } else {
      text = value === null || value === undefined ? '' : String(value);
    }

    // Per-fragment eval context: the fragment's own value, the outer row,
    // and (Cycle 21e) the rule-ref accessor forwarded from the outer ctx.
    const fragCtx: FormatEvalContext = {
      value,
      row: ctx.row,
      colId: ctx.colId,
      resolveRuleRef: ctx.resolveRuleRef,
    };

    const style: FragmentStyle = { ...frag.staticStyle };
    if (frag.dynamicColor) {
      const s = resolveStyle(frag.dynamicColor, fragCtx);
      if (s?.color) style.color = s.color;
    }
    if (frag.dynamicBg) {
      const s = resolveStyle(frag.dynamicBg, fragCtx);
      if (s?.background) style.background = s.background;
    }
    if (frag.dynamicWeight) {
      const s = resolveStyle(frag.dynamicWeight, fragCtx);
      if (s?.weight !== undefined) style.weight = s.weight;
    }
    if (frag.dynamicItalic) {
      const s = resolveStyle(frag.dynamicItalic, fragCtx);
      if (s?.italic !== undefined) style.style = s.italic ? 'italic' : 'normal';
    }

    // Icon extracted from per-fragment format string (spec §3.4 example).
    // Use the section-scoped icons so multi-section formats pick the correct icon.
    let icon: IconRef | undefined;
    const iconsForSection = frag.sectionIcons[sectionIndex] ?? frag.sectionIcons[0] ?? [];
    if (iconsForSection.length > 0) {
      const resolved = resolveIcon(iconsForSection, fragCtx);
      if (resolved) icon = resolved;
    }

    return icon ? { text, style, icon } : { text, style };
  });
}

/** Resolve cellBackground → StyleObj (used by FormatProgram.resolveStyle for composite). */
export function resolveCellBackground(plan: CompiledFragmentPlan, ctx: FormatEvalContext): StyleObj | null {
  if (!plan.cellBackgroundProgram) return null;
  return resolveStyle(plan.cellBackgroundProgram.nodes, ctx);
}
