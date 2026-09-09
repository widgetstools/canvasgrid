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
  /**
   * This used to assert the `+` form, which Perspective rejects outright —
   * the test passed for as long as the feature was broken, because it
   * checked the text the builder emitted rather than whether Perspective
   * would take it. `concat` is the dialect's only string join.
   */
  it('joins the columns with concat, which is what Perspective accepts', () => {
    expect(buildQuickFilterHaystackExpression(['a', 'b'])).toBe(
      `// ${QUICK_FILTER_HAYSTACK_ALIAS}\nconcat(string("a"), ' ', string("b"))`,
    );
  });

  it('never emits string addition, at any arity', () => {
    // The whole View dies on a rejected expression, so this is the assertion
    // that matters: one `+` anywhere empties the grid.
    for (const cols of [['a'], ['a', 'b'], ['a', 'b', 'c', 'd', 'e']]) {
      expect(buildQuickFilterHaystackExpression(cols)).not.toContain('+');
    }
  });

  it('needs no separator for a single column', () => {
    expect(buildQuickFilterHaystackExpression(['a'])).toBe(
      `// ${QUICK_FILTER_HAYSTACK_ALIAS}\nconcat(string("a"))`,
    );
  });

  it('drops its own alias, so a re-entrant build cannot reference itself', () => {
    expect(buildQuickFilterHaystackExpression([QUICK_FILTER_HAYSTACK_ALIAS, 'a']))
      .toBe(`// ${QUICK_FILTER_HAYSTACK_ALIAS}\nconcat(string("a"))`);
  });

  it('is a valid empty expression when there is nothing to search', () => {
    expect(buildQuickFilterHaystackExpression([])).toBe(
      `// ${QUICK_FILTER_HAYSTACK_ALIAS}\n''`,
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

/**
 * Why a quick filter stopped being an expression.
 *
 * The haystack is an ExprTK expression column, and Perspective re-evaluates
 * one over the whole table on every read. Measured against a live 10k-row
 * book under a ~40,000 rows/s feed, per windowed read:
 *
 *   no filter                     4ms
 *   one term, native contains     4ms
 *   two terms, haystack         985ms
 *
 * "ANY column contains the term" is an OR, and Perspective's `filter_op` is
 * global — one operator for the whole filter array. So the native form is
 * available ONLY when there is nothing to AND it with. These tests pin both
 * halves: that the fast path is taken when it is safe, and — the part that
 * would silently return wrong rows — that it is NOT taken when it isn't.
 */
describe('quick filter takes the native path only when it is safe', () => {
  const cols = ['ticker', 'desk', 'region'];
  const native = (over: Record<string, unknown> = {}) =>
    cgridFilterToPsp({}, { quickFilterText: 'EMEA', quickFilterColumns: cols, allowNativeOr: true, ...over });

  it('one term, nothing else: contains per column, ORed, no expression', () => {
    const { filters, expressions, filterOp } = native();
    expect(filterOp).toBe('or');
    expect(expressions).toEqual({});
    expect(filters).toEqual([
      ['ticker', 'contains', 'EMEA'],
      ['desk', 'contains', 'EMEA'],
      ['region', 'contains', 'EMEA'],
    ]);
  });

  it('TWO terms fall back — a global OR cannot express AND-of-ORs', () => {
    // Taking the fast path here would return rows matching EITHER term.
    const { filterOp, expressions } = native({ quickFilterText: 'EMEA Inflation' });
    expect(filterOp).toBeUndefined();
    expect(expressions[QUICK_FILTER_HAYSTACK_ALIAS]).toBeDefined();
  });

  it('a column filter present falls back — the OR would swallow it', () => {
    const { filterOp } = cgridFilterToPsp(
      { desk: { filterType: 'text', type: 'contains', filter: 'Sec' } },
      { quickFilterText: 'EMEA', quickFilterColumns: cols, allowNativeOr: true },
    );
    expect(filterOp).toBeUndefined();
  });

  it('a provider-fixed filter falls back — the caller withholds permission', () => {
    expect(native({ allowNativeOr: false }).filterOp).toBeUndefined();
  });

  it('numeric columns are dropped: `contains` on a float aborts the view', () => {
    // Perspective answers "stod: no conversion" and the whole query dies.
    const { filters, filterOp } = native({
      quickFilterColumns: ['ticker', 'pnl', 'region'],
      containsCapableColumns: ['ticker', 'region'],
    });
    expect(filterOp).toBe('or');
    expect(filters.map((f) => f[0])).toEqual(['ticker', 'region']);
  });

  it('falls back when NO column can take a native contains', () => {
    const { filterOp, expressions } = native({
      quickFilterColumns: ['pnl', 'notional'],
      containsCapableColumns: [],
    });
    expect(filterOp).toBeUndefined();
    expect(expressions[QUICK_FILTER_HAYSTACK_ALIAS]).toBeDefined();
  });

  it('no quick filter at all is untouched', () => {
    const { filters, filterOp } = cgridFilterToPsp(
      { desk: { filterType: 'text', type: 'contains', filter: 'Sec' } },
      { allowNativeOr: true },
    );
    expect(filterOp).toBeUndefined();
    expect(filters).toEqual([['desk', 'contains', 'Sec']]);
  });
});
