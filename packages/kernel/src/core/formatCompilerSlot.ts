// Kernel-side format-compiler dependency-injection slot.
//
// @cgrid/format registers itself via wireIntoKernel(); kernel invokes the
// registered compiler in propertyChain.compileFormatSlots (Task 11).
// Kernel does NOT import @cgrid/format at runtime — only structural
// types. Type-only imports in types/column.ts are OK because they're
// erased at compile time.

export interface CompositeColDefShape {
  type: 'composite';
  fragments: Array<{ text: string } | { expr: string; format?: string; style?: unknown }>;
  cellBackground?: string;
  align?: 'left' | 'center' | 'right';
  overflow?: 'ellipsis' | 'clip';
  colId: string;
  [key: string]: unknown;
}

/** Cycle 21e / Task 14 — eval context accepted by format programs.
 *  `resolveRuleRef` is the rule:<ruleId> accessor (spec §5.5) — the
 *  kernel closes it over the rule slot + current cell; @cgrid/format's
 *  tier1 resolver consults it when present (Cycle 21e Task 9). */
export interface FormatEvalCtxShape {
  value: unknown;
  row: unknown;
  colId: string;
  resolveRuleRef?: (ruleId: string) => string | null;
}

export interface FormatProgramShape {
  formatText: (ctx: FormatEvalCtxShape) => string;
  resolveStyle: (ctx: FormatEvalCtxShape) =>
    | { color?: string; background?: string; weight?: string | number; italic?: boolean }
    | null;
  resolveIcon: (ctx: FormatEvalCtxShape) =>
    | { name: string; color?: string; position?: 'leading' | 'trailing' }
    | null;
  resolveFragments: (ctx: FormatEvalCtxShape) =>
    | Array<{ text: string; style: unknown; icon?: unknown }>
    | null;
  source: unknown;
  tiers: { tier0: boolean; tier1: boolean; tier2: boolean };
  /** Cycle 21e / Task 14 — true when the program contains rule:<ruleId>
   *  refs. Such programs bypass the format-eval memo (a matched-set
   *  change without a value change must not serve stale colors) and
   *  always receive a resolveRuleRef accessor. Set by @cgrid/format's
   *  compile() (Task 9); undefined (older compilers) → treated false. */
  hasRuleRefs?: boolean;
}

export type FormatCompiler = (
  source: string | CompositeColDefShape,
  opts?: unknown,
) =>
  | { ok: true; program: FormatProgramShape }
  | { ok: false; error: { message: string; loc: { start: number; end: number } } };

let injectedCompiler: FormatCompiler | null = null;

export function registerFormatCompiler(fn: FormatCompiler): void {
  injectedCompiler = fn;
}

export function getFormatCompiler(): FormatCompiler | null {
  return injectedCompiler;
}

/** Test-only helper — not part of public API. */
export function _resetFormatCompiler_forTests(): void {
  injectedCompiler = null;
}
