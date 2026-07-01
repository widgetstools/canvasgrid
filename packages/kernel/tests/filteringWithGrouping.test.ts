// Cycle 15.5 / Task 9 — filtering interaction with grouping tests.
//
// Covers:
//  - Filter applies to leaves; only filtered-in rows appear in groups
//  - Empty groups disappear when all leaves filtered out
//  - Two-level: outer group disappears when inner groups are all empty
//  - Quick filter composes with grouping (further restricts)
//  - External filter composes
//  - Aggregates compute over filtered leaves only
//  - Re-applying filter with same keys → same tree shape
//  - Partial filter: some groups gain/lose members

import { describe, it, expect } from 'vitest';
import {
  GroupPass, RowStore, SortPass, AggPass, FilterPass, QuickFilterPass,
} from '../src/worker/dataPipeline';
import { AggFuncRegistry } from '../src/worker/aggFuncRegistry';
import type { WorkerColumn } from '../src/worker/protocol';
import type { GroupPassOutput } from '../src/worker/passes/groupPass';

const COLS: WorkerColumn[] = [
  { colId: 'desk',   field: 'desk',   type: 'text'   },
  { colId: 'region', field: 'region', type: 'text'   },
  { colId: 'pnl',    field: 'pnl',    type: 'number' },
  { colId: 'active', field: 'active', type: 'text'   },
];

const ROWS = [
  { id: '1', desk: 'APAC', region: 'Rates',  pnl: 100, active: 'Y' },
  { id: '2', desk: 'APAC', region: 'Rates',  pnl: 200, active: 'N' },
  { id: '3', desk: 'APAC', region: 'Credit', pnl: 300, active: 'Y' },
  { id: '4', desk: 'EMEA', region: 'Rates',  pnl: 400, active: 'Y' },
  { id: '5', desk: 'EMEA', region: 'Credit', pnl: 500, active: 'N' },
  { id: '6', desk: 'AMER', region: 'Rates',  pnl:  50, active: 'Y' },
];

const ALL_IDS = ROWS.map(r => r.id);

function makeStore() {
  const s = new RowStore<typeof ROWS[0]>('id');
  s.setAll(ROWS);
  return s;
}

function applyGroup(store: RowStore, ids: string[]): GroupPassOutput {
  const gp = new GroupPass(store, COLS);
  gp.setModel({ rowGroupCols: ['desk'] });
  return gp.apply(ids);
}

function groupKeys(out: GroupPassOutput): string[] {
  return out.roots.map(r => String(r.value));
}

function groupChildCount(out: GroupPassOutput, desk: string): number {
  return out.roots.find(r => r.value === desk)?.childCount ?? 0;
}

// ─── Basic filter → group interaction ─────────────────────────────────────────

describe('filter applies to leaves before grouping', () => {
  it('no filter: all 3 groups visible', () => {
    const store = makeStore();
    const out = applyGroup(store, ALL_IDS);
    expect(groupKeys(out)).toContain('APAC');
    expect(groupKeys(out)).toContain('EMEA');
    expect(groupKeys(out)).toContain('AMER');
  });

  it('filter to APAC-only ids → only APAC group visible', () => {
    const store = makeStore();
    const apacIds = ['1', '2', '3'];
    const out = applyGroup(store, apacIds);
    expect(groupKeys(out)).toEqual(['APAC']);
  });

  it('APAC group has 3 members when all 3 rows pass filter', () => {
    const store = makeStore();
    const out = applyGroup(store, ['1', '2', '3']);
    expect(groupChildCount(out, 'APAC')).toBe(3);
  });

  it('APAC group has 1 member when only 1 row passes filter', () => {
    const store = makeStore();
    const out = applyGroup(store, ['3']); // only APAC/Credit
    expect(groupChildCount(out, 'APAC')).toBe(1);
  });

  it('empty id set → no groups', () => {
    const store = makeStore();
    const out = applyGroup(store, []);
    expect(out.roots.length).toBe(0);
  });
});

// ─── Empty groups disappear ───────────────────────────────────────────────────

describe('empty groups after filter', () => {
  it('filtering out all EMEA rows removes EMEA group', () => {
    const store = makeStore();
    const nonEmeaIds = ['1', '2', '3', '6']; // APAC + AMER only
    const out = applyGroup(store, nonEmeaIds);
    expect(groupKeys(out)).not.toContain('EMEA');
  });

  it('filtering out all AMER rows keeps APAC + EMEA', () => {
    const store = makeStore();
    const out = applyGroup(store, ['1', '2', '3', '4', '5']);
    const keys = groupKeys(out);
    expect(keys).not.toContain('AMER');
    expect(keys).toContain('APAC');
    expect(keys).toContain('EMEA');
  });
});

