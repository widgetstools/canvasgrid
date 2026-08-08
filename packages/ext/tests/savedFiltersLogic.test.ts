import { describe, it, expect } from 'vitest';
import {
  filterModelsEqual,
  generateLabel,
  isNewFilter,
  mergeFilterModels,
  subtractFilterModel,
  doesRowMatchFilterModel,
  doesValueMatchFilter,
} from '../src/toolbar/savedFiltersLogic';

describe('savedFiltersLogic', () => {
  it('generateLabel covers 0/1/2/many columns', () => {
    expect(generateLabel({}, 2)).toBe('Filter 3');
    expect(generateLabel({ desk: { filterType: 'set', values: ['Rates'] } }, 0)).toBe('desk: Rates');
    expect(generateLabel({ a: { filterType: 'text', type: 'contains', filter: 'x' }, b: {} }, 0)).toBe('a + b');
    expect(generateLabel({ a: {}, b: {}, c: {} }, 0)).toBe('a + 2 more');
  });

  it('mergeFilterModels unions set values on the same column', () => {
    const merged = mergeFilterModels([
      { desk: { filterType: 'set', values: ['A'] } },
      { desk: { filterType: 'set', values: ['B'] } },
    ]);
    expect(merged.desk).toEqual({ filterType: 'set', values: ['A', 'B'] });
  });

  it('subtractFilterModel keeps only net-new columns', () => {
    const live = {
      desk: { filterType: 'set', values: ['Rates'] },
      price: { filterType: 'number', type: 'greaterThan', filter: 100 },
    };
    const active = { desk: { filterType: 'set', values: ['Rates'] } };
    expect(subtractFilterModel(live, active)).toEqual({
      price: { filterType: 'number', type: 'greaterThan', filter: 100 },
    });
  });

  it('isNewFilter rejects empty, duplicates, and active-merge echo', () => {
    const pills = [
      { filterModel: { desk: { filterType: 'set', values: ['Rates'] } }, active: true },
    ];
    expect(isNewFilter({}, pills)).toBe(false);
    expect(isNewFilter({ desk: { filterType: 'set', values: ['Rates'] } }, pills)).toBe(false);
    expect(isNewFilter({
      desk: { filterType: 'set', values: ['Rates'] },
      region: { filterType: 'set', values: ['US'] },
    }, pills)).toBe(true);
  });

  it('filterModelsEqual is order-insensitive for set values', () => {
    expect(filterModelsEqual(
      { desk: { filterType: 'set', values: ['B', 'A'] } },
      { desk: { filterType: 'set', values: ['A', 'B'] } },
    )).toBe(true);
  });

  it('doesRowMatchFilterModel ANDs across columns', () => {
    const row = { desk: 'Rates', region: 'US' };
    expect(doesRowMatchFilterModel(row, {
      desk: { filterType: 'set', values: ['Rates'] },
      region: { filterType: 'set', values: ['EU'] },
    })).toBe(false);
    expect(doesValueMatchFilter('Rates', { filterType: 'set', values: ['Rates'] })).toBe(true);
  });
});
