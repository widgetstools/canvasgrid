import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlNumberFormat } from './intlCache';

export const PercentTemplate: FormatterTemplateDef = {
  name: 'Percent',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const options: Intl.NumberFormatOptions = {
      style: 'percent',
      minimumFractionDigits: params.digits ?? 0,
      maximumFractionDigits: params.digits ?? 0,
    };
    const fmt = getIntlNumberFormat(params.locale, options);
    return (value: unknown) => {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? fmt.format(n) : '';
    };
  },
};
