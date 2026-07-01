import type { FormatterTemplateDef } from '../types';
import { NumberTemplate } from './number';
import { CurrencyTemplate } from './currency';
import { PercentTemplate } from './percent';
import { DateTemplate } from './date';
import { TimeTemplate } from './time';
import { DateTimeTemplate } from './datetime';
import { RelativeTimeTemplate } from './relativeTime';
import { AbbreviatedTemplate } from './abbreviated';
import { CustomTemplate } from './custom';

const registry = new Map<string, FormatterTemplateDef>();

const BUILT_INS: FormatterTemplateDef[] = [
  NumberTemplate,
  CurrencyTemplate,
  PercentTemplate,
  DateTemplate,
  TimeTemplate,
  DateTimeTemplate,
  RelativeTimeTemplate,
  AbbreviatedTemplate,
  CustomTemplate,
];

// Auto-register built-ins on module load.
for (const def of BUILT_INS) registry.set(def.name, def);

export function registerFormatterTemplate(def: FormatterTemplateDef): void {
  registry.set(def.name, def);
}

export function getFormatterTemplate(name: string): FormatterTemplateDef | undefined {
  return registry.get(name);
}

export function listFormatterTemplates(): string[] {
  return Array.from(registry.keys()).sort();
}

/** Reset to just built-ins (test-only helper — not exported from index.ts). */
export function _resetRegistry_forTests(): void {
  registry.clear();
  for (const def of BUILT_INS) registry.set(def.name, def);
}
