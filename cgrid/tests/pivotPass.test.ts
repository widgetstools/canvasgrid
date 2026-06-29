// Cycle 18 / Task 2 — PivotPass tests.
//
// PivotPass runs after GroupPass and produces (a) the distinct pivot-key
// tree (for column synthesis) and (b) the cross-tab cell values for every
// (rowGroup × pivotKeyPath × valueColumn) intersection — at every pivot
// prefix (collapsed column groups) and every row-group level + grand total.

import { describe, it, expect } from 'vitest';
import { GroupPass, PivotPass, RowStore, getPivotValue } from '../src/worker/dataPipeline';
import { AggFuncRegistry } from '../src/worker/aggFuncRegistry';
import type { WorkerColumn } from '../src/worker/protocol';
import type { GroupPassOutput, PivotPassOutput } from '../src/worker/dataPipeline';

const COLS: WorkerColumn[] = [
  { colId: 'region',     field: 'region',     type: 'text'   },
  { colId: 'sector',     field: 'sector',     type: 'text'   },
  { colId: 'assetClass', field: 'assetClass', type: 'text'   },
  { colId: 'pnl',        field: 'pnl',        type: 'number' },
  { colId: 'qty',        field: 'qty',        type: 'number' },
];

const ROWS = [
  { id: '1', region: 'EMEA', sector: 'TECH', assetClass: 'Large', pnl: 100, qty: 10 },
  { id: '2', region: 'EMEA', sector: 'TECH', assetClass: 'Small', pnl: 200, qty: 20 },
  { id: '3', region: 'EMEA', sector: 'FIN',  assetClass: 'Large', pnl: 300, qty: 30 },
  { id: '4', region: 'APAC', sector: 'TECH', assetClass: 'Large', pnl: 400, qty: 40 },
  { id: '5', region: 'APAC', sector: 'FIN',  assetClass: 'Small', pnl: 500, qty: 50 },
];
const ALL_IDS = ROWS.map((r) => r.id);

function makeStore(rows = ROWS): RowStore {
  const s = new RowStore('id');
  s.setAll(rows);
  return s;
}

/** Build a GroupPass tree grouped by `rowGroupCols`, plus the PivotPass. */
function setup(rowGroupCols: string[], rows = ROWS): {
  store: RowStore;
  groupOutput: GroupPassOutput;
  pivot: PivotPass;
  ids: string[];
} {
  const store = makeStore(rows);
  const ids = rows.map((r) => r.id);
  const gp = new GroupPass(store, COLS);
  gp.setModel({ rowGroupCols });
  const groupOutput = gp.apply(ids);
  const pivot = new PivotPass(store, COLS, new AggFuncRegistry());
  return { store, groupOutput, pivot, ids };
}

describe('PivotPass — bypass', () => {
  it('bypassed when no pivot columns', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: [], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out = pivot.apply(ids, groupOutput);
    expect(out.bypassed).toBe(true);
    expect(out.keyTree).toEqual([]);
    expect(out.values.size).toBe(0);
  });

  it('bypassed when no value columns', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [] });
    const out = pivot.apply(ids, groupOutput);
    expect(out.bypassed).toBe(true);
  });
});

