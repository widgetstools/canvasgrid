import type { FormatterTemplateContext, FormatterTemplate } from '../types';

export const DateTimeTemplate = {
  name: 'DateTime' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.DateTimeTemplate');
  },
};
