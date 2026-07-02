import { describe, expect, it } from 'vitest';
import {
  makeAvg, makeCount, makeCountDistinct, makeMax, makeMin, makeSum,
} from '../../src/aggregates/basic';
import type { Aggregate } from '../../src/types';
import { runStreamingProperty } from '../helpers/aggProperty';

const SEEDS = Array.from({ length: 50 }, (_, i) => i * 7919 + 1);

const nums = (vs: readonly unknown[]): number[] =>
  vs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

const participating = (vs: readonly unknown[]): unknown[] =>
  vs.filter((v) => v !== null && v !== undefined && (typeof v !== 'number' || Number.isFinite(v)));

describe('basic aggregates — streaming deltas === naive recompute (50 seeded sequences)', () => {
  it('SUM', () => {
    runStreamingProperty(makeSum as () => Aggregate, SEEDS, {
      reference: (vs) => {
        const n = nums(vs);
        return n.length === 0 ? null : n.reduce((a, b) => a + b, 0);
      },
    });
  });

  it('COUNT', () => {
    runStreamingProperty(makeCount as () => Aggregate, SEEDS, {
      reference: (vs) => {
        const p = participating(vs);
        return p.length === 0 ? null : p.length;
      },
    });
  });

  it('AVG', () => {
    runStreamingProperty(makeAvg as () => Aggregate, SEEDS, {
      reference: (vs) => {
        const n = nums(vs);
        return n.length === 0 ? null : n.reduce((a, b) => a + b, 0) / n.length;
      },
    });
  });

  it('MIN (heap + lazy delete)', () => {
    runStreamingProperty(makeMin as () => Aggregate, SEEDS, {
      reference: (vs) => {
        const n = nums(vs);
        return n.length === 0 ? null : Math.min(...n);
      },
      allowAbsentRemove: true,
    });
  });

  it('MAX (heap + lazy delete)', () => {
    runStreamingProperty(makeMax as () => Aggregate, SEEDS, {
      reference: (vs) => {
        const n = nums(vs);
        return n.length === 0 ? null : Math.max(...n);
      },
      allowAbsentRemove: true,
    });
  });

  it('COUNT_DISTINCT', () => {
    runStreamingProperty(makeCountDistinct as () => Aggregate, SEEDS, {
      reference: (vs) => {
        const p = participating(vs);
        return p.length === 0 ? null : new Set(p).size;
      },
      allowAbsentRemove: true,
    });
  });
});

describe('basic aggregates — edge semantics', () => {
  it('empty state finalizes to null (never NaN) for every basic aggregate', () => {
    for (const make of [makeSum, makeCount, makeAvg, makeMin, makeMax, makeCountDistinct]) {
      const agg = make() as Aggregate;
      expect(agg.finalize(agg.init())).toBeNull();
    }
  });

  it('null/undefined/NaN/±Infinity are skipped, symmetrically on removeRow', () => {
    const agg = makeSum() as Aggregate;
    let s = agg.init();
    for (const junk of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      s = agg.addRow(s, junk);
    }
    expect(agg.finalize(s)).toBeNull(); // nothing participated
    s = agg.addRow(s, 5);
    s = agg.removeRow(s, null); // symmetric skip — must not decrement
    s = agg.removeRow(s, Number.NaN);
    expect(agg.finalize(s)).toBe(5);
  });

  it('MIN survives removal of the current extreme (duplicates stay live)', () => {
    const agg = makeMin() as Aggregate;
    let s = agg.init();
    for (const v of [5, 3, 9, 3]) s = agg.addRow(s, v);
    s = agg.removeRow(s, 3);
    expect(agg.finalize(s)).toBe(3); // second 3 still live
    s = agg.removeRow(s, 3);
    expect(agg.finalize(s)).toBe(5);
    s = agg.removeRow(s, 5);
    expect(agg.finalize(s)).toBe(9);
  });

  it('MAX survives removal of the current extreme', () => {
    const agg = makeMax() as Aggregate;
    let s = agg.init();
    for (const v of [5, 9, 3]) s = agg.addRow(s, v);
    s = agg.removeRow(s, 9);
    expect(agg.finalize(s)).toBe(5);
    s = agg.removeRow(s, 5);
    expect(agg.finalize(s)).toBe(3);
  });

  it('MIN/MAX/COUNT_DISTINCT: removeRow of an absent value is a no-op', () => {
    for (const make of [makeMin, makeMax, makeCountDistinct]) {
      const agg = make() as Aggregate;
      let s = agg.init();
      s = agg.addRow(s, 7);
      s = agg.removeRow(s, 42); // never added
      expect(agg.finalize(s)).toBe(make === makeCountDistinct ? 1 : 7);
    }
  });

  it('updateRow ≡ removeRow ∘ addRow (method invocation — `this` delegation)', () => {
    const agg = makeAvg() as Aggregate;
    let s = agg.init();
    s = agg.addRow(s, 10);
    s = agg.addRow(s, 20);
    s = agg.updateRow(s, 20, 40);
    expect(agg.finalize(s)).toBe(25);
  });
});