describe('PivotPass — distinct key tree', () => {
  it('single pivot column → flat sorted leaf paths', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out = pivot.apply(ids, groupOutput);
    expect(out.keyTree.map((n) => n.value)).toEqual(['FIN', 'TECH']); // alpha sorted
    expect(out.leafPaths).toEqual([['FIN'], ['TECH']]);
  });

  it('two pivot columns → nested tree + every leaf path', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector', 'assetClass'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out = pivot.apply(ids, groupOutput);
    // Roots = sectors; children = assetClasses present under each.
    expect(out.keyTree.map((n) => n.value)).toEqual(['FIN', 'TECH']);
    const fin = out.keyTree.find((n) => n.value === 'FIN')!;
    expect(fin.children.map((c) => c.value)).toEqual(['Large', 'Small']);
    expect(fin.children[0]!.path).toEqual(['FIN', 'Large']);
    // Leaf paths = every (sector, assetClass) combination present.
    expect(out.leafPaths).toEqual([
      ['FIN', 'Large'], ['FIN', 'Small'], ['TECH', 'Large'], ['TECH', 'Small'],
    ]);
  });

  it('numeric pivot values sort numerically, not lexically', () => {
    const rows = [
      { id: '1', region: 'X', sector: '2002', assetClass: 'a', pnl: 1, qty: 1 },
      { id: '2', region: 'X', sector: '2010', assetClass: 'a', pnl: 1, qty: 1 },
      { id: '3', region: 'X', sector: '2004', assetClass: 'a', pnl: 1, qty: 1 },
    ];
    const { pivot, groupOutput, ids } = setup(['region'], rows);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out = pivot.apply(ids, groupOutput);
    expect(out.keyTree.map((n) => n.value)).toEqual(['2002', '2004', '2010']);
  });

  it('null / undefined pivot values collapse to empty string', () => {
    const rows = [
      { id: '1', region: 'X', sector: null, assetClass: 'a', pnl: 5, qty: 1 },
      { id: '2', region: 'X', sector: 'TECH', assetClass: 'a', pnl: 7, qty: 1 },
    ];
    const { pivot, groupOutput, ids } = setup(['region'], rows);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out = pivot.apply(ids, groupOutput);
    expect(out.keyTree.map((n) => n.value)).toEqual(['', 'TECH']);
    expect(getPivotValue(out, '', [''], 'pnl')).toBe(5);
  });
});

describe('PivotPass — cross-tab cell values', () => {
  it('sum per (region × sector); grand total too', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out = pivot.apply(ids, groupOutput);

    // Grand total: TECH = 100+200+400 = 700, FIN = 300+500 = 800.
    expect(getPivotValue(out, '', ['TECH'], 'pnl')).toBe(700);
    expect(getPivotValue(out, '', ['FIN'], 'pnl')).toBe(800);

    // EMEA: TECH = 100+200 = 300, FIN = 300.
    expect(getPivotValue(out, 'region:EMEA', ['TECH'], 'pnl')).toBe(300);
    expect(getPivotValue(out, 'region:EMEA', ['FIN'], 'pnl')).toBe(300);

    // APAC: TECH = 400, FIN = 500.
    expect(getPivotValue(out, 'region:APAC', ['TECH'], 'pnl')).toBe(400);
    expect(getPivotValue(out, 'region:APAC', ['FIN'], 'pnl')).toBe(500);
  });

  it('empty intersection has no value (undefined)', () => {
    // APAC has no FIN+Large row; ['FIN','Large'] under APAC is empty.
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector', 'assetClass'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out = pivot.apply(ids, groupOutput);
    expect(getPivotValue(out, 'region:APAC', ['FIN', 'Large'], 'pnl')).toBeUndefined();
    expect(getPivotValue(out, 'region:APAC', ['FIN', 'Small'], 'pnl')).toBe(500);
  });

  it('collapsed pivot column group (prefix) holds the aggregate across children', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector', 'assetClass'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out = pivot.apply(ids, groupOutput);
    // EMEA, collapsed TECH group = Large(100) + Small(200) = 300.
    expect(getPivotValue(out, 'region:EMEA', ['TECH'], 'pnl')).toBe(300);
    // …and the expanded leaves.
    expect(getPivotValue(out, 'region:EMEA', ['TECH', 'Large'], 'pnl')).toBe(100);
    expect(getPivotValue(out, 'region:EMEA', ['TECH', 'Small'], 'pnl')).toBe(200);
  });

  it('multiple value columns each get their own cell', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({
      pivotColIds: ['sector'],
      valueCols: [{ colId: 'pnl', aggFunc: 'sum' }, { colId: 'qty', aggFunc: 'sum' }],
    });
    const out = pivot.apply(ids, groupOutput);
    expect(getPivotValue(out, 'region:EMEA', ['TECH'], 'pnl')).toBe(300);
    expect(getPivotValue(out, 'region:EMEA', ['TECH'], 'qty')).toBe(30); // 10+20
  });

  it('aggFuncs: avg / count / min / max', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({
      pivotColIds: ['sector'],
      valueCols: [{ colId: 'pnl', aggFunc: 'avg' }],
    });
    let out = pivot.apply(ids, groupOutput);
    expect(getPivotValue(out, 'region:EMEA', ['TECH'], 'pnl')).toBe(150); // (100+200)/2

    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'count' }] });
    out = pivot.apply(ids, groupOutput);
    expect(getPivotValue(out, 'region:EMEA', ['TECH'], 'pnl')).toBe(2);

    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'min' }] });
    out = pivot.apply(ids, groupOutput);
    expect(getPivotValue(out, 'region:EMEA', ['TECH'], 'pnl')).toBe(100);

    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'max' }] });
    out = pivot.apply(ids, groupOutput);
    expect(getPivotValue(out, 'region:EMEA', ['TECH'], 'pnl')).toBe(200);
  });
});

