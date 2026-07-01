import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerFormatterTemplate,
  getFormatterTemplate,
  listFormatterTemplates,
  _resetRegistry_forTests,
} from '../../src/templates/registry';

describe('Formatter template registry', () => {
  beforeEach(() => _resetRegistry_forTests());

  it('lists all 9 built-ins', () => {
    const names = listFormatterTemplates();
    expect(names).toEqual([
      'Abbreviated', 'Currency', 'Custom', 'Date', 'DateTime',
      'Number', 'Percent', 'RelativeTime', 'Time',
    ]);
  });

  it('getFormatterTemplate returns built-in def', () => {
    expect(getFormatterTemplate('Number')?.name).toBe('Number');
    expect(getFormatterTemplate('Currency')?.name).toBe('Currency');
  });

  it('registerFormatterTemplate adds new template', () => {
    registerFormatterTemplate({
      name: 'TestTemplate',
      factory: () => (v) => `test-${v}`,
    });
    expect(getFormatterTemplate('TestTemplate')?.name).toBe('TestTemplate');
    expect(listFormatterTemplates()).toContain('TestTemplate');
  });

  it('registerFormatterTemplate overrides existing name', () => {
    registerFormatterTemplate({
      name: 'Number',
      factory: () => (v) => `override-${v}`,
    });
    const fn = getFormatterTemplate('Number')!.factory({ locale: 'en-US' });
    expect(fn(42)).toBe('override-42');
  });
});
