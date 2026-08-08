// @wellsfargo-starui/velocity-grid-format — public re-exports.
// See docs/superpowers/specs/2026-07-01-cycle-21c-format-design.md §4.1
// for the authoritative reference.

// Compilation entry points
export { compileFormat, compileCompositeColDef } from './compile';

// Formatter template registry
export {
  registerFormatterTemplate,
  getFormatterTemplate,
  listFormatterTemplates,
} from './templates/registry';

// Kernel bridge
export { wireIntoKernel } from './bridge';

// Public types
export type {
  Loc,
  FormatProgram,
  FormatSource,
  CompileFormatOptions,
  CompileFormatResult,
  CompileFormatError,
  FormatEvalContext,
  StyleObj,
  IconRef,
  ResolvedFragment,
  Fragment,
  FragmentStyle,
  CompositeColDef,
  FormatterTemplate,
  FormatterTemplateDef,
  FormatterTemplateContext,
  WireOptions,
  BuiltinDef,
} from './types';
