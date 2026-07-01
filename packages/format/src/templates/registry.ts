import type { FormatterTemplateDef } from '../types';

const registry = new Map<string, FormatterTemplateDef>();

export function registerFormatterTemplate(def: FormatterTemplateDef): void {
  registry.set(def.name, def);
}

export function getFormatterTemplate(name: string): FormatterTemplateDef | undefined {
  return registry.get(name);
}

export function listFormatterTemplates(): string[] {
  return Array.from(registry.keys()).sort();
}

/** Reset (test-only helper — not exported from index.ts). */
export function _resetRegistry_forTests(): void {
  registry.clear();
}
