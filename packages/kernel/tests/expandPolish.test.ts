// Cycle 15.5 / Task 6 — expand/collapse polish tests.
//
// Tests: isGroupOpenByDefault callback, resetRowGroupExpansion,
// GroupPass.computeDefaultExpandedKeys with the callback,
// and the new cgrid API surface.

import { describe, it, expect, vi } from 'vitest';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';

const cols: WorkerColumn[] = [
  { colId: 'desk',   field: 'desk',   type: 'text' },
  { colId: 'region', field: 'region', type: 'text' },
  { colId: 'price',  field: 'price',  type: 'number' },
];

const allIds = ['1', '2', '3', '4', '5'];

function fixtureStore() {
  const s = new RowStore('id');
  s.setAll([
    { id: '1', desk: 'APAC', region: 'Rates',  price: 100 },
    { id: '2', desk: 'APAC', region: 'Rates',  price: 101 },
    { id: '3', desk: 'APAC', region: 'Credit', price: 200 },
    { id: '4', desk: 'EMEA', region: 'Rates',  price: 300 },
    { id: '5', desk: 'EMEA', region: 'Credit', price: 301 },
  ]);
  return s;
}

function buildOneLevel(): { gp: GroupPass; roots: any[] } {
  const store = fixtureStore();
  const gp = new GroupPass(store, cols);
  gp.setModel({ rowGroupCols: ['desk'] });
  const res = gp.apply(allIds);
  return { gp, roots: res.roots };
}

function buildTwoLevel(): { gp: GroupPass; roots: any[] } {
  const store = fixtureStore();
  const gp = new GroupPass(store, cols);
  gp.setModel({ rowGroupCols: ['desk', 'region'] });
  const res = gp.apply(allIds);
  return { gp, roots: res.roots };
}

// ─── isGroupOpenByDefault callback ────────────────────────────────────────

describe('isGroupOpenByDefault callback in GroupPass', () => {
  it('callback returning true for all groups → all keys expanded', () => {
    const { gp, roots } = buildOneLevel();
    gp.setIsGroupOpenByDefault(() => true);

    const keys = gp.computeDefaultExpandedKeys(roots);
    expect(keys).not.toBeNull();
    expect(keys!.size).toBe(2); // desk:APAC and desk:EMEA
  });

  it('callback returning false for all groups → empty expansion set', () => {
    const { gp, roots } = buildOneLevel();
    gp.setIsGroupOpenByDefault(() => false);

    const keys = gp.computeDefaultExpandedKeys(roots);
    expect(keys).not.toBeNull();
    expect(keys!.size).toBe(0);
  });

  it('callback identifies groups by route, not just key', () => {
    const { gp, roots } = buildOneLevel();
    const seenRoutes: string[][] = [];
    gp.setIsGroupOpenByDefault(({ route }) => {
      seenRoutes.push([...route]);
      return false;
    });

    gp.computeDefaultExpandedKeys(roots);

    // One-level groups have a single-element route (the desk value)
    expect(seenRoutes.length).toBe(2);
    expect(seenRoutes.map(r => r[0]).sort()).toEqual(['APAC', 'EMEA']);
  });

  it('callback receives the correct composite key', () => {
    const { gp, roots } = buildOneLevel();
    const seenKeys: string[] = [];
    gp.setIsGroupOpenByDefault(({ key }) => {
      seenKeys.push(key);
      return false;
    });

    gp.computeDefaultExpandedKeys(roots);
    expect(seenKeys.sort()).toEqual(['desk:APAC', 'desk:EMEA']);
  });

  it('two-level: callback receives routes with 2 elements for child groups', () => {
    const { gp, roots } = buildTwoLevel();
    const routeLengths: number[] = [];
    gp.setIsGroupOpenByDefault(({ route }) => {
      routeLengths.push(route.length);
      return true;
    });

    gp.computeDefaultExpandedKeys(roots);

    // Top-level groups have route.length === 1; child groups have 2
    expect(routeLengths.some(l => l === 1)).toBe(true);
    expect(routeLengths.some(l => l === 2)).toBe(true);
  });

  it('callback selectively opens only APAC', () => {
    const { gp, roots } = buildOneLevel();
    gp.setIsGroupOpenByDefault(({ route }) => route[0] === 'APAC');

    const keys = gp.computeDefaultExpandedKeys(roots);
    expect(keys!.has('desk:APAC')).toBe(true);
    expect(keys!.has('desk:EMEA')).toBe(false);
  });

  it('callback overrides defaultExpanded setting', () => {
    const { gp, roots } = buildOneLevel();
    gp.setDefaultExpansion({ expanded: -1 }); // collapse all
    gp.setIsGroupOpenByDefault(() => true);   // but callback overrides

    const keys = gp.computeDefaultExpandedKeys(roots);
    // Callback takes priority — all groups expanded
    expect(keys!.size).toBe(2);
  });

  it('clearing callback restores defaultExpanded semantics', () => {
    const { gp, roots } = buildOneLevel();
    gp.setIsGroupOpenByDefault(() => true);
    gp.setIsGroupOpenByDefault(null); // clear
    gp.setDefaultExpansion({ expanded: -1 }); // collapse all

    const keys = gp.computeDefaultExpandedKeys(roots);
    expect(keys).not.toBeNull();
    expect(keys!.size).toBe(0);
  });

  it('callback NOT set → computeDefaultExpandedKeys falls back to defaultExpanded', () => {
    const { gp, roots } = buildOneLevel();
    // No callback set; default is 'all' (sentinel null)
    const keys = gp.computeDefaultExpandedKeys(roots);
    expect(keys).toBeNull(); // null = expand-all sentinel
  });
});

