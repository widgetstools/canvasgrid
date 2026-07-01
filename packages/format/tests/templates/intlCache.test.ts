import { describe, it, expect, beforeEach } from 'vitest';
import { getIntlDateTimeFormat, _resetCache_forTests } from '../../src/templates/intlCache';

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
