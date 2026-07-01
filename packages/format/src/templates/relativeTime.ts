import type { FormatterTemplateContext, FormatterTemplate } from '../types';

export const RelativeTimeTemplate = {
  name: 'RelativeTime' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.RelativeTimeTemplate');
  },
};
