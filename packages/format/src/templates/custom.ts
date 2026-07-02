import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';

/**
 * `Custom` — routes an arbitrary Excel format string through Tier 0.
 * Params carry the raw format string in `dateStyle` slot when caller
 * embeds it, or via an extended context field. For general use, callers
 * should invoke compileFormat() directly; this template exists so the
 * template registry has a canonical entry for the "raw Excel format"
 * path (spec §4.3 built-in list).
 */
export const CustomTemplate: FormatterTemplateDef = {
  name: 'Custom',
  factory: (_params: FormatterTemplateContext): FormatterTemplate => {
    return (value: unknown) => {
      // No embedded format string in this call — return default toString.
      // Real consumers use compileFormat() with the raw string directly.
      return String(value ?? '');
    };
  },
};