// ─── defaultExpanded interaction ──────────────────────────────────────────

describe('computeDefaultExpandedKeys — defaultExpanded combinations', () => {
  it('defaultExpandedKeys set → callback is ignored (defaultExpandedKeys vs callback priority)', () => {
    const { gp, roots } = buildOneLevel();
    // defaultExpandedKeys takes precedence over defaultExpanded, but callback
    // takes precedence over both.
    gp.setDefaultExpansion({ keys: ['desk:EMEA'] });
    gp.setIsGroupOpenByDefault(() => true); // callback overrides everything

    const keys = gp.computeDefaultExpandedKeys(roots);
    // Callback wins — both groups expanded (not just EMEA)
    expect(keys!.has('desk:APAC')).toBe(true);
    expect(keys!.has('desk:EMEA')).toBe(true);
  });

  it('defaultExpandedKeys with no callback: explicit list used', () => {
    const { gp, roots } = buildOneLevel();
    gp.setDefaultExpansion({ keys: ['desk:EMEA'] });

    const keys = gp.computeDefaultExpandedKeys(roots);
    expect(keys!.has('desk:EMEA')).toBe(true);
    expect(keys!.has('desk:APAC')).toBe(false);
  });

  it('callback called once per group node per computeDefaultExpandedKeys call', () => {
    const { gp, roots } = buildOneLevel();
    const cb = vi.fn(() => false);
    gp.setIsGroupOpenByDefault(cb);

    gp.computeDefaultExpandedKeys(roots);
    expect(cb).toHaveBeenCalledTimes(2); // APAC + EMEA
  });
});

// ─── two-level callback depth ────────────────────────────────────────────

describe('isGroupOpenByDefault depth traversal', () => {
  it('two-level: opens top-level groups but not children', () => {
    const { gp, roots } = buildTwoLevel();
    gp.setIsGroupOpenByDefault(({ route }) => route.length === 1);

    const keys = gp.computeDefaultExpandedKeys(roots);
    // Top-level: desk:APAC, desk:EMEA → expanded
    expect(keys!.has('desk:APAC')).toBe(true);
    expect(keys!.has('desk:EMEA')).toBe(true);
    // Children → not expanded
    const hasChildOpen = [...keys!].some(k => k.includes('::'));
    expect(hasChildOpen).toBe(false);
  });

  it('two-level: opens children but not top-level (inverted)', () => {
    const { gp, roots } = buildTwoLevel();
    gp.setIsGroupOpenByDefault(({ route }) => route.length === 2);

    const keys = gp.computeDefaultExpandedKeys(roots);
    // Only children open
    expect(keys!.has('desk:APAC')).toBe(false);
    expect(keys!.has('desk:EMEA')).toBe(false);
    const childCount = [...keys!].filter(k => k.includes('::')).length;
    expect(childCount).toBeGreaterThan(0);
  });
});
