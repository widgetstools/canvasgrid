import type { FormatterTemplateContext, FormatterTemplate } from '../types';

export const NumberTemplate = {
  name: 'Number' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.NumberTemplate');
  },
};
