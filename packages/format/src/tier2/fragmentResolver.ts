import { parse as parseExpr, compile as compileExpr, evaluate as evaluateExpr, type Compiled } from '@cgrid/expression';
import type { CompositeColDef, Fragment, FragmentStyle, ResolvedFragment, FormatEvalContext, StyleObj, IconRef } from '../types';
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
  iconTokens: Array<{ name: string; dynamicExpr?: string }>;  // Extracted from per-fragment format string
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
}

export function compileFragments(colDef: CompositeColDef): CompiledFragmentPlan {
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
    const iconTokens: Array<{ name: string; dynamicExpr?: string }> = [];
    if (frag.format !== undefined) {
      // Split tokens: Excel tokens go into excelTree; icon tokens are extracted
      // so per-fragment format strings can carry {icon:name} (spec §3.4 example).
      const allTokens = tokenize(frag.format);
      const excelTokens = allTokens.filter((t) => t.kind !== 'icon-token');
      for (const t of allTokens) {
        if (t.kind === 'icon-token') {
          iconTokens.push({ name: t.name, dynamicExpr: t.dynamicExpr });
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
      iconTokens,
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

  return { fragments: compiled, cellBackgroundProgram };
}

function extractDynamic(
  staticStyle: FragmentStyle,
  key: 'color' | 'background' | 'weight' | 'style',
): Tier1Node[] | null {
  const raw = staticStyle[key as keyof FragmentStyle] as unknown;
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('[') || !raw.endsWith(']')) return null;
  // Shorthand: `[<expr>]` → wrap as Tier 1 bracket with matching channel.
  const interior = raw.slice(1, -1);
  const channel: Tier1Node['channel'] = key === 'background' ? 'bg' : key === 'style' ? 'style' : (key as 'color' | 'weight');
  const result = parseTier1Brackets([{ channel, interior, interiorLoc: { start: 1, end: raw.length - 1 }, loc: { start: 0, end: raw.length } }]);
  if (!result.ok) return null;
  // Delete the raw property so it isn't applied as literal.
  delete (staticStyle as Record<string, unknown>)[key];
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
    if (frag.excelTree && frag.excelTree.ok) {
      const result = evaluateExcel(frag.excelTree.tree, { value, locale: 'en-US', currency: 'USD' });
      text = result.text;
    } else {
      text = value === null || value === undefined ? '' : String(value);
    }

    const style: FragmentStyle = { ...frag.staticStyle };
    if (frag.dynamicColor) {
      const s = resolveStyle(frag.dynamicColor, { value, row: ctx.row, colId: ctx.colId });
      if (s?.color) style.color = s.color;
    }
    if (frag.dynamicBg) {
      const s = resolveStyle(frag.dynamicBg, { value, row: ctx.row, colId: ctx.colId });
      if (s?.background) style.background = s.background;
    }
    if (frag.dynamicWeight) {
      const s = resolveStyle(frag.dynamicWeight, { value, row: ctx.row, colId: ctx.colId });
      if (s?.weight !== undefined) style.weight = s.weight;
    }
    if (frag.dynamicItalic) {
      const s = resolveStyle(frag.dynamicItalic, { value, row: ctx.row, colId: ctx.colId });
      if (s?.italic !== undefined) style.style = s.italic ? 'italic' : 'normal';
    }

    // Icon extracted from per-fragment format string (spec §3.4 example).
    let icon: IconRef | undefined;
    if (frag.iconTokens.length > 0) {
      const resolved = resolveIcon(frag.iconTokens, { value, row: ctx.row, colId: ctx.colId });
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
