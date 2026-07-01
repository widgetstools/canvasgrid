import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlNumberFormat } from './intlCache';

export const AbbreviatedTemplate: FormatterTemplateDef = {
  name: 'Abbreviated',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const digits = params.digits ?? 2;
    const baseFmt = getIntlNumberFormat(params.locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    });
    return (value: unknown) => {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return '';
      const abs = Math.abs(n);
      let scaled = n;
      let suffix = '';
      if (abs >= 1e9) { scaled = n / 1e9; suffix = 'B'; }
      else if (abs >= 1e6) { scaled = n / 1e6; suffix = 'M'; }
      else if (abs >= 1e3) { scaled = n / 1e3; suffix = 'K'; }
      return baseFmt.format(scaled) + suffix;
    };
  },
};
