import { describe, expect, it } from 'vitest';
import {
  FlattenIndex,
  extractRootAggregates,
  toDisplayOrder,
} from '../src/ssrm/flattenIndex';
import { buildCompositeGroupKey } from '../src/ssrm/groupKeys';

describe('toDisplayOrder / FlattenIndex', () => {
  const cols = ['desk', 'region'];
  const groups = [
    { path: [], leafCount: 4, aggregates: { pnl: 100 } },
    { path: ['EQ'], leafCount: 2, aggregates: { pnl: 40 } },
    { path: ['EQ', 'AMER'], leafCount: 2, aggregates: { pnl: 40 } },
    { path: ['FX'], leafCount: 2, aggregates: { pnl: 60 } },
    { path: ['FX', 'EMEA'], leafCount: 2, aggregates: { pnl: 60 } },
  ];

  it('extracts root aggregates and drops path:[] from display order', () => {
    expect(extractRootAggregates(groups)).toEqual({ pnl: 100 });
    const nodes = toDisplayOrder(groups, cols);
    expect(nodes.map((n) => n.path)).toEqual([
      ['EQ'],
      ['EQ', 'AMER'],
      ['FX'],
      ['FX', 'EMEA'],
    ]);
    expect(nodes[0]!.key).toBe(buildCompositeGroupKey(cols, ['EQ']));
  });

  it('collapsed root shows only depth-0 group rows', () => {
    const nodes = toDisplayOrder(groups, cols);
    const idx = new FlattenIndex(nodes, new Set(), cols.length - 1);
    expect(idx.rowCount).toBe(2); // EQ + FX
    expect(idx.rowAt(0)?.kind).toBe('group');
    expect(idx.rowAt(1)?.kind).toBe('group');
  });

  it('expanding a leaf-level group inserts leaf slots', () => {
    const nodes = toDisplayOrder(groups, cols);
    const eqAmer = buildCompositeGroupKey(cols, ['EQ', 'AMER']);
    const expanded = new Set([
      buildCompositeGroupKey(cols, ['EQ']),
      eqAmer,
    ]);
    const idx = new FlattenIndex(nodes, expanded, cols.length - 1);
    // EQ group, EQ/AMER group, 2 leaves, FX group
    expect(idx.rowCount).toBe(5);
    const kinds = [0, 1, 2, 3, 4].map((i) => idx.rowAt(i)!.kind);
    expect(kinds).toEqual(['group', 'group', 'leaf', 'leaf', 'group']);
    const leaf = idx.rowAt(2);
    expect(leaf).toMatchObject({ kind: 'leaf', leafOffset: 0 });
  });

  it('groupTotalRow bottom emits footer after leaves', () => {
    const nodes = toDisplayOrder(groups, cols);
    const eqAmer = buildCompositeGroupKey(cols, ['EQ', 'AMER']);
    const expanded = new Set([
      buildCompositeGroupKey(cols, ['EQ']),
      eqAmer,
    ]);
    const idx = new FlattenIndex(nodes, expanded, cols.length - 1, {
      groupTotalRow: 'bottom',
    });
    const kinds = Array.from({ length: idx.rowCount }, (_, i) => idx.rowAt(i)!.kind);
    expect(kinds).toContain('footer');
    expect(kinds.indexOf('footer')).toBeGreaterThan(kinds.lastIndexOf('leaf'));
  });

  it('entriesInRange covers contiguous flatten slots', () => {
    const nodes = toDisplayOrder(groups, cols);
    const expanded = new Set(nodes.map((n) => n.key));
    const idx = new FlattenIndex(nodes, expanded, cols.length - 1);
    const entries = idx.entriesInRange(0, idx.rowCount);
    expect(entries.length).toBe(idx.rowCount);
  });
});
