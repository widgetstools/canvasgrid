import type { FormatterTemplateContext, FormatterTemplate } from '../types';

export const PercentTemplate = {
  name: 'Percent' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.PercentTemplate');
  },
};
