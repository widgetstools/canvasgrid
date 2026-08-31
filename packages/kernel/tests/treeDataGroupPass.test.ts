import { describe, it, expect } from 'vitest';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

/**
 * Tree data — the hierarchy comes from each row's own path rather than from
 * column values.
 *
 * Deliberately built on the SAME machinery as row grouping (`GroupNode`,
 * `BuildBucket`, the flatten vocabulary) rather than as a parallel pipeline,
 * so expand/collapse, aggregation, footers and the auto group column keep
 * working without a second implementation to hold in sync. These tests pin the
 * two things a tree can express that column grouping cannot:
 *
 *   - depth is PER ROW, not fixed by the model;
 *   - a node can be a real row AND a parent at the same time.
 */

const COLS: WorkerColumn[] = [
  { colId: 'name', field: 'name', type: 'text' },
  { colId: 'size', field: 'size', type: 'number' },
  { colId: 'path', field: 'path', type: 'text' },
];

function build(rows: Array<{ id: string; path: string[]; size?: number }>) {
  const store = new RowStore('id');
  store.setAll(rows);
  const gp = new GroupPass(store, COLS);
  gp.setModel({ rowGroupCols: [], treePathField: 'path' });
  return gp.apply(rows.map((r) => r.id));
}

/** Flatten to a readable shape: `group:Depth:Key` / `row:Depth:Index`. */
const shape = (out: ReturnType<typeof build>): string[] =>
  out.flatOrder.map((e) =>
    e.kind === 'row' ? `row:${e.depth}:${e.rowIndex}`
      : e.kind === 'group' ? `group:${e.depth}`
        : `footer:${e.depth}`);

/** Depth-first node walk, for structural assertions. */
function nodes(out: ReturnType<typeof build>): Array<{ value: unknown; depth: number; childCount: number; self: boolean }> {
  const acc: Array<{ value: unknown; depth: number; childCount: number; self: boolean }> = [];
  const walk = (list: readonly any[]): void => {
    for (const n of list) {
      acc.push({ value: n.value, depth: n.depth, childCount: n.childCount, self: n.selfRowIndex !== undefined });
      walk(n.childGroups);
    }
  };
  walk(out.roots);
  return acc;
}

describe('tree shape', () => {
  it('builds nested nodes from shared path prefixes', () => {
    const out = build([
      { id: 'a', path: ['FX', 'EMEA', 'Book 1'] },
      { id: 'b', path: ['FX', 'EMEA', 'Book 2'] },
      { id: 'c', path: ['FX', 'AMER', 'Book 1'] },
      { id: 'd', path: ['Rates', 'EMEA', 'Book 1'] },
    ]);
    expect(out.bypassed).toBe(false);
    expect(out.roots.map((r) => r.value)).toEqual(['FX', 'Rates']);
    const fx = out.roots[0]!;
    expect(fx.childGroups.map((c) => c.value)).toEqual(['EMEA', 'AMER']);
    expect(fx.childCount).toBe(3);          // three descendant rows
  });

  it('allows different depths in the same tree', () => {
    // Column grouping cannot express this: every row would sit at the same
    // depth. Here `Rates` is a leaf at depth 0 while `FX` runs three deep.
    const out = build([
      { id: 'a', path: ['FX', 'EMEA', 'Book 1'] },
      { id: 'b', path: ['Rates'] },
    ]);
    expect(shape(out)).toEqual([
      'group:0',            // FX
      'group:1',            // EMEA
      'row:2:0',            // Book 1 — leaf at depth 2
      'row:0:1',            // Rates — leaf at depth 0
    ]);
  });

  it('creates filler nodes for paths no row occupies', () => {
    // Nothing has the path ['FX'] or ['FX','EMEA'], but both must exist as
    // nodes for the hierarchy to render.
    const out = build([{ id: 'a', path: ['FX', 'EMEA', 'Book 1'] }]);
    const all = nodes(out);
    expect(all.map((n) => [n.value, n.self])).toEqual([
      ['FX', false],        // filler
      ['EMEA', false],      // filler
      ['Book 1', true],     // real row
    ]);
  });

  it('lets a node be a real row AND a parent', () => {
    // The case that has no row-grouping equivalent.
    const out = build([
      { id: 'parent', path: ['FX', 'EMEA'] },
      { id: 'child', path: ['FX', 'EMEA', 'Book 1'] },
    ]);
    const emea = out.roots[0]!.childGroups[0]!;
    expect(emea.value).toBe('EMEA');
    expect(emea.selfRowIndex).toBe(0);      // it is row 0
    expect(emea.childGroups.length).toBe(1); // and a parent
    // Both itself and its descendant count.
    expect(emea.childCount).toBe(2);
  });
});

