import { describe, it, expect } from 'vitest';
import { getFormatterTemplate } from '../../src/templates/registry';

describe('Built-in template factories produce working formatters', () => {
  it('Number', () => {
    const fn = getFormatterTemplate('Number')!.factory({ locale: 'en-US', digits: 2, useGrouping: true });
    expect(fn(1234.5)).toBe('1,234.50');
  });

  it('Currency', () => {
    const fn = getFormatterTemplate('Currency')!.factory({ locale: 'en-US', currency: 'USD', digits: 2 });
    expect(fn(1234.5)).toBe('$1,234.50');
  });

  it('Percent', () => {
    const fn = getFormatterTemplate('Percent')!.factory({ locale: 'en-US', digits: 2 });
    expect(fn(0.1234)).toBe('12.34%');
  });

  it('Date', () => {
    const fn = getFormatterTemplate('Date')!.factory({ locale: 'en-US', dateStyle: 'short', timeZone: 'UTC' });
    const result = fn(new Date('2026-07-01T00:00:00Z'));
    expect(result).toMatch(/7\/1\/26|07\/01\/2026/);
  });

  it('Time', () => {
    const fn = getFormatterTemplate('Time')!.factory({ locale: 'en-US', timeStyle: 'short', timeZone: 'UTC' });
    const result = fn(new Date('2026-07-01T15:30:00Z'));
    expect(result).toMatch(/3:30 PM/);
  });

  it('DateTime', () => {
    const fn = getFormatterTemplate('DateTime')!.factory({ locale: 'en-US', dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
    const result = fn(new Date('2026-07-01T15:30:00Z'));
    expect(result).toMatch(/Jul 1, 2026/);
  });

  it('RelativeTime', () => {
    const fn = getFormatterTemplate('RelativeTime')!.factory({ locale: 'en-US' });
    expect(fn({ value: -3, unit: 'day' })).toBe('3 days ago');
    expect(fn({ value: 5, unit: 'hour' })).toMatch(/5.*hour|hour.*5/);
  });

  it('Abbreviated', () => {
    const fn = getFormatterTemplate('Abbreviated')!.factory({ locale: 'en-US', digits: 2 });
    expect(fn(1_500_000_000)).toBe('1.5B');
    expect(fn(1_500_000)).toBe('1.5M');
    expect(fn(1_500)).toBe('1.5K');
    expect(fn(500)).toBe('500');
  });

  it('Custom returns default toString', () => {
    const fn = getFormatterTemplate('Custom')!.factory({ locale: 'en-US' });
    expect(fn(42)).toBe('42');
  });
});
