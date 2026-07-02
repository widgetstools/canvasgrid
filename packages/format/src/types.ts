// @cgrid/format — public type surface.
//
// All types are plain TypeScript: discriminated unions for the format
// program's internal AST, plain interfaces for public results and errors.
// Nothing in this file is runtime; it compiles to no JS output.
//
// See docs/superpowers/specs/2026-07-01-cycle-21c-format-design.md §4 for
// the authoritative reference.

import type { Loc } from '@cgrid/expression';

// Re-export Loc so consumers importing from @cgrid/format only need one dep.
export type { Loc };

// ─── Public results ────────────────────────────────────────────────────

export type FormatSource = string | CompositeColDef;

export interface CompileFormatOptions {
  locale?: string;
  currency?: string;
  templates?: FormatterTemplateDef[];
  builtins?: Record<string, BuiltinDef>;
}

export type CompileFormatResult =
  | { ok: true; program: FormatProgram }
  | { ok: false; error: CompileFormatError };

export interface FormatProgram {
  formatText: (ctx: FormatEvalContext) => string;
  resolveStyle: (ctx: FormatEvalContext) => StyleObj | null;
  resolveIcon: (ctx: FormatEvalContext) => IconRef | null;
  resolveFragments: (ctx: FormatEvalContext) => ResolvedFragment[] | null;
  source: FormatSource;
  tiers: { tier0: boolean; tier1: boolean; tier2: boolean };
}

export interface FormatEvalContext {
  value: unknown;
  row: Record<string, unknown>;
  colId: string;
}

export interface CompileFormatError {
  kind: 'compile-format';
  code:
    | 'excel-parse'
    | 'excel-section-count'
    | 'tier1-parse'
    | 'expression-parse'
    | 'expression-compile'
    | 'unknown-token'
    | 'not-yet-implemented';
  message: string;
  loc: Loc;
  cause?: { source: 'excel' | 'tier1' | 'expression'; inner: unknown };
}

// ─── Style + icon ──────────────────────────────────────────────────────

export interface StyleObj {
  color?: string;
  background?: string;
  weight?: 'normal' | 'bold' | number;
  italic?: boolean;
}

export interface IconRef {
  name: string;
  color?: string;
  position?: 'leading' | 'trailing';
}

// ─── Fragments + composite ─────────────────────────────────────────────

export interface FragmentStyle {
  color?: string;
  weight?: 'normal' | 'bold' | number;
  style?: 'normal' | 'italic';
  size?: number;
  background?: string;
}

export type Fragment =
  | { text: string }
  | { expr: string; format?: string; style?: FragmentStyle };

export interface ResolvedFragment {
  text: string;
  style: FragmentStyle;
  icon?: IconRef;
}

export interface CompositeColDef {
  colId: string;
  type: 'composite';
  fragments: Fragment[];
  cellBackground?: string;
  align?: 'left' | 'center' | 'right';
  overflow?: 'ellipsis' | 'clip';
  // Extra ColDef fields accepted structurally; format's compiler ignores them.
  [key: string]: unknown;
}

// ─── Formatter template registry ───────────────────────────────────────

export type FormatterTemplate = (value: unknown) => string;

export interface FormatterTemplateContext {
  locale: string;
  currency?: string;
  digits?: number;
  useGrouping?: boolean;
  dateStyle?: 'short' | 'medium' | 'long' | 'full';
  timeStyle?: 'short' | 'medium' | 'long' | 'full';
  timeZone?: string;
}

export interface FormatterTemplateDef {
  name: string;
  factory: (params: FormatterTemplateContext) => FormatterTemplate;
}

// ─── Bridge ────────────────────────────────────────────────────────────

export interface WireOptions {
  additionalIconSets?: Record<string, Record<string, string | Path2D>>;
  compositeRenderer?: unknown;  // structural; kernel's CellPainter — kept unknown to avoid kernel dep in types
}

// ─── Internal (not exported from index.ts) ─────────────────────────────

/** Reserved for Cycle 21e — rule reference in style expressions. */
export interface RuleRefNode {
  kind: 'rule-ref';
  ruleId: string;
  loc: Loc;
}

// Re-forward the expression-side builtin def shape so consumers of
// CompileFormatOptions don't need to import from @cgrid/expression.
export interface BuiltinDef {
  arity: number | [min: number, max: number];
  impl: (args: unknown[]) => unknown;
}
