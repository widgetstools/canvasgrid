import { describe, expect, it } from 'vitest';
import { buildSsrmColumnKeys, mergeSsrmRowFields } from '../src/core/ssrmColumnKeys';

describe('buildSsrmColumnKeys', () => {
  it('unions paint, system, expression outputs, and client watched cols', () => {
    expect(buildSsrmColumnKeys({
      visibleColIds: ['ticker', 'pnl'],
      overscanColIds: ['dailyPnl'],
      rowIdField: 'positionId',
      sortColIds: ['desk'],
      filterColIds: ['region'],
      rowGroupColIds: ['desk'],
      valueAggColIds: ['marketValue'],
      expressionOutputIds: ['totalPnl'],
      clientWatchedColIds: ['alertFlag'],
    })).toEqual([
      'ticker',
      'pnl',
      'dailyPnl',
      'positionId',
      'desk',
      'region',
      'marketValue',
      'totalPnl',
      'alertFlag',
    ]);
  });

  it('dedupes while preserving first-seen order', () => {
    expect(buildSsrmColumnKeys({
      visibleColIds: ['pnl', 'desk'],
      sortColIds: ['pnl'],
      expressionOutputIds: ['desk', 'totalPnl'],
    })).toEqual(['pnl', 'desk', 'totalPnl']);
  });

  it('does not invent calc input deps from expression outputs alone', () => {
    expect(buildSsrmColumnKeys({
      visibleColIds: ['ticker'],
      expressionOutputIds: ['totalPnl'],
    })).toEqual(['ticker', 'totalPnl']);
  });
});

describe('mergeSsrmRowFields', () => {
  it('returns next when prev is missing', () => {
    const next = { positionId: '1', pnl: 10 };
    expect(mergeSsrmRowFields(undefined, next)).toBe(next);
  });

  it('field-merges partial column slices onto prior hydrate', () => {
    expect(mergeSsrmRowFields(
      { positionId: '1', ticker: 'AAPL', pnl: 1, desk: 'EQ' },
      { positionId: '1', pnl: 9, marketValue: 100 },
    )).toEqual({
      positionId: '1',
      ticker: 'AAPL',
      pnl: 9,
      desk: 'EQ',
      marketValue: 100,
    });
  });
});