describe('flat ordering', () => {
  it('emits childless nodes as ROWS and parents as GROUPS', () => {
    // AG renders tree leaves as ordinary rows; only nodes with children get
    // an expand chevron.
    const out = build([
      { id: 'a', path: ['FX', 'Book 1'] },
      { id: 'b', path: ['FX', 'Book 2'] },
    ]);
    expect(shape(out)).toEqual(['group:0', 'row:1:0', 'row:1:1']);
  });

  it('gives rows the depth of their own path, not a fixed row depth', () => {
    // Row grouping puts every row one deeper than the deepest group. A tree
    // cannot: depth is what positions the row in the hierarchy.
    const out = build([
      { id: 'shallow', path: ['A', 'x'] },
      { id: 'deep', path: ['A', 'B', 'C', 'y'] },
    ]);
    const rows = out.flatOrder.filter((e) => e.kind === 'row') as Array<{ depth: number }>;
    expect(rows.map((r) => r.depth)).toEqual([1, 3]);
  });

  it('preserves first-seen sibling order', () => {
    const out = build([
      { id: 'a', path: ['Zebra', 'x'] },
      { id: 'b', path: ['Alpha', 'y'] },
    ]);
    expect(out.roots.map((r) => r.value)).toEqual(['Zebra', 'Alpha']);
  });
});

describe('degenerate input', () => {
  it('bypasses when no row carries a usable path', () => {
    const out = build([{ id: 'a', path: [] as string[] }]);
    expect(out.bypassed).toBe(true);
    expect(out.roots).toEqual([]);
  });

  it('skips rows whose path is missing or malformed, keeping the rest', () => {
    const store = new RowStore('id');
    store.setAll([
      { id: 'good', path: ['A', 'x'] },
      { id: 'nopath' },
      { id: 'notarray', path: 'A/x' },
    ]);
    const gp = new GroupPass(store, COLS);
    gp.setModel({ rowGroupCols: [], treePathField: 'path' });
    const out = gp.apply(['good', 'nopath', 'notarray']);
    expect(out.bypassed).toBe(false);
    expect(out.roots.map((r) => r.value)).toEqual(['A']);
    expect(out.roots[0]!.childCount).toBe(1);
  });

  it('treats a null path segment as an empty key rather than throwing', () => {
    const out = build([{ id: 'a', path: ['A', null as unknown as string] }]);
    expect(out.bypassed).toBe(false);
    expect(out.roots[0]!.childGroups[0]!.value).toBeNull();
  });
});

describe('coexistence with row grouping', () => {
  it('a tree path REPLACES rowGroupCols rather than combining with it', () => {
    const store = new RowStore('id');
    store.setAll([
      { id: 'a', name: 'one', path: ['A', 'x'] },
      { id: 'b', name: 'two', path: ['A', 'y'] },
    ]);
    const gp = new GroupPass(store, COLS);
    // Both set: the tree wins, so the hierarchy is A/x, A/y and NOT one/two.
    gp.setModel({ rowGroupCols: ['name'], treePathField: 'path' });
    const out = gp.apply(['a', 'b']);
    expect(out.roots.map((r) => r.value)).toEqual(['A']);
  });

  it('falls back to column grouping when no tree path is configured', () => {
    const store = new RowStore('id');
    store.setAll([
      { id: 'a', name: 'one', path: ['A'] },
      { id: 'b', name: 'two', path: ['B'] },
    ]);
    const gp = new GroupPass(store, COLS);
    gp.setModel({ rowGroupCols: ['name'] });
    const out = gp.apply(['a', 'b']);
    expect(out.roots.map((r) => r.value)).toEqual(['one', 'two']);
  });
});