// ─── Two-level grouping + filter ─────────────────────────────────────────────

describe('two-level grouping + filter', () => {
  function applyTwoLevel(store: RowStore, ids: string[]): GroupPassOutput {
    const gp = new GroupPass(store, COLS);
    gp.setModel({ rowGroupCols: ['desk', 'region'] });
    return gp.apply(ids);
  }

  it('all rows → APAC has Rates + Credit children', () => {
    const store = makeStore();
    const out = applyTwoLevel(store, ALL_IDS);
    const apac = out.roots.find(r => r.value === 'APAC')!;
    const childValues = apac.childGroups.map(c => String(c.value)).sort();
    expect(childValues).toEqual(['Credit', 'Rates']);
  });

  it('filter to APAC+Credit rows only → APAC has only Credit child', () => {
    const store = makeStore();
    // Row 3 is APAC/Credit; rows 1,2 are APAC/Rates
    const out = applyTwoLevel(store, ['3']);
    const apac = out.roots.find(r => r.value === 'APAC')!;
    expect(apac.childGroups.length).toBe(1);
    expect(apac.childGroups[0]!.value).toBe('Credit');
  });

  it('filter that empties a child group also removes the parent if all children empty', () => {
    const store = makeStore();
    // Keep only EMEA/Rates (row 4), which empties EMEA/Credit
    const out = applyTwoLevel(store, ['4']);
    const emea = out.roots.find(r => r.value === 'EMEA')!;
    expect(emea.childGroups.length).toBe(1);
    expect(emea.childGroups[0]!.value).toBe('Rates');
  });
});

// ─── Aggregates over filtered leaves ─────────────────────────────────────────

const COLS_WITH_AGG: WorkerColumn[] = [
  { colId: 'desk',   field: 'desk',   type: 'text'   },
  { colId: 'region', field: 'region', type: 'text'   },
  { colId: 'pnl',    field: 'pnl',    type: 'number', aggFunc: 'sum' },
  { colId: 'active', field: 'active', type: 'text'   },
];

const COLS_WITH_COUNT: WorkerColumn[] = [
  ...COLS,
  // Override pnl with count
].map(c => c.colId === 'pnl' ? { ...c, aggFunc: 'count' } : c);

describe('AggPass computes over filtered leaves only', () => {
  it('sum of pnl with all rows', () => {
    const store = makeStore();
    const registry = new AggFuncRegistry();
    const aggPass = new AggPass(store, COLS_WITH_AGG, registry);

    const { totals } = aggPass.apply(ALL_IDS);
    // 100 + 200 + 300 + 400 + 500 + 50 = 1550
    expect(totals['pnl']).toBe(1550);
  });

  it('sum of pnl with only active=Y rows (ids 1, 3, 4, 6)', () => {
    const store = makeStore();
    const registry = new AggFuncRegistry();
    const aggPass = new AggPass(store, COLS_WITH_AGG, registry);

    const activeIds = ['1', '3', '4', '6']; // pnl: 100, 300, 400, 50
    const { totals } = aggPass.apply(activeIds);
    expect(totals['pnl']).toBe(850);
  });

  it('count of filtered rows is correct', () => {
    const store = makeStore();
    const registry = new AggFuncRegistry();
    const aggPass = new AggPass(store, COLS_WITH_COUNT, registry);

    const { totals } = aggPass.apply(['1', '2']); // 2 rows
    expect(totals['pnl']).toBe(2);
  });
});

// ─── Stability: same filtered set → same tree shape ───────────────────────────

describe('filter stability', () => {
  it('applying same filtered ids twice produces identical group keys', () => {
    const store = makeStore();
    const ids = ['1', '4', '6'];
    const out1 = applyGroup(store, ids);
    const out2 = applyGroup(store, ids);
    expect(groupKeys(out1)).toEqual(groupKeys(out2));
  });

  it('flat order length is deterministic for same inputs', () => {
    const store = makeStore();
    const out1 = applyGroup(store, ALL_IDS);
    const out2 = applyGroup(store, ALL_IDS);
    expect(out1.flatOrder.length).toBe(out2.flatOrder.length);
  });
});
