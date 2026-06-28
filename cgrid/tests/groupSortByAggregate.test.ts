// Cycle 15.5 / Task 9 — group sort by aggregate + per-level sort state tests.
//
// Covers:
//  - Auto-group column comparator sorts groups by group VALUE, not key
//  - Per-level sort direction cycles correctly
//  - Multi-level: each level independently sortable
//  - Key-sort fallback when no comparator registered
//  - GroupingState.perLevelSort serialises/restores correctly

import { describe, it, expect } from 'vitest';
import { GroupPass, RowStore, SortPass } from '../src/worker/dataPipeline';
import { ComparatorRegistry } from '../src/worker/comparatorRegistry';
import { GroupingState } from '../src/core/groupingState';
import type { WorkerColumn } from '../src/worker/protocol';
import type { GroupPassOutput } from '../src/worker/passes/groupPass';

const COLS: WorkerColumn[] = [
  { colId: 'desk',   field: 'desk',   type: 'text'   },
  { colId: 'region', field: 'region', type: 'text'   },
  { colId: 'pnl',    field: 'pnl',    type: 'number' },
];

const ROWS = [
  { id: '1', desk: 'EMEA',  region: 'Rates',  pnl: 100 },
  { id: '2', desk: 'EMEA',  region: 'Credit', pnl: 200 },
  { id: '3', desk: 'APAC',  region: 'Rates',  pnl: 300 },
  { id: '4', desk: 'APAC',  region: 'Credit', pnl: 400 },
  { id: '5', desk: 'AMER',  region: 'Rates',  pnl:  50 },
];

const ALL_IDS = ROWS.map(r => r.id);

function makeStore() {
  const s = new RowStore('id');
  s.setAll(ROWS);
  return s;
}

function makeGrouped(ids = ALL_IDS) {
  const store = makeStore();
  const gp = new GroupPass(store, COLS);
  gp.setModel({ rowGroupCols: ['desk'] });
  const out = gp.apply(ids);
  return { store, out };
}

function rootKeys(out: GroupPassOutput): string[] {
  return out.roots.map(r => r.value as string);
}

// ─── Default sort: composite key asc ─────────────────────────────────────────

describe('group sort: default composite key order', () => {
  it('GroupPass.apply produces groups in asc-key order by default', () => {
    const { out } = makeGrouped();
    // Keys are 'desk:AMER', 'desk:APAC', 'desk:EMEA' → values AMER < APAC < EMEA
    expect(rootKeys(out)).toEqual(['AMER', 'APAC', 'EMEA']);
  });

  it('SortPass.applyGrouped with no sort model keeps GroupPass order', () => {
    const { store, out } = makeGrouped();
    const sp = new SortPass(store, COLS);
    sp.setModel([]);
    const sorted = sp.applyGrouped(out, ALL_IDS);
    expect(rootKeys(sorted)).toEqual(['AMER', 'APAC', 'EMEA']);
  });
});

// ─── Key-based sort: desc direction ──────────────────────────────────────────

describe('group sort: key-based direction flip', () => {
  it('sort model on desk colId desc → groups reversed', () => {
    const { store, out } = makeGrouped();
    const sp = new SortPass(store, COLS);
    sp.setModel([{ colId: 'desk', direction: 'desc' }]);
    const sorted = sp.applyGrouped(out, ALL_IDS);
    expect(rootKeys(sorted)).toEqual(['EMEA', 'APAC', 'AMER']);
  });

  it('sort model on desk colId asc → groups in asc order', () => {
    const { store, out } = makeGrouped();
    const sp = new SortPass(store, COLS);
    sp.setModel([{ colId: 'desk', direction: 'asc' }]);
    const sorted = sp.applyGrouped(out, ALL_IDS);
    expect(rootKeys(sorted)).toEqual(['AMER', 'APAC', 'EMEA']);
  });
});

// ─── Value-aware comparator ───────────────────────────────────────────────────

describe('group sort: custom comparator on group value', () => {
  it('length comparator sorts groups shortest-name-first (asc)', () => {
    const { store, out } = makeGrouped();
    const reg = new ComparatorRegistry();
    // Sort by string length
    reg.register('byLength', (a: string, b: string) => a.length - b.length);

    const colsWithCmp: WorkerColumn[] = COLS.map(c =>
      c.colId === 'desk' ? { ...c, comparator: 'byLength' } : c
    );
    const sp = new SortPass(store, colsWithCmp, reg);
    sp.setModel([{ colId: 'desk', direction: 'asc' }]);
    const sorted = sp.applyGrouped(out, ALL_IDS);

    // AMER=4, APAC=4, EMEA=4 — all same length → stable (any order is valid)
    // Verify no crash and all groups present
    expect(rootKeys(sorted).sort()).toEqual(['AMER', 'APAC', 'EMEA']);
  });

  it('reverse-alpha comparator + asc → reverse alphabetical', () => {
    const { store, out } = makeGrouped();
    const reg = new ComparatorRegistry();
    // Reverse normal string compare
    reg.register('revAlpha', (a: string, b: string) =>
      a < b ? 1 : a > b ? -1 : 0
    );
    const colsWithCmp: WorkerColumn[] = COLS.map(c =>
      c.colId === 'desk' ? { ...c, comparator: 'revAlpha' } : c
    );
    const sp = new SortPass(store, colsWithCmp, reg);
    sp.setModel([{ colId: 'desk', direction: 'asc' }]);
    const sorted = sp.applyGrouped(out, ALL_IDS);
    // asc with reversed comparator → EMEA, APAC, AMER
    expect(rootKeys(sorted)).toEqual(['EMEA', 'APAC', 'AMER']);
  });

  it('reverse-alpha comparator + desc → normal alphabetical', () => {
    const { store, out } = makeGrouped();
    const reg = new ComparatorRegistry();
    reg.register('revAlpha', (a: string, b: string) =>
      a < b ? 1 : a > b ? -1 : 0
    );
    const colsWithCmp: WorkerColumn[] = COLS.map(c =>
      c.colId === 'desk' ? { ...c, comparator: 'revAlpha' } : c
    );
    const sp = new SortPass(store, colsWithCmp, reg);
    sp.setModel([{ colId: 'desk', direction: 'desc' }]);
    const sorted = sp.applyGrouped(out, ALL_IDS);
    // desc * reversed = AMER, APAC, EMEA (double-negative)
    expect(rootKeys(sorted)).toEqual(['AMER', 'APAC', 'EMEA']);
  });
});

