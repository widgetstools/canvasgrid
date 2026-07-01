import type { FormatterTemplateContext, FormatterTemplate } from '../types';

export const CustomTemplate = {
  name: 'Custom' as const,
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    throw new Error('not-yet-implemented: templates.CustomTemplate');
  },
};
