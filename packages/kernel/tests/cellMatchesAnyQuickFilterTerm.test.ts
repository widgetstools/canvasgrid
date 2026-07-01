import { describe, it, expect } from 'vitest';
import { cellMatchesAnyQuickFilterTerm } from '../src/worker/dataPipeline';

/**
 * Cycle 7 / Task 7 — predicate behind the renderer's per-cell quick-filter
 * highlight. Same primitive backs both the worker pass aggregator and the
 * main-thread cell tint; lock in OR semantics so the renderer can light up
 * any cell that contributed to a row passing the AND-across-terms filter.
 */
describe('cellMatchesAnyQuickFilterTerm', () => {
  it('returns false when no terms are active (renderer short-circuit)', () => {
    expect(cellMatchesAnyQuickFilterTerm('POS-100', [])).toBe(false);
  });

  it('returns false on null / undefined / empty values', () => {
    expect(cellMatchesAnyQuickFilterTerm(null, ['pos'])).toBe(false);
    expect(cellMatchesAnyQuickFilterTerm(undefined, ['pos'])).toBe(false);
    expect(cellMatchesAnyQuickFilterTerm('', ['pos'])).toBe(false);
  });

  it('matches case-insensitively (terms expected pre-lowercased)', () => {
    expect(cellMatchesAnyQuickFilterTerm('POS-100', ['pos'])).toBe(true);
    expect(cellMatchesAnyQuickFilterTerm('pos-200', ['pos'])).toBe(true);
  });

  it('applies OR semantics across terms (any-term match wins)', () => {
    // Cell contains 'POS' but not 'USD' — still matches because OR.
    expect(cellMatchesAnyQuickFilterTerm('POS-100', ['usd', 'pos'])).toBe(true);
    // Cell matches none — false.
    expect(cellMatchesAnyQuickFilterTerm('ABC-100', ['usd', 'pos'])).toBe(false);
  });

  it('coerces non-string values via String()', () => {
    // Number cell value (price column) still gets the lowercased includes treatment.
    expect(cellMatchesAnyQuickFilterTerm(12345, ['234'])).toBe(true);
    expect(cellMatchesAnyQuickFilterTerm(12345, ['999'])).toBe(false);
  });
});
