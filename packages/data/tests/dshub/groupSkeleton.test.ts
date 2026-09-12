/**
 * Folding the Rust hub's `groupDelta` into an SSRM v2 skeleton.
 *
 * The hub pushes only the group paths whose aggregate or leaf count MOVED --
 * it never re-sends an unchanged group -- so a consumer that treats each push
 * as the whole tree loses every group that happened to be quiet. These pin the
 * fold: what a push carries is replaced, what it omits survives, and a removal
 * takes its path out.
 *
 * The shapes are taken from the hub's `group_json` (hub-rust/src/groupwatch.rs)
 * and VelocityGrid's `SkeletonGroup` (kernel/src/types/ssrm.ts), which line up
 * field for field -- see the module comment for why that is a coincidence
 * worth using.
 */
import { describe, it, expect } from 'vitest';
import { HubGroupSkeleton } from '../../src/dshub/groupSkeleton';

/** A group as the ENGINE emits it: `path` type-tagged, `values` raw. */
const g = (values: string[], count: number, aggregates?: Record<string, unknown>) =>
  ({ path: values.map((v) => `s${v}`), values, count, ...(aggregates ? { aggregates } : {}) });

describe('folding groupDelta pushes', () => {
  it('the first push is the whole tree', () => {
    const s = new HubGroupSkeleton();
    expect(s.apply({
      type: 'groupDelta',
      groups: [g(['FX'], 12), g(['FX', 'EMEA'], 5), g(['FX', 'APAC'], 7)],
    })).toBe(true);
    expect(s.skeleton()).toEqual([
      { path: ['FX'], leafCount: 12 },
      { path: ['FX', 'EMEA'], leafCount: 5 },
      { path: ['FX', 'APAC'], leafCount: 7 },
    ]);
  });

  it('a later push updates only what it names, and leaves the rest standing', () => {
    // The reason this class exists. A delta naming one group is not a tree
    // with one group in it.
    const s = new HubGroupSkeleton();
    s.apply({ groups: [g(['FX'], 12), g(['RATES'], 30)] });
    s.apply({ groups: [g(['FX'], 13)] });
    expect(s.skeleton()).toEqual([
      { path: ['FX'], leafCount: 13 },
      { path: ['RATES'], leafCount: 30 },
    ]);
  });

  it('a push carrying only moved aggregates keeps the leaf count', () => {
    const s = new HubGroupSkeleton();
    s.apply({ groups: [g(['FX'], 12, { pnl: 100 })] });
    s.apply({ groups: [{ path: ['sFX'], values: ['FX'], aggregates: { pnl: 250 } }] });
    expect(s.skeleton()).toEqual([{ path: ['FX'], leafCount: 12, aggregates: { pnl: 250 } }]);
  });

  it('and a push carrying only a moved count keeps the aggregates', () => {
    const s = new HubGroupSkeleton();
    s.apply({ groups: [g(['FX'], 12, { pnl: 100 })] });
    s.apply({ groups: [{ path: ['sFX'], values: ['FX'], count: 14 }] });
    expect(s.skeleton()).toEqual([{ path: ['FX'], leafCount: 14, aggregates: { pnl: 100 } }]);
  });

  it('removed paths leave the tree', () => {
    const s = new HubGroupSkeleton();
    s.apply({ groups: [g(['FX'], 12), g(['RATES'], 30)] });
    expect(s.apply({ removed: [['sFX']] })).toBe(true);
    expect(s.skeleton()).toEqual([{ path: ['RATES'], leafCount: 30 }]);
  });

  it('reports whether anything moved, so a quiet tick costs no repaint', () => {
    const s = new HubGroupSkeleton();
    expect(s.apply({ groups: [] })).toBe(false);
    expect(s.apply({})).toBe(false);
    expect(s.apply(null)).toBe(false);
    expect(s.apply({ removed: [['never', 'existed']] })).toBe(false);
  });
});

