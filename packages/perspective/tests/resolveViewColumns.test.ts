import { describe, expect, it } from 'vitest';
import { resolvePerspectiveViewColumns } from '../src/book';

describe('resolvePerspectiveViewColumns', () => {
  it('returns schema columns when no expressions or keys', () => {
    expect(resolvePerspectiveViewColumns({})).toEqual([
      'positionId',
      'ticker',
      'desk',
      'region',
      'instrumentType',
      'notionalAmount',
      'marketValue',
      'pnl',
      'dailyPnl',
    ]);
  });

  it('appends expression aliases after schema columns', () => {
    expect(resolvePerspectiveViewColumns({
      expressions: { totalPnl: '// totalPnl\n"pnl" + "dailyPnl"' },
    })).toContain('totalPnl');
  });

  it('projects to columnKeys while always keeping positionId and groupBy', () => {
    expect(resolvePerspectiveViewColumns({
      expressions: { totalPnl: '"pnl" + "dailyPnl"' },
      groupBy: ['desk'],
      columnKeys: ['ticker', 'totalPnl'],
    })).toEqual(['positionId', 'desk', 'ticker', 'totalPnl']);
  });

  it('ignores keys that are not schema or expression outputs', () => {
    expect(resolvePerspectiveViewColumns({
      columnKeys: ['ticker', 'notARealCol'],
    })).toEqual(['positionId', 'ticker']);
  });

  it('force-unions expression aliases even when omitted from columnKeys', () => {
    expect(resolvePerspectiveViewColumns({
      expressions: { totalPnl: '"pnl" + "dailyPnl"' },
      columnKeys: ['ticker'],
    })).toEqual(['positionId', 'ticker', 'totalPnl']);
  });
});
