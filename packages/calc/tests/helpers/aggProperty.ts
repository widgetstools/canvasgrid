// Streaming-property driver: fold a seeded random add/remove/update op
// stream through an Aggregate and compare finalize() against a naive
// recompute over the surviving raw-value multiset after EVERY op.
//
// Value pool: dup-heavy small ints + quarter-step floats (exact binary
// fractions — SUM/AVG delta-vs-recompute stays exact without masking
// real bugs) + null/NaN/undefined junk the impls must skip.

import { expect } from 'vitest';
import type { Aggregate } from '../../src/types';
import { makeLcg } from './lcg';

export interface StreamingPropertyOpts {
  /** Naive recompute over surviving RAW values (do your own filtering). */
  reference: (survivors: readonly unknown[]) => number | null;
  /** Include remove-of-absent-value ops — only for impls that can
   *  detect absence (MIN/MAX/COUNT_DISTINCT/PERCENTILE/MODE). */
  allowAbsentRemove?: boolean;
  opsPerSeq?: number;
  /** Relative tolerance vs max(1, |want|). Default 1e-9. */
  tolerance?: number;
}

/** Never produced by nextValue() — safe absent-remove probe. */
const ABSENT_VALUE = 987654321.5;

function nextValue(rand: () => number): unknown {
  const r = rand();
  if (r < 0.4) return Math.floor(rand() * 10); // dup-heavy ints
  if (r < 0.8) return Math.round(rand() * 2000 - 1000) / 4; // exact quarter-steps
  if (r < 0.9) return null;
  if (r < 0.95) return Number.NaN;
  return undefined;
}

export function runStreamingProperty(
  makeAgg: () => Aggregate,
  seeds: readonly number[],
  opts: StreamingPropertyOpts,
): void {
  const opsPerSeq = opts.opsPerSeq ?? 120;
  const tolerance = opts.tolerance ?? 1e-9;
  for (const seed of seeds) {
    const rand = makeLcg(seed);
    const agg = makeAgg();
    let state = agg.init();
    const survivors: unknown[] = [];
    for (let i = 0; i < opsPerSeq; i += 1) {
      const r = rand();
      if (r < 0.5 || survivors.length === 0) {
        const value = nextValue(rand);
        state = agg.addRow(state, value);
        survivors.push(value);
      } else if (r < 0.75) {
        const idx = Math.floor(rand() * survivors.length);
        const [value] = survivors.splice(idx, 1);
        state = agg.removeRow(state, value);
      } else if (r < 0.95 || opts.allowAbsentRemove !== true) {
        const idx = Math.floor(rand() * survivors.length);
        const oldValue = survivors[idx];
        const newValue = nextValue(rand);
        survivors[idx] = newValue;
        state = agg.updateRow(state, oldValue, newValue);
      } else {
        state = agg.removeRow(state, ABSENT_VALUE); // must be a no-op
      }
      const got = agg.finalize(state);
      const want = opts.reference(survivors);
      if (want === null) {
        expect(got, `seed ${seed} op ${i}`).toBeNull();
      } else {
        expect(got, `seed ${seed} op ${i}`).not.toBeNull();
        const scale = Math.max(1, Math.abs(want));
        expect(
          Math.abs((got as number) - want),
          `seed ${seed} op ${i}: got ${String(got)} want ${want}`,
        ).toBeLessThanOrEqual(tolerance * scale);
      }
    }
  }
}
