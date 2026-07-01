// Cycle 15.5 / Task 4 — groupHideOpenParents flag unit tests.
//
// When groupHideOpenParents=true, expanded parent group rows are skipped
// in the visible-order walk; children appear in the parent's slot.
// Collapsed groups still emit their group row and hide children (unchanged).

import { describe, it, expect } from 'vitest';
import { GroupPass, RowStore } from '../src/worker/dataPipeline';
import {
  computeGroupVisibleOrder,
  computeGroupVisibleRowCount,
} from '../src/worker/viewportSlicer';
import type { FlatOrderEntry } from '../src/worker/passes/groupPass';
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

function buildOneLevel(): FlatOrderEntry[] {
  const store = fixtureStore();
  const gp = new GroupPass(store, cols);
  gp.setModel({ rowGroupCols: ['desk'] });
  const res = gp.apply(allIds);
  if (res.bypassed) throw new Error('expected grouped');
  return res.flatOrder as FlatOrderEntry[];
}

function buildTwoLevel(): FlatOrderEntry[] {
  const store = fixtureStore();
  const gp = new GroupPass(store, cols);
  gp.setModel({ rowGroupCols: ['desk', 'region'] });
  const res = gp.apply(allIds);
  if (res.bypassed) throw new Error('expected grouped');
  return res.flatOrder as FlatOrderEntry[];
}

describe('computeGroupVisibleOrder – hideOpenParents=false (default)', () => {
  it('all collapsed → only group rows visible', () => {
    const flat = buildOneLevel();
    const order = computeGroupVisibleOrder(flat, new Set(), false);
    expect(order.every(e => e.kind === 'group')).toBe(true);
    expect(order).toHaveLength(2); // APAC, EMEA
  });

  it('one group expanded → group row + child rows visible', () => {
    const flat = buildOneLevel();
    const order = computeGroupVisibleOrder(flat, new Set(['desk:APAC']), false);
    // group(APAC) + 3 rows + group(EMEA)
    expect(order[0]).toMatchObject({ kind: 'group', key: 'desk:APAC' });
    expect(order.filter(e => e.kind === 'row')).toHaveLength(3);
    expect(order.at(-1)).toMatchObject({ kind: 'group', key: 'desk:EMEA' });
  });

  it('all expanded → all rows visible including all group rows', () => {
    const flat = buildOneLevel();
    const order = computeGroupVisibleOrder(flat, new Set(['desk:APAC','desk:EMEA']), false);
    // 2 group rows + 5 data rows
    expect(order).toHaveLength(7);
    expect(order.filter(e => e.kind === 'group')).toHaveLength(2);
    expect(order.filter(e => e.kind === 'row')).toHaveLength(5);
  });
});

