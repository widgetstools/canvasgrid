import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlDateTimeFormat } from './intlCache';

export const TimeTemplate: FormatterTemplateDef = {
  name: 'Time',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const fmt = getIntlDateTimeFormat(params.locale, {
      timeStyle: params.timeStyle ?? 'medium',
      timeZone: params.timeZone,
    });
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
