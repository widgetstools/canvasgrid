import type { CompositeColDef, FormatEvalContext, ResolvedFragment } from '../types';

export interface CompiledFragmentPlan {
  // Per-fragment compiled state produced at compile time; consumed by resolveFragments.
  fragments: unknown[];  // filled in Task 8
  cellBackgroundProgram: unknown | null;  // format program for cellBackground; null if absent
}

export function compileFragments(colDef: CompositeColDef): CompiledFragmentPlan {
  throw new Error('not-yet-implemented: tier2.compileFragments');
}

export function resolveFragments(
  plan: CompiledFragmentPlan,
  ctx: FormatEvalContext,
): ResolvedFragment[] {
  throw new Error('not-yet-implemented: tier2.resolveFragments');
}
