import { describe, it, expect } from 'vitest';
import {
  applyReorder, resolveLegalDropIndex, reorderLeavesByList,
  type ColumnOrderConstraints,
} from '../src/core/columnOrder';

const noConstraints: ColumnOrderConstraints = {
  lockOf: () => null,
  marryGroupOf: () => null,
  leafIdsOfGroup: () => [],
};

describe('columnOrder', () => {
  it('applyReorder is pure (does not mutate)', () => {
    const order = ['a', 'b', 'c', 'd'];
    const next = applyReorder(order, { colId: 'b', toIndex: 3 });
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(next).toEqual(['a', 'c', 'd', 'b']);
  });

  it('applyReorder is a no-op when target equals current index', () => {
    const order = ['a', 'b', 'c'];
    const next = applyReorder(order, { colId: 'b', toIndex: 1 });
    expect(next).toEqual(['a', 'b', 'c']);
  });

  it('applyReorder moving leftwards splices in the requested slot', () => {
    const order = ['a', 'b', 'c', 'd'];
    const next = applyReorder(order, { colId: 'd', toIndex: 0 });
    expect(next).toEqual(['d', 'a', 'b', 'c']);
  });

  it('resolveLegalDropIndex passes through when unconstrained', () => {
    const i = resolveLegalDropIndex(
      ['a', 'b', 'c'],
      { colId: 'a', toIndex: 2 },
      noConstraints,
    );
    expect(i).toBe(2);
  });

  it('lockPosition "left" clamps target to 0', () => {
    const i = resolveLegalDropIndex(
      ['a', 'b', 'c'],
      { colId: 'a', toIndex: 2 },
      { ...noConstraints, lockOf: (id) => (id === 'a' ? 'left' : null) },
    );
    expect(i).toBe(0);
  });

  it('lockPosition "right" clamps target to end', () => {
    const i = resolveLegalDropIndex(
      ['a', 'b', 'c'],
      { colId: 'c', toIndex: 0 },
      { ...noConstraints, lockOf: (id) => (id === 'c' ? 'right' : null) },
    );
    expect(i).toBe(2);
  });

  it('lockPosition "self" holds the column at its current index', () => {
    const i = resolveLegalDropIndex(
      ['a', 'b', 'c', 'd'],
      { colId: 'b', toIndex: 3 },
      { ...noConstraints, lockOf: (id) => (id === 'b' ? 'self' : null) },
    );
    expect(i).toBe(1);
  });

  it('marryChildren clamps to enclosing-group span', () => {
    const i = resolveLegalDropIndex(
      ['a', 'b', 'c', 'd'],
      { colId: 'c', toIndex: 0 },
      {
        ...noConstraints,
        marryGroupOf: (id) => (id === 'c' ? 'g' : null),
        leafIdsOfGroup: () => ['b', 'c'],
      },
    );
    // 'c' is in group 'g' which spans ['b', 'c']; nearest legal index is 1.
    expect(i).toBe(1);
  });

  it('marryChildren passes through when target is inside the span', () => {
    const i = resolveLegalDropIndex(
      ['a', 'b', 'c', 'd'],
      { colId: 'b', toIndex: 2 },
      {
        ...noConstraints,
        marryGroupOf: (id) => (id === 'b' ? 'g' : null),
        leafIdsOfGroup: () => ['b', 'c'],
      },
    );
    expect(i).toBe(2);
  });

  it('reorderLeavesByList preserves order for missing entries', () => {
    const out = reorderLeavesByList(
      {
        roots: [],
        leaves: [],
        leafById: new Map([
          ['a', {} as any], ['b', {} as any], ['c', {} as any], ['d', {} as any],
        ]),
        groupById: new Map(),
        maxDepth: 0,
      },
      ['c', 'a'],
      noConstraints,
    );
    expect(out).toEqual(['c', 'a', 'b', 'd']);
  });

  it('reorderLeavesByList ignores unknown leafIds in the desired list', () => {
    const out = reorderLeavesByList(
      {
        roots: [],
        leaves: [],
        leafById: new Map([
          ['a', {} as any], ['b', {} as any],
        ]),
        groupById: new Map(),
        maxDepth: 0,
      },
      ['zzz', 'b'],
      noConstraints,
    );
    expect(out).toEqual(['b', 'a']);
  });
});
