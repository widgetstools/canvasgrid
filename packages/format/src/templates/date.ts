import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlDateTimeFormat } from './intlCache';

export const DateTemplate: FormatterTemplateDef = {
  name: 'Date',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const fmt = getIntlDateTimeFormat(params.locale, { dateStyle: params.dateStyle ?? 'medium' });
    return (value: unknown) => {
      if (value instanceof Date) return fmt.format(value);
      if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
      }
      return '';
    };
  },
};
