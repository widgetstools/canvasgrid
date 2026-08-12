import { describe, it, expect } from 'vitest';
import { parseFloatingFilterInput } from '../src/interaction/floatingFilterParser';

describe('floatingFilterParser — text', () => {
  it('bare value → contains', () => {
    expect(parseFloatingFilterInput('POS', 'text')).toEqual({
      filterType: 'text', type: 'contains', filter: 'POS',
    });
  });

  it('CSV → multi-OR of contains', () => {
    expect(parseFloatingFilterInput('abd,tody,one', 'text')).toEqual({
      filterType: 'multi', operator: 'OR',
      conditions: [
        { filterType: 'text', type: 'contains', filter: 'abd' },
        { filterType: 'text', type: 'contains', filter: 'tody' },
        { filterType: 'text', type: 'contains', filter: 'one' },
      ],
    });
  });

  it('AND of two contains', () => {
    expect(parseFloatingFilterInput('abd AND tody', 'text')).toEqual({
      filterType: 'multi', operator: 'AND',
      conditions: [
        { filterType: 'text', type: 'contains', filter: 'abd' },
        { filterType: 'text', type: 'contains', filter: 'tody' },
      ],
    });
  });

  it('OR of two contains via explicit OR keyword', () => {
    expect(parseFloatingFilterInput('abd OR tody', 'text')).toEqual({
      filterType: 'multi', operator: 'OR',
      conditions: [
        { filterType: 'text', type: 'contains', filter: 'abd' },
        { filterType: 'text', type: 'contains', filter: 'tody' },
      ],
    });
  });

  it('empty / whitespace → null', () => {
    expect(parseFloatingFilterInput('', 'text')).toBeNull();
    expect(parseFloatingFilterInput('   ', 'text')).toBeNull();
  });
});

