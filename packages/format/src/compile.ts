import type {
  CompileFormatOptions,
  CompileFormatResult,
  CompositeColDef,
  FormatSource,
} from './types';

export function compileFormat(
  source: FormatSource,
  opts?: CompileFormatOptions,
): CompileFormatResult {
  throw new Error('not-yet-implemented: compile.compileFormat');
}

export function compileCompositeColDef(
  colDef: CompositeColDef,
  opts?: CompileFormatOptions,
): CompileFormatResult {
  throw new Error('not-yet-implemented: compile.compileCompositeColDef');
}
