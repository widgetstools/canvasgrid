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

export interface FormatProgramShape {
  formatText: (ctx: { value: unknown; row: unknown; colId: string }) => string;
  resolveStyle: (ctx: { value: unknown; row: unknown; colId: string }) =>
    | { color?: string; background?: string; weight?: string | number; italic?: boolean }
    | null;
  resolveIcon: (ctx: { value: unknown; row: unknown; colId: string }) =>
    | { name: string; color?: string; position?: 'leading' | 'trailing' }
    | null;
  resolveFragments: (ctx: { value: unknown; row: unknown; colId: string }) =>
    | Array<{ text: string; style: unknown; icon?: unknown }>
    | null;
  source: unknown;
  tiers: { tier0: boolean; tier1: boolean; tier2: boolean };
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
