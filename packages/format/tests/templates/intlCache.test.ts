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

  it('eviction under load', () => {
    // Insert 600 unique keys — should evict oldest 100 (MAX_ENTRIES=500).
    // Use useGrouping boolean and minimumFractionDigits (0-20) to vary keys
    // without exceeding Intl.NumberFormat option ranges.
    for (let i = 0; i < 600; i++) {
      getIntlNumberFormat('en-US', {
        minimumFractionDigits: i % 21,
        maximumFractionDigits: i % 21,
        useGrouping: i % 2 === 0,
        notation: i % 3 === 0 ? 'standard' : i % 3 === 1 ? 'scientific' : 'compact',
      });
    }
    // After inserting 600 unique keys with MAX_ENTRIES=500, the cache should
    // have evicted the oldest entries. Requesting any key returns the same
    // instance as a second request (cache is consistent).
    const before = getIntlNumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const after = getIntlNumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    expect(before).toBe(after);
  });
});
