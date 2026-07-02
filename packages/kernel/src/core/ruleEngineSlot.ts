// Kernel-side rule-engine dependency-injection slot.
//
// @cgrid/rules registers its engine adapter via wireIntoKernel(); kernel
// consults the registered engine in propertyChain.applyCellProps (Cycle 21e
// Task 11) and threads resolveRuleRef into format-eval contexts (Task 14).
// Kernel does NOT import @cgrid/rules at runtime — only structural types,
// exactly like core/formatCompilerSlot.ts.

/** Evaluation context the kernel paint path supplies per data cell.
 *  Spec: docs/superpowers/specs/2026-07-01-cycle-21e-rules-design.md §5.2. */
export interface RuleEvalCtxShape {
  row: unknown;
  rowId: string;
  /** null → row-scope evaluation (no cell column). */
  colId: string | null;
  theme: 'light' | 'dark';
}

/** Folded per-cell rule result. Structural mirror of @cgrid/rules'
 *  RuleCellResult (spec §4.2) — formatProgram stays `unknown` because
 *  kernel only forwards it into FormatProgramShape.formatText. */
export interface RuleCellPatchShape {
  matched: string[];
  style: {
    color?: string;
    backgroundColor?: string;
    fontWeight?: 'normal' | 'bold' | number;
    fontStyle?: 'normal' | 'italic';
    textDecoration?: string;
    borderColor?: string;
    borderStyle?: string;
  } | null;
  indicator: { iconName: string; color: string; target: string; position: string } | null;
  formatProgram: unknown | null;
}

export interface RuleEngineShape {
  evaluateCell(ctx: RuleEvalCtxShape): RuleCellPatchShape;
  resolveRuleRef(ruleId: string, ctx: RuleEvalCtxShape): string | null;
}

let injectedEngine: RuleEngineShape | null = null;

export function registerRuleEngine(engine: RuleEngineShape): void {
  injectedEngine = engine;
}

export function getRuleEngine(): RuleEngineShape | null {
  return injectedEngine;
}

/** Test-only helper — not part of public API. */
export function _resetRuleEngine_forTests(): void {
  injectedEngine = null;
}
