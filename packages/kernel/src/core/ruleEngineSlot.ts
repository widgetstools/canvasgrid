// Kernel-side rule-engine dependency-injection slot.
//
// @wellsfargo-starui/velocity-grid/rules registers its engine adapter via wireIntoKernel(); kernel
// consults the registered engine in propertyChain.applyCellProps (Cycle 21e
// Task 11) and threads resolveRuleRef into format-eval contexts (Task 14).
// Kernel does NOT import @wellsfargo-starui/velocity-grid/rules at runtime — only structural types,
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

/** Folded per-cell rule result. Structural mirror of @wellsfargo-starui/velocity-grid/rules'
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
    halign?: 'left' | 'center' | 'right';
    /** Legacy single-border pair (all sides, width 1). */
    borderColor?: string;
    borderStyle?: string;
    /** Per-side borders — kernel `BorderSpec` vocabulary; wins over the
     *  legacy pair when both are present. */
    border?: {
      top?: { width?: number; color?: string; style?: string };
      right?: { width?: number; color?: string; style?: string };
      bottom?: { width?: number; color?: string; style?: string };
      left?: { width?: number; color?: string; style?: string };
      all?: { width?: number; color?: string; style?: string };
    };
  } | null;
  indicator: { iconName: string; color: string; target: string; position: string } | null;
  formatProgram: unknown | null;
}

/** Grid Layouts (Phase C / C3) — a conditional-rule object as the kernel's
 *  VelocityGridApi rule methods manipulate it. The kernel only touches `id`
 *  (identity), `enabled` (toggle), and `priority` (update) for its pure array
 *  transforms; the rest of the @wellsfargo-starui/velocity-grid/rules `StyleRule` payload is carried
 *  through verbatim (the rule engine owns its full shape + validation).
 *
 *  Deliberately NO index signature: a nominal `@wellsfargo-starui/velocity-grid/rules` rule type (which
 *  has no index signature) must stay assignable to this — TS rejects assigning
 *  a no-index-signature source to an index-signature target. The minimal shape
 *  keeps the kernel↔rules boundary structural (the slot never imports
 *  @wellsfargo-starui/velocity-grid/rules) while letting consumers pass their fully-typed rules directly. */
export interface ConditionalRuleShape {
  id: string;
  enabled?: boolean;
  priority?: number;
  /** Present on style rules from @velocity-grid-rules; kernel uses
   *  `flash.enabled` + scope to suppress default cell-change flash. */
  kind?: string;
  flash?: { enabled?: boolean; target?: string };
  scope?: { kind?: string; columnIds?: readonly string[] };
}

export interface RuleEngineShape {
  evaluateCell(ctx: RuleEvalCtxShape): RuleCellPatchShape;
  resolveRuleRef(ruleId: string, ctx: RuleEvalCtxShape): string | null;
  /**
   * Unconditional header style for `colId`, merged across enabled style
   * rules whose `target` includes the header. `null` when none apply.
   *
   * Separate from `evaluateCell` because a header has no row to evaluate a
   * condition against. Optional so an engine that predates header targets
   * still satisfies the slot — the header fold simply does nothing.
   */
  headerStyleFor?(colId: string, theme: 'light' | 'dark'): {
    color?: string; backgroundColor?: string;
    fontWeight?: unknown; fontStyle?: string; textDecoration?: string;
    halign?: 'left' | 'center' | 'right';
    border?: unknown; borderColor?: string; borderStyle?: string;
  } | null;
  /** Grid Layouts (Phase C / C3) — the current rule set (full serializable
   *  snapshot). Optional so a paint-only engine adapter still satisfies the
   *  slot; the VelocityGridApi rule methods degrade to `[]` / no-op without it. */
  getRules?(): ConditionalRuleShape[];
  /** Grid Layouts (Phase C / C3) — REPLACE the rule set. The @wellsfargo-starui/velocity-grid/rules
   *  bridge re-seeds match counts (setRules zeroes them). */
  setRules?(rules: ConditionalRuleShape[]): void;
}

// ── Ownership: per-grid, with this slot as the fallback ──────────────────
//
// This was a module-global singleton and nothing else, which meant that with
// two VelocityGrid instances on one page the last `registerRuleEngine` call
// won for BOTH grids' paint-time lookup: the first grid silently started
// painting with the second grid's rules. That is an ordinary blotter layout
// — positions and orders stacked on one page — and the two grids there have
// deliberately different rule sets, so the cross-talk was immediate and
// visible rather than coincidentally masked.
//
// The engine is now owned by the grid that registered it (`VelocityGrid`
// holds it and threads it into the paint context), and every kernel consumer
// prefers the threaded one. This slot is kept for two reasons:
//
//   1. a paint path that has no grid in scope (the composite/export
//      fragment builders) still has to resolve SOMETHING, and with a single
//      grid — the overwhelmingly common case — the slot is exactly right;
//   2. it keeps `registerRuleEngine` / `_resetRuleEngine_forTests`
//      behaviourally unchanged for every existing caller.
//
// So the slot is a LAST resort, not the source of truth. Anything reading it
// where a grid is available is a bug; pass `ruleEngine` through the context
// instead. See `resolveRuleEngine` below.
let injectedEngine: RuleEngineShape | null = null;

export function registerRuleEngine(engine: RuleEngineShape): void {
  injectedEngine = engine;
}

/** The page-level fallback. Prefer {@link resolveRuleEngine}, which takes the
 *  owning grid's engine when the caller has one. */
export function getRuleEngine(): RuleEngineShape | null {
  return injectedEngine;
}

/**
 * The engine to use for one piece of work: the owning grid's if the caller
 * threaded it, otherwise the page-level slot.
 *
 * `undefined` means "the caller does not know" and falls back. `null` means
 * "this grid has no engine" and is honoured — that distinction is what stops
 * a grid without rules from borrowing another grid's.
 */
export function resolveRuleEngine(
  own: RuleEngineShape | null | undefined,
): RuleEngineShape | null {
  return own === undefined ? injectedEngine : own;
}

/** Test-only helper — not part of public API. */
export function _resetRuleEngine_forTests(): void {
  injectedEngine = null;
}
