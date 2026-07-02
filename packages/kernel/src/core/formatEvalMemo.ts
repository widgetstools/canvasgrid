// Cycle 21e / Task 14 — per-cell format-eval memo (the carried Cycle 21c
// perf Minor: formatText + resolveStyle + resolveIcon each re-ran the
// program per paint). One WeakMap entry per program holding the LAST
// cell's eval keyed `${rowId}\0${colId}\0${String(value)}\0${theme}`
// (spec §5.5) — the three compileFormatSlots wrapper lambdas for one cell
// run back-to-back in a paint pass, so a single-entry memo collapses the
// triple eval into one. Key mismatch (next cell / changed value / theme
// flip) recomputes.
//
// Bypass rules (correctness over speed):
//   - program.hasRuleRefs === true — a rule-match change without a value
//     change must not serve stale colors;
//   - p.rowId undefined — no cell identity (pinned rows, ad-hoc calls).

import { getRuleEngine } from './ruleEngineSlot';
import type { FormatEvalCtxShape, FormatProgramShape } from './formatCompilerSlot';

export interface FormatEvalResult {
  text: string;
  style: ReturnType<FormatProgramShape['resolveStyle']>;
  icon: ReturnType<FormatProgramShape['resolveIcon']>;
}

interface MemoEntry { key: string; result: FormatEvalResult; }

const memo = new WeakMap<FormatProgramShape, MemoEntry>();

/** Build the eval ctx, closing resolveRuleRef over the rule slot + the
 *  current cell (spec §5.5). The accessor is only attached when both an
 *  engine and a cell identity exist. */
function buildCtx(p: { value: unknown; data: unknown; colId: string; rowId?: string; themeKind?: 'light' | 'dark' }): FormatEvalCtxShape {
  const engine = getRuleEngine();
  if (engine === null || p.rowId === undefined) {
    return { value: p.value, row: p.data, colId: p.colId };
  }
  const cellCtx = {
    row: p.data,
    rowId: p.rowId,
    colId: p.colId,
    theme: p.themeKind ?? 'light',
  } as const;
  return {
    value: p.value,
    row: p.data,
    colId: p.colId,
    resolveRuleRef: (ruleId: string) => engine.resolveRuleRef(ruleId, cellCtx),
  };
}

/** Evaluate all three channels of a format program for one cell, memoised
 *  per (program, rowId, colId, value, theme). */
export function evalFormatProgram(
  program: FormatProgramShape,
  p: { value: unknown; data: unknown; colId: string; rowId?: string; themeKind?: 'light' | 'dark' },
): FormatEvalResult {
  const memoable = program.hasRuleRefs !== true && p.rowId !== undefined;
  if (memoable) {
    const key = `${p.rowId}\0${p.colId}\0${String(p.value)}\0${p.themeKind ?? 'light'}`;
    const hit = memo.get(program);
    if (hit !== undefined && hit.key === key) return hit.result;
    const ctx = buildCtx(p);
    const result: FormatEvalResult = {
      text: program.formatText(ctx),
      style: program.resolveStyle(ctx),
      icon: program.resolveIcon(ctx),
    };
    memo.set(program, { key, result });
    return result;
  }
  const ctx = buildCtx(p);
  return {
    text: program.formatText(ctx),
    style: program.resolveStyle(ctx),
    icon: program.resolveIcon(ctx),
  };
}

/** Test-only helper — WeakMap has no clear(); recreating is enough
 *  because tests use fresh program objects per case. Exported for
 *  symmetry with the slots; intentionally a no-op. */
export function _resetFormatEvalMemo_forTests(): void {
  /* WeakMap entries are keyed by program identity; fresh programs
     per test make explicit clearing unnecessary. */
}