describe('PivotPass — no row grouping (grand total only)', () => {
  it('produces grand-total pivot cells when grouping is bypassed', () => {
    const { pivot, groupOutput, ids } = setup([]); // no row grouping
    expect(groupOutput.bypassed).toBe(true);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out = pivot.apply(ids, groupOutput);
    expect(out.bypassed).toBe(false);
    expect(getPivotValue(out, '', ['TECH'], 'pnl')).toBe(700);
    expect(getPivotValue(out, '', ['FIN'], 'pnl')).toBe(800);
  });
});

describe('PivotPass — setModel validation', () => {
  it('throws on unknown pivot column', () => {
    const { pivot } = setup(['region']);
    expect(() => pivot.setModel({ pivotColIds: ['nope'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] }))
      .toThrow(/not a known column/);
  });

  it('throws on unknown value column', () => {
    const { pivot } = setup(['region']);
    expect(() => pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'nope', aggFunc: 'sum' }] }))
      .toThrow(/not a known column/);
  });

  it('getModel returns a defensive copy', () => {
    const { pivot } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const m = pivot.getModel();
    m.pivotColIds.push('hacked');
    m.valueCols[0]!.aggFunc = 'max';
    expect(pivot.getModel().pivotColIds).toEqual(['sector']);
    expect(pivot.getModel().valueCols[0]!.aggFunc).toBe('sum');
  });
});

