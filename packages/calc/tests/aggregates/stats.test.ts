import { describe, expect, it } from 'vitest';
import { makeMode, makePercentile, makeStdev, makeVar } from '../../src/aggregates/stats';
import { expandShareAggregates, SHARE_AGGREGATE_NAMES } from '../../src/aggregates/share';
import { getAggregate, listAggregates, serializeAggregates } from '../../src/aggregates/registry';
import { compileCalc } from '../../src/compile';
import { evaluateCalcAst } from '../../src/workerProgram';
import type { Aggregate } from '../../src/types';
import { runStreamingProperty } from '../helpers/aggProperty';
import { makeLcg } from '../helpers/lcg';

const SEEDS = Array.from({ length: 50 }, (_, i) => i * 6007 + 3);

const nums = (vs: readonly unknown[]): number[] =>
  vs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/** PERCENTILE.INC — linear interpolation between closest ranks. */
function percentileRef(values: number[], p: number): number | null {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const vLo = sorted[lo] as number;
  const vHi = sorted[hi] as number;
  return vLo + (rank - lo) * (vHi - vLo);
}

function varRef(vs: number[]): number | null {
  if (vs.length < 2) return null;
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
  const m2 = vs.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return m2 / (vs.length - 1);
}

describe('PERCENTILE / MEDIAN — sorted multiset', () => {
  for (const p of [0, 50, 95, 100]) {
    it(`PERCENTILE(${p}) streaming === sorted reference`, () => {
      runStreamingProperty(() => makePercentile(p) as Aggregate, SEEDS, {
        reference: (vs) => percentileRef(nums(vs), p),
        allowAbsentRemove: true,
      });
    });
  }

  it('even/odd counts and duplicates (unit)', () => {
    const med = makePercentile(50) as Aggregate;
    let s = med.init();
    for (const v of [1, 2, 3, 4]) s = med.addRow(s, v);
    expect(med.finalize(s)).toBe(2.5); // even → midpoint
    s = med.addRow(s, 100);
    expect(med.finalize(s)).toBe(3); // odd → middle
    const dup = makePercentile(50) as Aggregate;
    let d = dup.init();
    for (const v of [2, 2, 2, 8]) d = dup.addRow(d, v);
    expect(dup.finalize(d)).toBe(2);
  });

  it('registry: MEDIAN ≡ PERCENTILE(50); parameterized name grammar', () => {
    expect(listAggregates()).toEqual(
      expect.arrayContaining(['MEDIAN', 'PERCENTILE', 'STDEV', 'VAR', 'MODE']),
    );
    const viaMedian = getAggregate('MEDIAN')!;
    const viaParam = getAggregate('PERCENTILE(50)')!;
    let a = viaMedian.init();
    let b = viaParam.init();
    for (const v of [3, 1, 4, 1, 5]) {
      a = viaMedian.addRow(a, v);
      b = viaParam.addRow(b, v);
    }
    expect(viaMedian.finalize(a)).toBe(viaParam.finalize(b));
    expect(getAggregate('PERCENTILE')).toBeUndefined(); // base name needs (p)
    expect(getAggregate('PERCENTILE(abc)')).toBeUndefined();
    expect(getAggregate('PERCENTILE(95)')).toBeDefined(); // canonical fn-string form
  });

  it('serializeAggregates arity convention: PERCENTILE ships as a 1-arg factory; MEDIAN source embeds it', () => {
    const byName = new Map(serializeAggregates().map((e) => [e.name, e.source]));
    const pFactory = new Function('return (' + byName.get('PERCENTILE')! + ')')() as (p: number) => Aggregate;
    expect(pFactory.length).toBe(1);
    const inst = pFactory(95);
    let s = inst.init();
    for (const v of [1, 2, 3]) s = inst.addRow(s, v);
    expect(inst.finalize(s)).toBeCloseTo(2.9, 10); // rank 1.9 → 2 + 0.9·(3−2)
    const mFactory = new Function('return (' + byName.get('MEDIAN')! + ')')() as () => Aggregate;
    expect(mFactory.length).toBe(0);
    const med = mFactory();
    let m = med.init();
    for (const v of [9, 1, 5]) m = med.addRow(m, v);
    expect(med.finalize(m)).toBe(5);
  });
});

