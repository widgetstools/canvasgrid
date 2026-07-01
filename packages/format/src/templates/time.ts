import type { FormatterTemplateContext, FormatterTemplate } from '../types';

export const TimeTemplate = {
  name: 'Time' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.TimeTemplate');
  },
};
