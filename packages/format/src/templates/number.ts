import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlNumberFormat } from './intlCache';

export const NumberTemplate: FormatterTemplateDef = {
  name: 'Number',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const options: Intl.NumberFormatOptions = {
      minimumFractionDigits: params.digits ?? 0,
      maximumFractionDigits: params.digits ?? 0,
      useGrouping: params.useGrouping ?? false,
    };
    const fmt = getIntlNumberFormat(params.locale, options);
    return (value: unknown) => {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? fmt.format(n) : '';
    };
  },
};