describe('floatingFilterParser — number', () => {
  it('bare value → equals', () => {
    expect(parseFloatingFilterInput('100', 'number')).toEqual({
      filterType: 'number', type: 'equals', filter: 100,
    });
  });

  it('decimal + negative bare values', () => {
    expect(parseFloatingFilterInput('1.5', 'number')).toEqual({
      filterType: 'number', type: 'equals', filter: 1.5,
    });
    expect(parseFloatingFilterInput('-42', 'number')).toEqual({
      filterType: 'number', type: 'equals', filter: -42,
    });
  });

  it('comparison operators', () => {
    expect(parseFloatingFilterInput('>100', 'number')).toEqual({
      filterType: 'number', type: 'greaterThan', filter: 100,
    });
    expect(parseFloatingFilterInput('< 50', 'number')).toEqual({
      filterType: 'number', type: 'lessThan', filter: 50,
    });
    expect(parseFloatingFilterInput('>=100', 'number')).toEqual({
      filterType: 'number', type: 'greaterThanOrEqual', filter: 100,
    });
    expect(parseFloatingFilterInput('<=100', 'number')).toEqual({
      filterType: 'number', type: 'lessThanOrEqual', filter: 100,
    });
    expect(parseFloatingFilterInput('=100', 'number')).toEqual({
      filterType: 'number', type: 'equals', filter: 100,
    });
    expect(parseFloatingFilterInput('==100', 'number')).toEqual({
      filterType: 'number', type: 'equals', filter: 100,
    });
    expect(parseFloatingFilterInput('!=100', 'number')).toEqual({
      filterType: 'number', type: 'notEqual', filter: 100,
    });
    expect(parseFloatingFilterInput('<>100', 'number')).toEqual({
      filterType: 'number', type: 'notEqual', filter: 100,
    });
  });

  it('range via N..M', () => {
    expect(parseFloatingFilterInput('100..200', 'number')).toEqual({
      filterType: 'number', type: 'inRange', filter: 100, filterTo: 200,
    });
  });

  it('range via N-M', () => {
    expect(parseFloatingFilterInput('100-200', 'number')).toEqual({
      filterType: 'number', type: 'inRange', filter: 100, filterTo: 200,
    });
  });

  it('CSV → multi-OR of equals', () => {
    expect(parseFloatingFilterInput('12,20,33', 'number')).toEqual({
      filterType: 'multi', operator: 'OR',
      conditions: [
        { filterType: 'number', type: 'equals', filter: 12 },
        { filterType: 'number', type: 'equals', filter: 20 },
        { filterType: 'number', type: 'equals', filter: 33 },
      ],
    });
  });

  it('mixed CSV with operators → multi-OR', () => {
    expect(parseFloatingFilterInput('>100, <50', 'number')).toEqual({
      filterType: 'multi', operator: 'OR',
      conditions: [
        { filterType: 'number', type: 'greaterThan', filter: 100 },
        { filterType: 'number', type: 'lessThan', filter: 50 },
      ],
    });
  });

  it('AND of two comparisons', () => {
    expect(parseFloatingFilterInput('>100 AND <200', 'number')).toEqual({
      filterType: 'multi', operator: 'AND',
      conditions: [
        { filterType: 'number', type: 'greaterThan', filter: 100 },
        { filterType: 'number', type: 'lessThan', filter: 200 },
      ],
    });
  });

  it('AND tighter than OR (`a AND b OR c` = `(a AND b) OR c`)', () => {
    expect(parseFloatingFilterInput('>100 AND <200 OR =500', 'number')).toEqual({
      filterType: 'multi', operator: 'OR',
      conditions: [
        // First OR branch is itself a multi-AND.
        { filterType: 'multi', operator: 'AND', conditions: [
          { filterType: 'number', type: 'greaterThan', filter: 100 },
          { filterType: 'number', type: 'lessThan', filter: 200 },
        ] } as any,
        { filterType: 'number', type: 'equals', filter: 500 },
      ],
    });
  });

  it('non-numeric → null', () => {
    expect(parseFloatingFilterInput('foo', 'number')).toBeNull();
    expect(parseFloatingFilterInput('>foo', 'number')).toBeNull();
  });

  it('case-insensitive AND / OR + && / ||', () => {
    expect(parseFloatingFilterInput('>100 and <200', 'number')).toEqual({
      filterType: 'multi', operator: 'AND',
      conditions: [
        { filterType: 'number', type: 'greaterThan', filter: 100 },
        { filterType: 'number', type: 'lessThan', filter: 200 },
      ],
    });
    expect(parseFloatingFilterInput('>100 && <200', 'number')).toEqual({
      filterType: 'multi', operator: 'AND',
      conditions: [
        { filterType: 'number', type: 'greaterThan', filter: 100 },
        { filterType: 'number', type: 'lessThan', filter: 200 },
      ],
    });
    expect(parseFloatingFilterInput('>100 || <50', 'number')).toEqual({
      filterType: 'multi', operator: 'OR',
      conditions: [
        { filterType: 'number', type: 'greaterThan', filter: 100 },
        { filterType: 'number', type: 'lessThan', filter: 50 },
      ],
    });
  });
});

describe('floatingFilterParser — date', () => {
  it('bare ISO date → equals', () => {
    expect(parseFloatingFilterInput('2026-01-01', 'date')).toEqual({
      filterType: 'date', type: 'equals', filter: '2026-01-01',
    });
  });

  it('comparison operators', () => {
    expect(parseFloatingFilterInput('>2026-01-01', 'date')).toEqual({
      filterType: 'date', type: 'greaterThan', filter: '2026-01-01',
    });
    expect(parseFloatingFilterInput('<=2026-06-15', 'date')).toEqual({
      filterType: 'date', type: 'lessThanOrEqual', filter: '2026-06-15',
    });
  });

  it('range via `..` (no `-` separator — would collide with ISO format)', () => {
    expect(parseFloatingFilterInput('2026-01-01..2026-06-15', 'date')).toEqual({
      filterType: 'date', type: 'inRange', filter: '2026-01-01', filterTo: '2026-06-15',
    });
  });

  it('CSV → multi-OR of equals', () => {
    expect(parseFloatingFilterInput('2026-01-01,2026-06-15', 'date')).toEqual({
      filterType: 'multi', operator: 'OR',
      conditions: [
        { filterType: 'date', type: 'equals', filter: '2026-01-01' },
        { filterType: 'date', type: 'equals', filter: '2026-06-15' },
      ],
    });
  });

  it('non-ISO → null', () => {
    expect(parseFloatingFilterInput('not-a-date', 'date')).toBeNull();
    expect(parseFloatingFilterInput('2026', 'date')).toBeNull();
    expect(parseFloatingFilterInput('>2026-13-99', 'date')).toBeNull();
  });
});