describe('PivotPass — pivotMaxGeneratedColumns cap (Task 8a)', () => {
  it('default cap (5000) does not engage for small key sets', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out = pivot.apply(ids, groupOutput);
    expect(out.bypassed).toBe(false);
    expect(out.maxColumnsReached).toBeUndefined();
    expect(out.leafPaths.length).toBe(2); // FIN + TECH
  });

  it('engages when leafPaths × valueCols exceeds the cap — returns bypassed output + maxColumnsReached payload', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({
      pivotColIds: ['sector'],
      valueCols: [{ colId: 'pnl', aggFunc: 'sum' }, { colId: 'qty', aggFunc: 'sum' }],
    });
    // 2 leaves × 2 value cols = 4. Cap at 3 forces the breach.
    pivot.setMaxGeneratedColumns(3);
    const out = pivot.apply(ids, groupOutput);
    expect(out.bypassed).toBe(true);
    expect(out.keyTree).toEqual([]);
    expect(out.leafPaths).toEqual([]);
    expect(out.values.size).toBe(0);
    expect(out.maxColumnsReached).toEqual({ generatedColumns: 4, cap: 3 });
  });

  it('does NOT engage when generated count exactly equals the cap (boundary)', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    // 2 leaves × 1 value col = 2. Cap at 2 → exactly at the limit, allowed.
    pivot.setMaxGeneratedColumns(2);
    const out = pivot.apply(ids, groupOutput);
    expect(out.bypassed).toBe(false);
    expect(out.maxColumnsReached).toBeUndefined();
    expect(out.leafPaths.length).toBe(2);
  });

  it('cap of zero disables synthesis (any non-empty pivot result trips the breach)', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    pivot.setMaxGeneratedColumns(0);
    const out = pivot.apply(ids, groupOutput);
    expect(out.bypassed).toBe(true);
    expect(out.maxColumnsReached).toEqual({ generatedColumns: 2, cap: 0 });
  });

  it('a negative or non-finite cap is treated as the default (5000) — guards a buggy app from accidentally bypassing pivot', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    pivot.setMaxGeneratedColumns(-1);
    const out1 = pivot.apply(ids, groupOutput);
    expect(out1.bypassed).toBe(false);
    pivot.setMaxGeneratedColumns(Number.NaN);
    const out2 = pivot.apply(ids, groupOutput);
    expect(out2.bypassed).toBe(false);
    pivot.setMaxGeneratedColumns(Infinity);
    const out3 = pivot.apply(ids, groupOutput);
    expect(out3.bypassed).toBe(false);
  });

  it('reverting the cap to default re-enables pivot synthesis on the next apply', () => {
    const { pivot, groupOutput, ids } = setup(['region']);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    pivot.setMaxGeneratedColumns(1);
    const tripped = pivot.apply(ids, groupOutput);
    expect(tripped.bypassed).toBe(true);
    pivot.setMaxGeneratedColumns(undefined);
    const restored = pivot.apply(ids, groupOutput);
    expect(restored.bypassed).toBe(false);
    expect(restored.maxColumnsReached).toBeUndefined();
  });
});

describe('PivotPass — scale correctness (100k rows, no wall-clock)', () => {
  it('aggregates a large deterministic set correctly', () => {
    const N = 100_000;
    const REGIONS = ['EMEA', 'APAC', 'AMER', 'LATAM'];
    const SECTORS = ['TECH', 'FIN', 'ENERGY'];
    const rows: Array<Record<string, unknown>> = [];
    // Deterministic: pnl = 1 for every row, so a bucket's sum == its row count.
    for (let i = 0; i < N; i++) {
      rows.push({
        id: `R${i}`,
        region: REGIONS[i % REGIONS.length],
        sector: SECTORS[i % SECTORS.length],
        assetClass: 'x',
        pnl: 1,
        qty: 1,
      });
    }
    const { pivot, groupOutput, ids } = setup(['region'], rows as never);
    pivot.setModel({ pivotColIds: ['sector'], valueCols: [{ colId: 'pnl', aggFunc: 'sum' }] });
    const out: PivotPassOutput = pivot.apply(ids, groupOutput);

    // Distinct keys discovered exactly once → 3 sectors.
    expect(out.keyTree.map((n) => n.value).sort()).toEqual(['ENERGY', 'FIN', 'TECH']);

    // Grand total per sector = count of rows with that sector.
    // i % 3 cycles TECH(0), FIN(1), ENERGY(2): each ~ N/3.
    const techCount = Math.floor(N / 3) + (N % 3 > 0 ? 1 : 0); // i=0,3,6,...
    expect(getPivotValue(out, '', ['TECH'], 'pnl')).toBe(techCount);

    // Cross-check: the four region cells for a sector sum to the grand total.
    const regionKeys = REGIONS.map((r) => `region:${r}`);
    const techAcrossRegions = regionKeys.reduce(
      (acc, k) => acc + ((getPivotValue(out, k, ['TECH'], 'pnl') as number) ?? 0), 0,
    );
    expect(techAcrossRegions).toBe(techCount);
  });
});