describe('STDEV / VAR — Welford with M2 downdate', () => {
  it('VAR downdate accuracy vs two-pass reference within 1e-9 over 1k-op streams', () => {
    runStreamingProperty(makeVar as () => Aggregate, [11, 223, 3343, 44543, 57119], {
      reference: (vs) => varRef(nums(vs)),
      opsPerSeq: 1000,
    });
  });

  it('STDEV — same streams, sqrt', () => {
    runStreamingProperty(makeStdev as () => Aggregate, [11, 223, 3343], {
      reference: (vs) => {
        const v = varRef(nums(vs));
        return v === null ? null : Math.sqrt(v);
      },
      opsPerSeq: 1000,
    });
  });

  it('M2 clamp: identical values never yield negative variance', () => {
    const agg = makeVar() as Aggregate;
    let s = agg.init();
    for (let i = 0; i < 50; i += 1) s = agg.addRow(s, 7.25);
    for (let i = 0; i < 40; i += 1) s = agg.removeRow(s, 7.25);
    const v = agg.finalize(s);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThanOrEqual(0);
    expect(v!).toBeLessThanOrEqual(1e-12);
  });

  it('n < 2 → null (sample statistics undefined)', () => {
    const agg = makeStdev() as Aggregate;
    let s = agg.init();
    expect(agg.finalize(s)).toBeNull();
    s = agg.addRow(s, 5);
    expect(agg.finalize(s)).toBeNull();
    s = agg.addRow(s, 5);
    expect(agg.finalize(s)).toBe(0);
  });
});

describe('MODE — count map', () => {
  it('deterministic ties — smallest value wins', () => {
    const agg = makeMode() as Aggregate;
    let s = agg.init();
    for (const v of [3, 1, 3, 1, 2]) s = agg.addRow(s, v);
    expect(agg.finalize(s)).toBe(1); // 1 and 3 tie at 2 — smallest wins
  });

  it('removal shifts the mode', () => {
    const agg = makeMode() as Aggregate;
    let s = agg.init();
    for (const v of [5, 5, 5, 9, 9]) s = agg.addRow(s, v);
    expect(agg.finalize(s)).toBe(5);
    s = agg.removeRow(s, 5);
    s = agg.removeRow(s, 5);
    expect(agg.finalize(s)).toBe(9); // 9×2 beats 5×1
  });

  it('streaming property (25 seeded sequences)', () => {
    runStreamingProperty(makeMode as () => Aggregate, SEEDS.slice(0, 25), {
      reference: (vs) => {
        const n = nums(vs);
        if (n.length === 0) return null;
        const counts = new Map<number, number>();
        for (const v of n) counts.set(v, (counts.get(v) ?? 0) + 1);
        let best: number | null = null;
        let bestCount = 0;
        for (const [v, c] of counts) {
          if (c > bestCount || (c === bestCount && best !== null && v < best)) {
            best = v;
            bestCount = c;
          }
        }
        return best;
      },
      allowAbsentRemove: true,
    });
  });
});

// ─── Task 6: share aggregates — compile-time expansion ─────────────────
//
// ADAPTED TO LANDED PHASE B: aggTransform.ts's rewriteNode is single-pass
// (transform + slot-assignment interleaved); the 21b parser emits
// PCT_OF_X([e]) as an ordinary CallNode (kind:'call'), never as the
// reserved AggregateNode shape. expandShareAggregates is invoked from
// rewriteNode's 'call' case BEFORE any slot is interned for that call
// site, and the synthesized SUM CallNode is re-entered through
// rewriteNode so it dedups against user-written SUMs via the normal
// internSlot (fn, colId, scope) key — behaviorally equivalent to the
// brief's two-pass "transform → expand → slot-assign" contract.
//
// Also adapted: the calc DSL's scope wire format is a trailing STRING
// LITERAL (`SUM([x], 'group')`, aggTransform.ts's documented contract) —
// `scope: group` is 21i editor sugar that does not parse today (`:` is
// the ternary token), so the manual-equivalence assertions below use the
// literal form.

