import { describe, expect, it } from 'vitest';
import { mergeRowFields } from '../src/ssrm/mergeRowFields';
import { buildSsrmColumnKeys } from '../src/ssrm/columnKeys';

describe('mergeRowFields', () => {
  it('returns next when prev missing', () => {
    const next = { id: '1', pnl: 10 };
    expect(mergeRowFields(undefined, next)).toBe(next);
  });

  it('merges without null wipe', () => {
    expect(mergeRowFields(
      { id: '1', ticker: 'AAPL', pnl: 1 },
      { id: '1', ticker: null, pnl: undefined, desk: 'EQ' } as Record<string, unknown>,
    )).toEqual({ id: '1', ticker: 'AAPL', pnl: 1, desk: 'EQ' });
  });
});

describe('buildSsrmColumnKeys', () => {
  it('unions and dedupes', () => {
    expect(buildSsrmColumnKeys({
      visibleColIds: ['ticker', 'pnl'],
      overscanColIds: ['dailyPnl'],
      rowIdField: 'positionId',
      sortColIds: ['pnl'],
    })).toEqual(['ticker', 'pnl', 'dailyPnl', 'positionId']);
  });
});
