import type { FormatterTemplateContext, FormatterTemplate } from '../types';

export const DateTemplate = {
  name: 'Date' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.DateTemplate');
  },
};