describe('computeGroupVisibleOrder – hideOpenParents=true', () => {
  it('all collapsed → collapsed group rows still appear', () => {
    // Collapsed groups always emit even with hideOpenParents
    const flat = buildOneLevel();
    const order = computeGroupVisibleOrder(flat, new Set(), true);
    expect(order.every(e => e.kind === 'group')).toBe(true);
    expect(order).toHaveLength(2);
  });

  it('expanded group row is hidden; its children appear in its slot', () => {
    const flat = buildOneLevel();
    const order = computeGroupVisibleOrder(flat, new Set(['desk:APAC']), true);
    // APAC group row must NOT appear
    expect(order.some(e => e.kind === 'group' && e.key === 'desk:APAC')).toBe(false);
    // APAC's 3 data rows appear
    expect(order.filter(e => e.kind === 'row')).toHaveLength(3);
    // collapsed EMEA still shows its group row
    expect(order.some(e => e.kind === 'group' && e.key === 'desk:EMEA')).toBe(true);
  });

  it('both groups expanded → no group rows, all 5 data rows visible', () => {
    const flat = buildOneLevel();
    const order = computeGroupVisibleOrder(flat, new Set(['desk:APAC','desk:EMEA']), true);
    expect(order.every(e => e.kind === 'row')).toBe(true);
    expect(order).toHaveLength(5);
  });

  it('two-level: top-level expanded hides its group row, child groups still shown', () => {
    const flat = buildTwoLevel();
    // Expand APAC (top level) but not its children
    const order = computeGroupVisibleOrder(flat, new Set(['desk:APAC']), true);
    // APAC group row hidden
    expect(order.some(e => e.kind === 'group' && e.key === 'desk:APAC')).toBe(false);
    // APAC's child groups (Rates, Credit) are collapsed → still shown as group rows
    const childGroups = order.filter(e => e.kind === 'group' && e.key !== 'desk:EMEA');
    expect(childGroups.length).toBeGreaterThanOrEqual(2);
  });

  it('two-level: both levels expanded → data rows appear, group rows hidden', () => {
    const flat = buildTwoLevel();
    // Expand APAC and APAC>Rates (key format: parentKey::colId:value)
    const expanded = new Set(['desk:APAC', 'desk:APAC::region:Rates']);
    const order = computeGroupVisibleOrder(flat, expanded, true);
    // APAC group row must not appear
    expect(order.some(e => e.kind === 'group' && e.key === 'desk:APAC')).toBe(false);
    // EMEA collapsed → still a group row
    expect(order.some(e => e.kind === 'group' && e.key === 'desk:EMEA')).toBe(true);
    // data rows from APAC>Rates appear (rowIndex >= 0)
    expect(order.filter(e => e.kind === 'row').length).toBeGreaterThan(0);
  });

  it('row count with hideOpenParents=false: 2 groups + 5 rows when all expanded', () => {
    const flat = buildOneLevel();
    const count = computeGroupVisibleRowCount(flat, new Set(['desk:APAC','desk:EMEA']), false);
    expect(count).toBe(7);
  });

  it('row count with hideOpenParents=true excludes expanded group rows', () => {
    const flat = buildOneLevel();
    const expanded = new Set(['desk:APAC', 'desk:EMEA']);
    const countHidden = computeGroupVisibleRowCount(flat, expanded, true);
    const countNormal = computeGroupVisibleRowCount(flat, expanded, false);
    // With 2 expanded groups hidden, count should be 2 less
    expect(countHidden).toBe(countNormal - 2);
  });

  it('row count: one expanded one collapsed with hideOpenParents=true', () => {
    const flat = buildOneLevel();
    // APAC expanded (hidden group row + 3 data rows), EMEA collapsed (1 group row)
    const count = computeGroupVisibleRowCount(flat, new Set(['desk:APAC']), true);
    expect(count).toBe(4); // 3 APAC rows + 1 EMEA group row
  });

  it('row count with no expansion is same regardless of flag', () => {
    const flat = buildOneLevel();
    const none = new Set<string>();
    const c1 = computeGroupVisibleRowCount(flat, none, false);
    const c2 = computeGroupVisibleRowCount(flat, none, true);
    // All collapsed: hideOpenParents has no effect since no groups are expanded
    expect(c1).toBe(c2);
    expect(c1).toBe(2);
  });

  it('data row entries carry valid rowIndex when parent group row is hidden', () => {
    const flat = buildOneLevel();
    const order = computeGroupVisibleOrder(flat, new Set(['desk:APAC']), true);
    const rows = order.filter(e => e.kind === 'row');
    expect(rows).toHaveLength(3);
    rows.forEach(r => {
      expect(typeof r.rowIndex).toBe('number');
      expect(r.rowIndex).toBeGreaterThanOrEqual(0);
    });
  });

  it('empty flatOrder with flag=true returns empty array', () => {
    expect(computeGroupVisibleOrder([], new Set(), true)).toHaveLength(0);
  });

  it('empty flatOrder with flag=true returns zero count', () => {
    expect(computeGroupVisibleRowCount([], new Set(), true)).toBe(0);
  });
});
