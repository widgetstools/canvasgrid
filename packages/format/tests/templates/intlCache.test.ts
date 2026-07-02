import { describe, it, expect, beforeEach } from 'vitest';
import {
  getIntlNumberFormat,
  getIntlDateTimeFormat,
  getIntlRelativeTimeFormat,
  _resetCache_forTests,
} from '../../src/templates/intlCache';

describe('Intl cache — weekday + timeZone are keyed (regression: Task 3 fix)', () => {
  beforeEach(() => _resetCache_forTests());

  it('different weekday values produce different cached instances', () => {
    const a = getIntlDateTimeFormat('en-US', { weekday: 'short' });
    const b = getIntlDateTimeFormat('en-US', { weekday: 'long' });
    expect(a).not.toBe(b);
  });

  it('different timeZone values produce different cached instances', () => {
    const a = getIntlDateTimeFormat('en-US', { timeZone: 'UTC' });
    const b = getIntlDateTimeFormat('en-US', { timeZone: 'America/Los_Angeles' });
    expect(a).not.toBe(b);
  });

  it('same weekday value reuses cached instance', () => {
    const a = getIntlDateTimeFormat('en-US', { weekday: 'short' });
    const b = getIntlDateTimeFormat('en-US', { weekday: 'short' });
    expect(a).toBe(b);
  });
});

describe('Intl cache', () => {
  beforeEach(() => _resetCache_forTests());

  it('caches NumberFormat by options', () => {
    const a = getIntlNumberFormat('en-US', { minimumFractionDigits: 2 });
    const b = getIntlNumberFormat('en-US', { minimumFractionDigits: 2 });
    expect(a).toBe(b);
  });

  it('returns different instance for different options', () => {
    const a = getIntlNumberFormat('en-US', { minimumFractionDigits: 2 });
    const b = getIntlNumberFormat('en-US', { minimumFractionDigits: 4 });
    expect(a).not.toBe(b);
  });

  it('caches DateTimeFormat by options', () => {
    const a = getIntlDateTimeFormat('en-US', { dateStyle: 'short' });
    const b = getIntlDateTimeFormat('en-US', { dateStyle: 'short' });
    expect(a).toBe(b);
  });

  it('caches RelativeTimeFormat', () => {
    const a = getIntlRelativeTimeFormat('en-US', { numeric: 'auto' });
    const b = getIntlRelativeTimeFormat('en-US', { numeric: 'auto' });
    expect(a).toBe(b);
  });

  it('eviction fires when MAX_ENTRIES exceeded', () => {
    // First insert — record the instance.
    const firstInstance = getIntlNumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });

    // Insert 600 distinct keys to push the first out.
    // currencies(6) × min(0-15) × max(min-15) = 6 × 136 = 816 combos > 500.
    const currencies = ['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'];
    for (const cur of currencies) {
      for (let min = 0; min <= 15; min++) {
        for (let max = min; max <= 15; max++) {
          getIntlNumberFormat('en-US', {
            style: 'currency', currency: cur,
            minimumFractionDigits: min, maximumFractionDigits: max,
          });
        }
      }
    }

    // Re-fetch the first key — should be a fresh instance now (was evicted).
    const refetched = getIntlNumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
    expect(refetched).not.toBe(firstInstance);
  });
});
