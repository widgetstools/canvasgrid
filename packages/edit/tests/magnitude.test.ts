// @wellsfargo-starui/velocity-grid-edit — magnitude.test.ts
// Covers parseMagnitudeSuffix, applyMagnitudeColDefTransforms.
// Spec: docs/superpowers/specs/2026-07-02-cycle-21g-edit-design.md §2.3, §4.2.5.
// Recon: docs/superpowers/plans/notes/2026-07-02-cycle-21g-recon.md A.3, C.9.
// Plan: docs/superpowers/plans/2026-07-02-cycle-21g-edit.md — Task 6 Step 1 (9 cases).

import { describe, it, expect } from 'vitest';
import { parseMagnitudeSuffix, applyMagnitudeColDefTransforms } from '../src/magnitude';

interface FakeValueParserParams {
  newValue: unknown;
  oldValue: unknown;
  data: Record<string, unknown>;
  colDef: unknown;
}

interface FakeColDef {
  colId: string;
  cellDataType?: string;
  // Matches the pinned generic constraint's `(p: unknown) => unknown` shape —
  // callers narrow via FakeValueParserParams inside the parser body.
  valueParser?: (p: unknown) => unknown;
}

describe('parseMagnitudeSuffix', () => {
  it('accepts K/M/B suffixes (case-insensitive, fractional, negative)', () => {
    expect(parseMagnitudeSuffix('1.5M')).toBe(1_500_000);
    expect(parseMagnitudeSuffix('2k')).toBe(2000);
    expect(parseMagnitudeSuffix('3B')).toBe(3e9);
    expect(parseMagnitudeSuffix('3b')).toBe(3e9);
    expect(parseMagnitudeSuffix('-2.5K')).toBe(-2500);
    expect(parseMagnitudeSuffix('1M')).toBe(1e6);
    expect(parseMagnitudeSuffix('0.5m')).toBe(500_000);
    expect(parseMagnitudeSuffix('-1b')).toBe(-1e9);
  });

  it('passes plain numeric strings through unchanged', () => {
    expect(parseMagnitudeSuffix('123')).toBe(123);
    expect(parseMagnitudeSuffix('1.5')).toBe(1.5);
    expect(parseMagnitudeSuffix('-7')).toBe(-7);
  });

  it('rejects malformed / ambiguous input -> null', () => {
    expect(parseMagnitudeSuffix('abc')).toBeNull();
    expect(parseMagnitudeSuffix('')).toBeNull();
    expect(parseMagnitudeSuffix('   ')).toBeNull();
    expect(parseMagnitudeSuffix('1.5X')).toBeNull();
    expect(parseMagnitudeSuffix('1,000')).toBeNull();
    expect(parseMagnitudeSuffix('1e3B')).toBeNull();
    expect(parseMagnitudeSuffix('K')).toBeNull();
    expect(parseMagnitudeSuffix('1.5MM')).toBeNull();
    expect(parseMagnitudeSuffix('1.2.3M')).toBeNull();
  });
});

describe('applyMagnitudeColDefTransforms', () => {
  it('wraps only numeric columns, returning a new array with new objects for numeric colDefs and by-reference passthrough for others', () => {
    const qty: FakeColDef = { colId: 'qty', cellDataType: 'number' };
    const name: FakeColDef = { colId: 'name', cellDataType: 'text' };
    const when: FakeColDef = { colId: 'when', cellDataType: 'date' };
    const input = [qty, name, when];

    const result = applyMagnitudeColDefTransforms(input);

    expect(result).not.toBe(input);
    expect(result[0]).not.toBe(qty);
    expect(typeof result[0]!.valueParser).toBe('function');
    expect(result[1]).toBe(name);
    expect(result[2]).toBe(when);
  });

  it('runs the original valueParser FIRST, before the magnitude decision', () => {
    const log: string[] = [];
    let capturedParams: unknown;
    const original = (p: unknown) => {
      log.push('original');
      capturedParams = p;
      return (p as FakeValueParserParams).newValue;
    };
    const qty: FakeColDef = { colId: 'qty', cellDataType: 'number', valueParser: original };
    const [wrapped] = applyMagnitudeColDefTransforms([qty]);

    const params = { newValue: '2k', oldValue: 5, data: {}, colDef: qty };
    const result = wrapped!.valueParser!(params);

    expect(log).toEqual(['original']);
    expect(capturedParams).toBe(params);
    expect(result).toBe(2000);
  });

  it('string-parse wins when it succeeds; original wins when parse fails', () => {
    const originalSpy = (p: unknown) =>
      (p as FakeValueParserParams).newValue === '2k' ? '2k' : 'ABC';
    const qty: FakeColDef = { colId: 'qty', cellDataType: 'number', valueParser: originalSpy };
    const [wrapped] = applyMagnitudeColDefTransforms([qty]);

    expect(
      wrapped!.valueParser!({ newValue: '2k', oldValue: 5, data: {}, colDef: qty }),
    ).toBe(2000);
    expect(
      wrapped!.valueParser!({ newValue: 'abc', oldValue: 5, data: {}, colDef: qty }),
    ).toBe('ABC');
  });

  it('non-string newValue passes the original result through untouched', () => {
    const original = () => 42;
    const qty: FakeColDef = { colId: 'qty', cellDataType: 'number', valueParser: original };
    const [wrapped] = applyMagnitudeColDefTransforms([qty]);

    const result = wrapped!.valueParser!({ newValue: 42, oldValue: 5, data: {}, colDef: qty });
    expect(result).toBe(42);
  });

  it('numeric colDef with no original valueParser: parses magnitude or passes newValue through verbatim', () => {
    const qty: FakeColDef = { colId: 'qty', cellDataType: 'number' };
    const [wrapped] = applyMagnitudeColDefTransforms([qty]);

    expect(
      wrapped!.valueParser!({ newValue: '1.5M', oldValue: 0, data: {}, colDef: qty }),
    ).toBe(1_500_000);
    expect(
      wrapped!.valueParser!({ newValue: 'abc', oldValue: 0, data: {}, colDef: qty }),
    ).toBe('abc');
    expect(
      wrapped!.valueParser!({ newValue: 42, oldValue: 0, data: {}, colDef: qty }),
    ).toBe(42);
  });

  it('never mutates input colDefs (frozen-object write would throw in strict mode)', () => {
    const qty: FakeColDef = Object.freeze({ colId: 'qty', cellDataType: 'number' });
    const name: FakeColDef = Object.freeze({ colId: 'name', cellDataType: 'text' });

    expect(() => {
      const [wrappedQty] = applyMagnitudeColDefTransforms([qty, name]);
      wrappedQty!.valueParser!({ newValue: '2k', oldValue: 0, data: {}, colDef: qty });
    }).not.toThrow();
  });
});