describe('the engine\u2019s tagged path is the key; its raw values are the caption', () => {
  it('the skeleton carries raw values, never the type tag', () => {
    // `path` arrives from the engine as `["sRates"]` -- an `s` tag for a
    // string value. Handing that to v2 paints `sRates` as the group caption.
    // Found by running the fold against the real engine, not by reading the
    // Rust; the field names alone suggest the opposite mapping.
    const sk = new HubGroupSkeleton();
    sk.apply({ groups: [{ path: ['sRates'], values: ['Rates'], count: 2, aggregates: { mv: 30 } }] });
    expect(sk.skeleton()).toEqual([{ path: ['Rates'], leafCount: 2, aggregates: { mv: 30 } }]);
  });

  it('two groups whose raw values collide stay distinct under their tags', () => {
    // The tagged key is why this works: a numeric 1 and a string "1" are
    // different groups, and their raw values are indistinguishable.
    const sk = new HubGroupSkeleton();
    sk.apply({ groups: [
      { path: ['s1'], values: ['1'], count: 1 },
      { path: ['n1'], values: [1], count: 2 },
    ] });
    expect(sk.size).toBe(2);
  });
});

describe('paths are addressed exactly', () => {
  it('a separator inside a group value does not collide with a deeper path', () => {
    // `['a/b']` and `['a','b']` are different groups. Joining on '/' or '|'
    // would merge them, and the grid would paint one group's aggregate under
    // the other's caption.
    const s = new HubGroupSkeleton();
    s.apply({ groups: [g(['a/b'], 1), g(['a', 'b'], 2), g(['a|b'], 3)] });
    expect(s.size).toBe(3);
    expect(s.skeleton().map((x) => x.leafCount).sort()).toEqual([1, 2, 3]);
  });

  it('the root entry passes through -- v2 reads `path: []` as the grand total', () => {
    const s = new HubGroupSkeleton();
    s.apply({ groups: [{ path: [], values: [], count: 42, aggregates: { pnl: -1 } }, g(['FX'], 42)] });
    expect(s.skeleton()).toContainEqual({ path: [], leafCount: 42, aggregates: { pnl: -1 } });
  });

  it('a malformed group is skipped rather than poisoning the tree', () => {
    const s = new HubGroupSkeleton();
    s.apply({ groups: [g(['FX'], 1), { path: undefined } as never, { } as never] });
    expect(s.skeleton()).toEqual([{ path: ['FX'], leafCount: 1 }]);
  });

  it('the stored path is a copy -- the hub reuses its buffers', () => {
    const s = new HubGroupSkeleton();
    const live = ['FX'];
    s.apply({ groups: [{ path: ['sFX'], values: live, count: 1 }] });
    live[0] = 'MUTATED';
    expect(s.skeleton()[0]!.path).toEqual(['FX']);
  });
});

describe('leaf counting', () => {
  it('counts the top level only -- deeper levels re-count the same leaves', () => {
    const s = new HubGroupSkeleton();
    s.apply({
      groups: [
        g(['FX'], 12), g(['FX', 'EMEA'], 5), g(['FX', 'APAC'], 7),
        g(['RATES'], 30), g(['RATES', 'EMEA'], 30),
      ],
    });
    expect(s.topLevelLeafCount()).toBe(42);
  });

  it('ignores the root entry', () => {
    const s = new HubGroupSkeleton();
    s.apply({ groups: [{ path: [], values: [], count: 999 }, g(['FX'], 12)] });
    expect(s.topLevelLeafCount()).toBe(12);
  });
});

describe('a new generation starts from empty', () => {
  it('reset clears the tree, because the hub restarts its own diff', () => {
    // A sort/filter/groupBy change makes every remembered path meaningless;
    // the hub will re-send from empty, and anything kept here would linger as
    // a group the new query does not have.
    const s = new HubGroupSkeleton();
    s.apply({ groups: [g(['FX'], 12)] });
    s.reset();
    expect(s.skeleton()).toEqual([]);
    expect(s.size).toBe(0);
  });
});