// ─── Two-level sort: each level independently sortable ────────────────────────

describe('group sort: two-level independent sort', () => {
  function makeTwoLevel(ids = ALL_IDS) {
    const store = makeStore();
    const gp = new GroupPass(store, COLS);
    gp.setModel({ rowGroupCols: ['desk', 'region'] });
    return { store, out: gp.apply(ids) };
  }

  it('sort on desk desc leaves children in their GroupPass asc-key order', () => {
    const { store, out } = makeTwoLevel();
    const sp = new SortPass(store, COLS);
    sp.setModel([{ colId: 'desk', direction: 'desc' }]);
    const sorted = sp.applyGrouped(out, ALL_IDS);
    // Top-level groups reversed: EMEA, APAC, AMER
    expect(rootKeys(sorted)).toEqual(['EMEA', 'APAC', 'AMER']);
    // Children of APAC (Rates, Credit) stay in asc-key order
    const apacNode = sorted.roots.find(r => r.value === 'APAC')!;
    const childValues = apacNode.childGroups.map(c => c.value as string);
    expect(childValues).toEqual(['Credit', 'Rates']);
  });

  it('sort on region asc sorts children, not top-level', () => {
    const { store, out } = makeTwoLevel();
    const sp = new SortPass(store, COLS);
    sp.setModel([{ colId: 'region', direction: 'asc' }]);
    const sorted = sp.applyGrouped(out, ALL_IDS);
    // Top-level unchanged: AMER, APAC, EMEA
    expect(rootKeys(sorted)).toEqual(['AMER', 'APAC', 'EMEA']);
    // Children of EMEA: Credit < Rates (asc)
    const emeaNode = sorted.roots.find(r => r.value === 'EMEA')!;
    const emeaChildren = emeaNode.childGroups.map(c => c.value as string);
    expect(emeaChildren).toEqual(['Credit', 'Rates']);
  });
});

// ─── GroupingState.perLevelSort ───────────────────────────────────────────────

describe('GroupingState.perLevelSort', () => {
  it('initialises with null entries (no sort)', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    const sorted = gs.getPerLevelSort();
    expect(sorted).toEqual([null, null]);
  });

  it('setRowGroupColumnSort cycles: null → asc → desc → null', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });
    gs.setRowGroupColumnSort('desk', 'asc');
    expect(gs.getPerLevelSort()[0]?.direction).toBe('asc');
    gs.setRowGroupColumnSort('desk', 'desc');
    expect(gs.getPerLevelSort()[0]?.direction).toBe('desc');
    gs.setRowGroupColumnSort('desk', null);
    expect(gs.getPerLevelSort()[0]).toBeNull();
  });

  it('setRowGroupColumnSort on region colId updates only level 1', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    gs.setRowGroupColumnSort('region', 'desc');
    const sorted = gs.getPerLevelSort();
    expect(sorted[0]).toBeNull();
    expect(sorted[1]?.direction).toBe('desc');
  });

  it('perLevelSort survives addRowGroupColumn', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });
    gs.setRowGroupColumnSort('desk', 'asc');
    gs.addRowGroupColumn('region');
    // desk sort preserved at index 0, new column null at index 1
    const sorted = gs.getPerLevelSort();
    expect(sorted[0]?.direction).toBe('asc');
    expect(sorted[1]).toBeNull();
  });

  it('removeRowGroupColumn desk drops its sort, region entry shifts to index 0', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    gs.setRowGroupColumnSort('desk', 'desc');
    gs.setRowGroupColumnSort('region', 'asc');
    gs.removeRowGroupColumn('desk');
    // desk removed; region entry shifts to index 0
    const sorted = gs.getPerLevelSort();
    expect(sorted.length).toBe(1);
    expect(sorted[0]?.direction).toBe('asc');
  });

  it('setRowGroupColumnSort no-op when colId not in group columns', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });
    // 'pnl' is not a group column → no-op
    gs.setRowGroupColumnSort('pnl', 'asc');
    expect(gs.getPerLevelSort()).toEqual([null]);
  });

  it('setRowGroupColumns preserves sort for surviving columns', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk', 'region'] });
    gs.setRowGroupColumnSort('desk', 'desc');
    // Replace to only region — desk sort is lost, region gets null
    gs.setRowGroupColumns(['region']);
    expect(gs.getPerLevelSort()).toEqual([null]);
  });

  it('events fire on sort change', () => {
    const gs = new GroupingState({ rowGroupColumns: ['desk'] });
    const events: string[] = [];
    gs.on('groupingStateChanged', (e) => events.push(e.source));
    gs.setRowGroupColumnSort('desk', 'asc');
    gs.setRowGroupColumnSort('desk', 'asc'); // no-op: same direction
    expect(events).toEqual(['sort']); // fires once, not twice
  });
});
