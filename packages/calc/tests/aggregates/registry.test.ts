import { beforeEach, describe, expect, it } from 'vitest';
import {
  getAggregate, listAggregates, registerAggregate, resetAggregateRegistry, serializeAggregates,
} from '../../src/aggregates/registry';
import type { Aggregate } from '../../src/types';
import { makeLcg } from '../helpers/lcg';

beforeEach(() => resetAggregateRegistry());

/** Self-contained impl: counts participating rows regardless of type. */
function selfContainedCount(): Aggregate {
  return {
    init: () => 0,
    addRow: (s: number, v: unknown) => (v === null || v === undefined ? s : s + 1),
    removeRow: (s: number, v: unknown) => (v === null || v === undefined ? s : s - 1),
    updateRow: (s: number) => s,
    finalize: (s: number) => (s === 0 ? null : s),
  } as Aggregate;
}

/** Self-contained impl using globals only (Math is fine — worker global scope). */
function selfContainedSumAbs(): Aggregate {
  return {
    init: () => ({ sum: 0, n: 0 }),
    addRow: (s: { sum: number; n: number }, v: unknown) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return s;
      s.sum += Math.abs(v);
      s.n += 1;
      return s;
    },
    removeRow: (s: { sum: number; n: number }, v: unknown) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return s;
      s.sum -= Math.abs(v);
      s.n -= 1;
      return s;
    },
    updateRow: (s: { sum: number; n: number }, o: unknown, n2: unknown) => {
      if (typeof o === 'number' && Number.isFinite(o)) { s.sum -= Math.abs(o); s.n -= 1; }
      if (typeof n2 === 'number' && Number.isFinite(n2)) { s.sum += Math.abs(n2); s.n += 1; }
      return s;
    },
    finalize: (s: { sum: number; n: number }) => (s.n === 0 ? null : s.sum),
  } as Aggregate;
}

describe('aggregate registry', () => {
  it('built-ins are registered at module load', () => {
    for (const name of ['SUM', 'COUNT', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT']) {
      expect(listAggregates(), name).toContain(name);
      expect(getAggregate(name), name).toBeDefined();
    }
  });

  it('getAggregate returns a FRESH instance per call (independent state)', () => {
    const a = getAggregate('SUM')!;
    const b = getAggregate('SUM')!;
    const sa = a.addRow(a.init(), 5);
    expect(a.finalize(sa)).toBe(5);
    expect(b.finalize(b.init())).toBeNull(); // untouched by a's stream
  });

  it('unknown name → undefined (worker leaves the slot null — never throws mid-pass)', () => {
    expect(getAggregate('NOPE')).toBeUndefined();
    expect(getAggregate('NOPE(50)')).toBeUndefined();
  });

  it('duplicate registration throws unless { force: true }; reset restores built-ins', () => {
    const impl = selfContainedCount();
    expect(() => registerAggregate('SUM', impl)).toThrow(/already registered/);
    registerAggregate('SUM', impl, { force: true });
    const masked = getAggregate('SUM')!;
    expect(masked.finalize(masked.addRow(masked.init(), 123))).toBe(1); // counting impl
    resetAggregateRegistry();
    const restored = getAggregate('SUM')!;
    expect(restored.finalize(restored.addRow(restored.init(), 123))).toBe(123);
  });

  it('rejects impls that close over free variables (smoke test at register time)', () => {
    const captured = 41;
    const bad = {
      init: () => 0,
      addRow: (s: number) => s + captured, // free variable — dies in new Function
      removeRow: (s: number) => s,
      updateRow: (s: number) => s,
      finalize: (s: number) => s,
    } as Aggregate;
    expect(() => registerAggregate('BAD', bad)).toThrow(/self-contained/);
    expect(getAggregate('BAD')).toBeUndefined(); // nothing half-registered
  });

  it('smoke test exercises removeRow/updateRow too — an impl whose removeRow throws fails at registration', () => {
    const bad = {
      init: () => 0,
      addRow: (s: number, v: unknown) => (typeof v === 'number' ? s + v : s),
      removeRow: (): number => { throw new Error('boom'); },
      updateRow: (s: number) => s,
      finalize: (s: number) => s,
    } as Aggregate;
    expect(() => registerAggregate('BAD_REMOVE', bad)).toThrow(/self-contained/);
    expect(getAggregate('BAD_REMOVE')).toBeUndefined();
  });

  it('accepts self-contained custom impls (globals allowed)', () => {
    registerAggregate('SUM_ABS', selfContainedSumAbs());
    const agg = getAggregate('SUM_ABS')!;
    let s = agg.init();
    s = agg.addRow(s, -3);
    s = agg.addRow(s, 4);
    expect(agg.finalize(s)).toBe(7);
    expect(listAggregates()).toContain('SUM_ABS');
  });

  it('serializeAggregates: every entry round-trips through new Function and matches local behavior (10-seed streaming subset)', () => {
    registerAggregate('SUM_ABS', selfContainedSumAbs()); // customs ship too
    const seeds = Array.from({ length: 10 }, (_, i) => i * 104729 + 13);
    const entries = serializeAggregates();
    expect(entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT', 'SUM_ABS']),
    );
    for (const { name, source } of entries) {
      const factory = new Function('return (' + source + ')')() as (p?: number) => Aggregate;
      // Arity convention: length >= 1 → parameterized (none until Task 6).
      const rebuilt = factory.length >= 1 ? factory(50) : factory();
      const local = factory.length >= 1 ? getAggregate(`${name}(50)`)! : getAggregate(name)!;
      for (const seed of seeds) {
        const rand = makeLcg(seed);
        let sr = rebuilt.init();
        let sl = local.init();
        const survivors: number[] = [];
        for (let i = 0; i < 60; i += 1) {
          if (rand() < 0.6 || survivors.length === 0) {
            const v = Math.floor(rand() * 20) - 10;
            survivors.push(v);
            sr = rebuilt.addRow(sr, v);
            sl = local.addRow(sl, v);
          } else {
            const idx = Math.floor(rand() * survivors.length);
            const [v] = survivors.splice(idx, 1);
            sr = rebuilt.removeRow(sr, v);
            sl = local.removeRow(sl, v);
          }
        }
        expect(rebuilt.finalize(sr), `${name} seed ${seed}`).toBe(local.finalize(sl));
      }
    }
  });
});
