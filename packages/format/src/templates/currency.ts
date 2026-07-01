import type { FormatterTemplateContext, FormatterTemplate } from '../types';

export const CurrencyTemplate = {
  name: 'Currency' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.CurrencyTemplate');
  },
};