describe('share aggregates — expansion', () => {
  it('exports the four share names', () => {
    expect([...SHARE_AGGREGATE_NAMES].sort()).toEqual(
      ['PCT_OF_GRAND', 'PCT_OF_GROUP', 'PCT_OF_PARENT', 'PCT_OF_TOTAL'],
    );
  });

  it("PCT_OF_GROUP([qty]) ≡ [qty] / SUM([qty], 'group') — prePass and per-row program", () => {
    const share = compileCalc('PCT_OF_GROUP([qty])');
    const manual = compileCalc("[qty] / SUM([qty], 'group')");
    expect(share.ok).toBe(true);
    expect(manual.ok).toBe(true);
    if (!share.ok || !manual.ok) return;
    expect(share.compiled.prePass).toEqual(manual.compiled.prePass);
    expect(share.compiled.prePass).toHaveLength(1);
    expect(share.compiled.prePass[0]).toMatchObject({
      slot: 0, fn: 'SUM', colId: 'qty', scope: { kind: 'group' },
    });
    const rand = makeLcg(99);
    for (let i = 0; i < 50; i += 1) {
      const row = { qty: Math.floor(rand() * 100) };
      const sum = 1 + Math.floor(rand() * 500); // pre-pass slot value
      expect(evaluateCalcAst(share.compiled.ast, row, [sum], null))
        .toBe(evaluateCalcAst(manual.compiled.ast, row, [sum], null));
    }
  });

  it('null/zero denominator → null (interpreter errors-are-null-cells rule)', () => {
    const r = compileCalc('PCT_OF_GRAND([qty])');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evaluateCalcAst(r.compiled.ast, { qty: 5 }, [0], null)).toBeNull();
    expect(evaluateCalcAst(r.compiled.ast, { qty: 5 }, [null], null)).toBeNull();
  });

  it('scope map: TOTAL→visible, GRAND→all, GROUP→group, PARENT→parent', () => {
    const cases = [
      ['PCT_OF_TOTAL', 'visible'],
      ['PCT_OF_GRAND', 'all'],
      ['PCT_OF_GROUP', 'group'],
      ['PCT_OF_PARENT', 'parent'],
    ] as const;
    for (const [name, kind] of cases) {
      const r = compileCalc(`${name}([qty])`);
      expect(r.ok, name).toBe(true);
      if (!r.ok) continue;
      expect(r.compiled.prePass, name).toHaveLength(1);
      expect(r.compiled.prePass[0], name).toMatchObject({ fn: 'SUM', colId: 'qty', scope: { kind } });
    }
  });

  it('share fn names never reach the prePass; synthesized SUM dedups with user SUMs', () => {
    const r = compileCalc("PCT_OF_GROUP([qty]) * SUM([qty], 'group')");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prePass).toHaveLength(1); // deduped into one SUM slot
    for (const spec of r.compiled.prePass) expect(spec.fn).toBe('SUM');
  });

  it('explicit scope arg on a share aggregate → bad-shape', () => {
    const r = compileCalc("PCT_OF_GROUP([qty], 'all')");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('bad-shape');
  });

  it('CROSS-TASK: PERCENTILE literal folds into the canonical fn string the registry parses', () => {
    const r = compileCalc('PERCENTILE([px], 95)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prePass[0]).toMatchObject({ fn: 'PERCENTILE(95)', colId: 'px' });
    expect(getAggregate(r.compiled.prePass[0]!.fn)).toBeDefined();
  });

  it('expandShareAggregates: pure structural rewrite (input AST untouched) — landed CallNode shape', () => {
    const loc = { start: 0, end: 0 };
    const shareNode = {
      kind: 'call' as const,
      name: 'PCT_OF_GROUP',
      args: [{ kind: 'field' as const, path: ['qty'], loc }],
      loc,
    };
    const snapshot = structuredClone(shareNode);
    const out = expandShareAggregates(shareNode);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(shareNode).toEqual(snapshot); // pure
    expect(out.ast).toMatchObject({
      kind: 'binary',
      op: '/',
      left: { kind: 'field', path: ['qty'] },
      right: {
        kind: 'call',
        name: 'SUM',
        args: [{ kind: 'field', path: ['qty'] }, { kind: 'literal', value: 'group' }],
      },
    });
  });
});
