import { describe, expect, it } from 'vitest';
import {
  buildOrContainsExpression,
  buildQuickFilterHaystackExpression,
  cgridFilterToPsp,
  entryToPspConversion,
  entryToPspFilters,
  mapAggFuncToPerspective,
  orContainsAlias,
  QUICK_FILTER_HAYSTACK_ALIAS,
} from '../src/cgridFilterToPsp';

describe('entryToPspFilters', () => {
  it('maps text contains / equals / startsWith', () => {
    expect(entryToPspFilters('desk', {
      filterType: 'text', type: 'contains', filter: 'Sec',
    })).toEqual([['desk', 'contains', 'Sec']]);
    expect(entryToPspFilters('desk', {
      filterType: 'text', type: 'equals', filter: 'FX',
    })).toEqual([['desk', '==', 'FX']]);
    expect(entryToPspFilters('desk', {
      filterType: 'text', type: 'startsWith', filter: 'Cr',
    })).toEqual([['desk', 'begins with', 'Cr']]);
  });

  it('maps number comparisons and inRange', () => {
    expect(entryToPspFilters('pnl', {
      filterType: 'number', type: 'greaterThan', filter: 0,
    })).toEqual([['pnl', '>', 0]]);
    expect(entryToPspFilters('pnl', {
      filterType: 'number', type: 'inRange', filter: 10, filterTo: 20,
    })).toEqual([['pnl', '>=', 10], ['pnl', '<=', 20]]);
  });

  it('maps set filters to in / ==', () => {
    expect(entryToPspFilters('region', {
      filterType: 'set', values: ['EMEA'],
    })).toEqual([['region', '==', 'EMEA']]);
    expect(entryToPspFilters('region', {
      filterType: 'set', values: ['EMEA', 'APAC'],
    })).toEqual([['region', 'in', ['EMEA', 'APAC']]]);
    expect(entryToPspFilters('region', {
      filterType: 'set', values: [],
    })).toEqual([]);
  });

  it('collapses multi OR equals into in', () => {
    expect(entryToPspFilters('ticker', {
      filterType: 'multi',
      operator: 'OR',
      conditions: [
        { filterType: 'text', type: 'equals', filter: 'AAPL' },
        { filterType: 'text', type: 'equals', filter: 'MSFT' },
      ],
    })).toEqual([['ticker', 'in', ['AAPL', 'MSFT']]]);
  });

  it('keeps single OR contains as contains (not equals)', () => {
    expect(entryToPspFilters('desk', {
      filterType: 'multi',
      operator: 'OR',
      conditions: [
        { filterType: 'text', type: 'contains', filter: 'Sec' },
      ],
    })).toEqual([['desk', 'contains', 'Sec']]);
  });

  it('builds ExprTK boolean column for multi OR contains (substring)', () => {
    const conv = entryToPspConversion('desk', {
      filterType: 'multi',
      operator: 'OR',
      conditions: [
        { filterType: 'text', type: 'contains', filter: 'Sec' },
        { filterType: 'text', type: 'contains', filter: 'Cred' },
      ],
    });
    const alias = orContainsAlias('desk');
    expect(conv.filters).toEqual([[alias, '==', true]]);
    expect(conv.expressions[alias]).toContain("indexof(lower(string(\"desk\"))");
    expect(conv.expressions[alias]).toContain("'(sec)'");
    expect(conv.expressions[alias]).toContain("'(cred)'");
    expect(conv.orContains[alias]).toEqual({
      colId: 'desk',
      needles: ['Sec', 'Cred'],
    });
  });
});

describe('cgridFilterToPsp', () => {
  it('converts a full model', () => {
    const { filters, expressions } = cgridFilterToPsp({
      desk: { filterType: 'text', type: 'contains', filter: 'Sec' },
      pnl: { filterType: 'number', type: 'greaterThan', filter: 0 },
    });
    expect(filters).toEqual([
      ['desk', 'contains', 'Sec'],
      ['pnl', '>', 0],
    ]);
    expect(expressions).toEqual({});
  });

  it('adds quick-filter haystack expression + contains terms', () => {
    const { filters, expressions } = cgridFilterToPsp(
      { desk: { filterType: 'text', type: 'contains', filter: 'Sec' } },
      {
        quickFilterText: 'AAPL EMEA',
        quickFilterColumns: ['ticker', 'desk', 'region'],
      },
    );
    expect(expressions[QUICK_FILTER_HAYSTACK_ALIAS]).toContain('string("ticker")');
    expect(filters).toEqual([
      ['desk', 'contains', 'Sec'],
      [QUICK_FILTER_HAYSTACK_ALIAS, 'contains', 'AAPL'],
      [QUICK_FILTER_HAYSTACK_ALIAS, 'contains', 'EMEA'],
    ]);
  });

  it('merges OR-contains expressions into the conversion', () => {
    const { filters, expressions, orContains } = cgridFilterToPsp({
      desk: {
        filterType: 'multi',
        operator: 'OR',
        conditions: [
          { filterType: 'text', type: 'contains', filter: 'Sec' },
          { filterType: 'text', type: 'contains', filter: 'Cred' },
        ],
      },
    });
    const alias = orContainsAlias('desk');
    expect(filters).toEqual([[alias, '==', true]]);
    expect(expressions[alias]).toBe(buildOrContainsExpression('desk', ['Sec', 'Cred']));
    expect(orContains[alias]?.needles).toEqual(['Sec', 'Cred']);
  });
});

describe('buildQuickFilterHaystackExpression', () => {
  it('concatenates string() of columns', () => {
    expect(buildQuickFilterHaystackExpression(['a', 'b'])).toBe(
      `// ${QUICK_FILTER_HAYSTACK_ALIAS}\nstring("a") + ' ' + string("b")`,
    );
  });
});

describe('mapAggFuncToPerspective', () => {
  it('maps common VelocityGrid / AG names', () => {
    expect(mapAggFuncToPerspective('sum')).toBe('sum');
    expect(mapAggFuncToPerspective('avg')).toBe('avg');
    expect(mapAggFuncToPerspective('average')).toBe('avg');
    expect(mapAggFuncToPerspective('min')).toBe('min');
    expect(mapAggFuncToPerspective('max')).toBe('max');
    expect(mapAggFuncToPerspective('count')).toBe('count');
    expect(mapAggFuncToPerspective('unknown')).toBe('sum');
  });
});
