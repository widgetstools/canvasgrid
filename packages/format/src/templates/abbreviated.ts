import type { FormatterTemplateContext, FormatterTemplate } from '../types';

export const AbbreviatedTemplate = {
  name: 'Abbreviated' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.AbbreviatedTemplate');
  },
};
