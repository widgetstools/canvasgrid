import { describe, it, expect, vi } from 'vitest';
import { FlattenIndex, toDisplayOrder } from '../src/core/ssrmFlattenIndex';
import type { SkeletonGroup } from '../src/types/ssrm';

const COLS = ['desk', 'region'];

const SKELETON: SkeletonGroup[] = [
  { path: ['FX'], leafCount: 5, aggregates: { v: 100 } },
  { path: ['FX', 'EMEA'], leafCount: 3 },
  { path: ['FX', 'APAC'], leafCount: 2 },
  { path: ['Rates'], leafCount: 4 },
  { path: ['Rates', 'EMEA'], leafCount: 4 },
];

function build(expanded: string[]): FlattenIndex {
  return new FlattenIndex(
    toDisplayOrder(SKELETON, COLS),
    new Set(expanded),
    COLS.length - 1,
  );
}

describe('toDisplayOrder', () => {
  it('normalizes arbitrary input order to depth-first display order', () => {
    const shuffled = [SKELETON[4]!, SKELETON[1]!, SKELETON[0]!, SKELETON[3]!, SKELETON[2]!];
    const nodes = toDisplayOrder(shuffled, COLS);
    expect(nodes.map((n) => n.key)).toEqual([
      'desk:FX',
      'desk:FX::region:EMEA',
      'desk:FX::region:APAC',
      'desk:Rates',
      'desk:Rates::region:EMEA',
    ]);
  });

  it('preserves sibling input order', () => {
    const nodes = toDisplayOrder(SKELETON, COLS);
    const fxChildren = nodes.filter((n) => n.depth === 1 && n.path[0] === 'FX');
    expect(fxChildren.map((n) => n.path[1])).toEqual(['EMEA', 'APAC']);
  });

  it('drops orphan groups (parent absent) with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nodes = toDisplayOrder(
      [
        { path: ['FX'], leafCount: 1 },
        { path: ['Credit', 'EMEA'], leafCount: 9 }, // no ['Credit'] parent
      ],
      COLS,
    );
    expect(nodes.map((n) => n.key)).toEqual(['desk:FX']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('FlattenIndex', () => {
  it('all collapsed — only root groups are visible', () => {
    const idx = build([]);
    expect(idx.rowCount).toBe(2);
    expect(idx.rowAt(0)).toMatchObject({ kind: 'group', node: { key: 'desk:FX' } });
    expect(idx.rowAt(1)).toMatchObject({ kind: 'group', node: { key: 'desk:Rates' } });
  });

  it('expanding a non-deepest group reveals child groups, not leaves', () => {
    const idx = build(['desk:FX']);
    expect(idx.rowCount).toBe(4);
    expect(idx.rowAt(1)).toMatchObject({ kind: 'group', node: { key: 'desk:FX::region:EMEA' } });
    expect(idx.rowAt(2)).toMatchObject({ kind: 'group', node: { key: 'desk:FX::region:APAC' } });
    expect(idx.rowAt(3)).toMatchObject({ kind: 'group', node: { key: 'desk:Rates' } });
  });

  it('expanding a deepest group reveals its leaf run', () => {
    const idx = build(['desk:FX', 'desk:FX::region:EMEA']);
    // FX, EMEA, 3 leaves, APAC, Rates
    expect(idx.rowCount).toBe(7);
    expect(idx.rowAt(2)).toMatchObject({ kind: 'leaf', leafOffset: 0 });
    expect(idx.rowAt(4)).toMatchObject({ kind: 'leaf', leafOffset: 2 });
    expect(idx.rowAt(5)).toMatchObject({ kind: 'group', node: { key: 'desk:FX::region:APAC' } });
    expect(idx.indexOfGroupKey('desk:Rates')).toBe(6);
  });

  it('an expanded child under a collapsed parent stays hidden', () => {
    const idx = build(['desk:FX::region:EMEA']); // parent FX collapsed
    expect(idx.rowCount).toBe(2);
  });

  it('entriesInRange slices across segment boundaries', () => {
    const idx = build(['desk:FX', 'desk:FX::region:EMEA']);
    const entries = idx.entriesInRange(3, 6);
    expect(entries.map((e) => (e.kind === 'leaf' ? `leaf:${e.leafOffset}` : e.node.key))).toEqual([
      'leaf:1',
      'leaf:2',
      'desk:FX::region:APAC',
    ]);
  });

  it('ancestorsOf returns the group chain for leaves and groups', () => {
    const idx = build(['desk:FX', 'desk:FX::region:EMEA']);
    // Leaf at index 3 → chain is FX (0) then EMEA (1).
    expect(idx.ancestorsOf(3).map((a) => [a.index, a.node.key])).toEqual([
      [0, 'desk:FX'],
      [1, 'desk:FX::region:EMEA'],
    ]);
    // Group row APAC at 5 → parent FX only.
    expect(idx.ancestorsOf(5).map((a) => [a.index, a.node.key])).toEqual([
      [0, 'desk:FX'],
    ]);
    // Root group row → no ancestors.
    expect(idx.ancestorsOf(0)).toEqual([]);
  });

  it('rowAt out of range returns null', () => {
    const idx = build([]);
    expect(idx.rowAt(-1)).toBeNull();
    expect(idx.rowAt(2)).toBeNull();
  });
});
