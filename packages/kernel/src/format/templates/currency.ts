import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlNumberFormat } from './intlCache';

export const CurrencyTemplate: FormatterTemplateDef = {
  name: 'Currency',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const options: Intl.NumberFormatOptions = {
      style: 'currency',
      currency: params.currency ?? 'USD',
      minimumFractionDigits: params.digits ?? 2,
      maximumFractionDigits: params.digits ?? 2,
      useGrouping: params.useGrouping ?? true,
    };
    const fmt = getIntlNumberFormat(params.locale, options);
    return (value: unknown) => {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? fmt.format(n) : '';
    };
  },
};
