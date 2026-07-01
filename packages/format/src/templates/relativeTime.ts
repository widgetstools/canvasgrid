import type { FormatterTemplateContext, FormatterTemplate, FormatterTemplateDef } from '../types';
import { getIntlRelativeTimeFormat } from './intlCache';

/**
 * Value shape for RelativeTime: `{ value: number, unit: Intl.RelativeTimeFormatUnit }`
 * or a plain number in seconds relative to now.
 */
export const RelativeTimeTemplate: FormatterTemplateDef = {
  name: 'RelativeTime',
  factory: (params: FormatterTemplateContext): FormatterTemplate => {
    const fmt = getIntlRelativeTimeFormat(params.locale, { numeric: 'auto' });
    return (value: unknown) => {
      if (value && typeof value === 'object' && 'value' in value && 'unit' in value) {
        const rec = value as { value: number; unit: Intl.RelativeTimeFormatUnit };
        return fmt.format(rec.value, rec.unit);
      }
      if (typeof value === 'number') {
        // Plain number: assume seconds, pick best unit.
        return fmt.format(Math.round(value / 86400), 'day');
      }
      return '';
    };
  },
};
