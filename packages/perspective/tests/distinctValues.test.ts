import { describe, expect, it } from 'vitest';
import { distinctValuesFromRowPaths } from '../src/distinctValues';

describe('distinctValuesFromRowPaths', () => {
  it('reads unique keys from __ROW_PATH__ only — never aggregate counts on colId', () => {
    const rows = [
      { __ROW_PATH__: [], region: 10_000 }, // grand total count
      { __ROW_PATH__: ['AMER'], region: 3329 }, // leaf count, not the value
      { __ROW_PATH__: ['EMEA'], region: 3334 },
      { __ROW_PATH__: ['APAC'], region: 3337 },
    ];
    expect(distinctValuesFromRowPaths(rows)).toEqual(['AMER', 'APAC', 'EMEA']);
  });

  it('ignores rows that only have aggregate fields and no path', () => {
    expect(distinctValuesFromRowPaths([
      { region: 10000 },
      { region: 3329 },
    ])).toEqual([]);
  });

  it('honours limit and skips empty / null path segments', () => {
    expect(distinctValuesFromRowPaths([
      { __ROW_PATH__: [] },
      { __ROW_PATH__: [null] },
      { __ROW_PATH__: [''] },
      { __ROW_PATH__: ['FX'] },
      { __ROW_PATH__: ['Rates'] },
      { __ROW_PATH__: ['Credit'] },
    ], 2)).toEqual(['FX', 'Rates']);
  });

  it('never falls back to row[colId] even when path is missing counts look plausible', () => {
    // If a future caller mistakenly passes colId aggregates alone, stay empty.
    expect(distinctValuesFromRowPaths([
      { desk: 5000 },
      { desk: 2500 },
    ])).toEqual([]);
  });
});
