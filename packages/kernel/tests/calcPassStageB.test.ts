// Cycle 21d / Task 12 — CalcPass Stage B: scoped aggregate scalars + the
// delta cache. Mirrors calcPassStageA.test.ts's fixture style: build a
// `RowStore` + `GroupPass` directly for the store/pass-level cases; the
// worker-host harness case (Step 6) lands at the bottom.
//
// Scope-key semantics mirror packages/calc/src/scopeKey.ts's
// `scopeKeyOf` / `DataVersionMap` — reimplemented natively here per the
// coordinator decision (no SCOPE_KEY_SOURCE/DATA_VERSION_MAP_SOURCE
// shipping; zero runtime @wellsfargo-starui/velocity-grid/calc imports in the kernel).

import { describe, it, expect } from 'vitest';
import { RowStore } from '../src/worker/dataPipeline';
import { GroupPass } from '../src/worker/passes/groupPass';
import { CalcProgramStore } from '../src/worker/passes/calcPass';
import { createWorkerHost } from '../src/worker/worker';
import type {
  WorkerColumn, WorkerCalcProgram, WorkerRequest, WorkerResponse, WorkerPush,
} from '../src/worker/protocol';

interface Row { id: string; pnl: number; desk: string }

function fixtureStore(): RowStore<Row> {
  const store = new RowStore<Row>('id');
  store.setAll([
    { id: '1', pnl: 10, desk: 'A' },
    { id: '2', pnl: 20, desk: 'A' },
    { id: '3', pnl: 100, desk: 'B' },
    { id: '4', pnl: 200, desk: 'B' },
  ]);
  return store;
}

const fieldOf = (colId: string): string | undefined => {
  if (colId === 'pnl') return 'pnl';
  if (colId === 'desk') return 'desk';
  return undefined;
};

/** `sum` aggregate factory source — the Task 5 delta-contract shape. */
const SUM_FACTORY = `(function sumFactory() {
  return {
    init() { return 0; },
    addRow(state, value) { return state + (typeof value === 'number' ? value : 0); },
    removeRow(state, value) { return state - (typeof value === 'number' ? value : 0); },
    updateRow(state, oldValue, newValue) {
      return state - (typeof oldValue === 'number' ? oldValue : 0) + (typeof newValue === 'number' ? newValue : 0);
    },
    finalize(state) { return state; },
  };
})`;

/** Counting factory — stamps an instance id on `init` (mirroring case 6's
 *  "probe: a factory whose init stamps an instance id" requirement) and
 *  counts addRow calls into `state.count`, mirrored into `finalize`. */
function countingFactorySource(): string {
  return `(function countingFactory() {
    let nextInstanceId = 1;
    return {
      init() { return { instanceId: nextInstanceId++, count: 0 }; },
      addRow(state, value) { state.count += 1; return state; },
      removeRow(state, value) { state.count -= 1; return state; },
      updateRow(state, oldValue, newValue) { return state; },
      finalize(state) { return state.count; },
    };
  })`;
}

/** PCT_OF_GROUP-shape interpreter: `row[ast.name] / aggSlots[0] * 100`. */
const PCT_INTERP = `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
  if (ast === null) return null;
  if (ast.kind === 'field') {
    const denom = aggSlots[0];
    if (denom === null || denom === undefined || denom === 0) return null;
    return row[ast.name] / denom * 100;
  }
  return null;
})`;

function pctProgram(scopeKind: string, overrides: Partial<WorkerCalcProgram['columns'][number]> = {}): WorkerCalcProgram {
  return {
    columns: [
      {
        colId: 'pctOfGroup',
        ast: { kind: 'field', name: 'pnl' },
        prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: scopeKind } }],
        cellDataType: 'number',
        usesPrev: false,
        ...overrides,
      },
    ],
    interpreterSource: PCT_INTERP,
    aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
  };
}

/** Groups fixtureStore by `desk` (2 groups: A, B), all 4 rows visible. */
function groupedByDesk(store: RowStore<Row>, ids: string[]): { group: GroupPass<Row>; out: ReturnType<GroupPass<Row>['apply']> } {
  const cols: WorkerColumn[] = [
    { colId: 'pnl', field: 'pnl', type: 'number' },
    { colId: 'desk', field: 'desk', type: 'text' },
  ];
  const group = new GroupPass<Row>(store, cols);
  group.setModel({ rowGroupCols: ['desk'] });
  const out = group.apply(ids);
  return { group, out };
}

const NO_GROUP: ReturnType<GroupPass['apply']> = { roots: [], flatOrder: [], bypassed: true };

describe('CalcPass Stage B — two-pass per group (case 1)', () => {
  it('each row value = pnl / groupSum * 100, using ITS group sum', () => {
    const store = fixtureStore();
    const { out } = groupedByDesk(store, ['1', '2', '3', '4']);
    const calc = new CalcProgramStore();
    calc.install(pctProgram('group'));
    calc.ensureStageB(store, out, ['1', '2', '3', '4'], fieldOf);

    // Desk A: sum = 30 → 1: 10/30*100=33.33..., 2: 20/30*100=66.66...
    // Desk B: sum = 300 → 3: 100/300*100=33.33..., 4: 200/300*100=66.66...
    expect(calc.valueAt('1', 'pctOfGroup')).toBeCloseTo((10 / 30) * 100);
    expect(calc.valueAt('2', 'pctOfGroup')).toBeCloseTo((20 / 30) * 100);
    expect(calc.valueAt('3', 'pctOfGroup')).toBeCloseTo((100 / 300) * 100);
    expect(calc.valueAt('4', 'pctOfGroup')).toBeCloseTo((200 / 300) * 100);
  });
});

describe("CalcPass Stage B — scope 'all' vs 'visible' (case 2)", () => {
  it("'all' uses the UNFILTERED store; 'visible' uses the post-filter set (grouping bypassed)", () => {
    const store = fixtureStore();
    const postFilterIds = ['1', '2', '3']; // row '4' filtered out

    const calcAll = new CalcProgramStore();
    calcAll.install(pctProgram('all'));
    calcAll.ensureStageB(store, NO_GROUP, postFilterIds, fieldOf);
    // all sum = 10+20+100+200 = 330
    expect(calcAll.valueAt('1', 'pctOfGroup')).toBeCloseTo((10 / 330) * 100);

    const calcVisible = new CalcProgramStore();
    calcVisible.install(pctProgram('visible'));
    calcVisible.ensureStageB(store, NO_GROUP, postFilterIds, fieldOf);
    // visible sum = 10+20+100 = 130 (row 4 excluded, grouping bypassed)
    expect(calcVisible.valueAt('1', 'pctOfGroup')).toBeCloseTo((10 / 130) * 100);
    // row 4 is not in the visible set — no computed value.
    expect(calcVisible.valueAt('4', 'pctOfGroup')).toBeUndefined();
  });
});

describe('CalcPass Stage B — promotion visible→group (case 3, spec Q4)', () => {
  it("scope: {kind:'visible'} with grouping ACTIVE promotes to per-row GROUP scalars, identical to case 1", () => {
    const store = fixtureStore();
    const { out } = groupedByDesk(store, ['1', '2', '3', '4']);
    const calc = new CalcProgramStore();
    calc.install(pctProgram('visible'));
    calc.ensureStageB(store, out, ['1', '2', '3', '4'], fieldOf);

    expect(calc.valueAt('1', 'pctOfGroup')).toBeCloseTo((10 / 30) * 100);
    expect(calc.valueAt('2', 'pctOfGroup')).toBeCloseTo((20 / 30) * 100);
    expect(calc.valueAt('3', 'pctOfGroup')).toBeCloseTo((100 / 300) * 100);
    expect(calc.valueAt('4', 'pctOfGroup')).toBeCloseTo((200 / 300) * 100);
  });
});

describe('CalcPass Stage B — parent scope (case 4)', () => {
  it('leaf-group rows read the PARENT group scalar; top-level groups parent = the visible set', () => {
    // 2-level tree: region -> desk. Region EMEA has desks A, B; region
    // APAC has desk C.
    interface Row2 { id: string; pnl: number; region: string; desk: string }
    const store2 = new RowStore<Row2>('id');
    store2.setAll([
      { id: '1', pnl: 10, region: 'EMEA', desk: 'A' },
      { id: '2', pnl: 20, region: 'EMEA', desk: 'B' },
      { id: '3', pnl: 100, region: 'APAC', desk: 'C' },
      { id: '4', pnl: 200, region: 'APAC', desk: 'C' },
    ]);
    const cols: WorkerColumn[] = [
      { colId: 'pnl', field: 'pnl', type: 'number' },
      { colId: 'region', field: 'region', type: 'text' },
      { colId: 'desk', field: 'desk', type: 'text' },
    ];
    const group = new GroupPass<Row2>(store2, cols);
    group.setModel({ rowGroupCols: ['region', 'desk'] });
    const ids = ['1', '2', '3', '4'];
    const out = group.apply(ids);

    const fieldOf2 = (colId: string): string | undefined => {
      if (colId === 'pnl') return 'pnl';
      if (colId === 'region') return 'region';
      if (colId === 'desk') return 'desk';
      return undefined;
    };
    const calc = new CalcProgramStore();
    calc.install(pctProgram('parent'));
    calc.ensureStageB(store2, out, ids, fieldOf2);

    // Leaf groups (desk level) — parent is the region group.
    // EMEA region sum = 10 + 20 = 30. desk A (row1) and desk B (row2) both
    // read the EMEA region's sum as their parent scalar.
    expect(calc.valueAt('1', 'pctOfGroup')).toBeCloseTo((10 / 30) * 100);
    expect(calc.valueAt('2', 'pctOfGroup')).toBeCloseTo((20 / 30) * 100);
    // APAC region sum = 100 + 200 = 300. desk C (rows 3,4) read APAC's sum.
    expect(calc.valueAt('3', 'pctOfGroup')).toBeCloseTo((100 / 300) * 100);
    expect(calc.valueAt('4', 'pctOfGroup')).toBeCloseTo((200 / 300) * 100);
  });
});

describe('CalcPass Stage B — regroup invalidates (case 5)', () => {
  it('changing the group model rebuilds states wholesale (counting factory)', () => {
    const store = fixtureStore();
    const cols: WorkerColumn[] = [
      { colId: 'pnl', field: 'pnl', type: 'number' },
      { colId: 'desk', field: 'desk', type: 'text' },
    ];
    const countingProgram: WorkerCalcProgram = {
      columns: [
        {
          colId: 'cnt',
          ast: { kind: 'field', name: 'pnl' },
          prePass: [{ slot: 0, fn: 'counting', colId: 'pnl', scope: { kind: 'group' } }],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      interpreterSource: `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) { return aggSlots[0]; })`,
      aggregateSources: [{ name: 'counting', source: countingFactorySource() }],
    };

    const group = new GroupPass<Row>(store, cols);
    group.setModel({ rowGroupCols: ['desk'] });
    const ids = ['1', '2', '3', '4'];
    let out = group.apply(ids);

    const calc = new CalcProgramStore();
    calc.install(countingProgram);
    calc.ensureStageB(store, out, ids, fieldOf);
    // Desk A group has 2 rows, desk B group has 2 rows.
    expect(calc.valueAt('1', 'cnt')).toBe(2);
    expect(calc.valueAt('3', 'cnt')).toBe(2);

    // Regroup: use pnl-bucket-style grouping instead (a different column
    // set → different group signature → cause flag not 'delta').
    interface Row3 { id: string; pnl: number; desk: string; bucket: string }
    // Add a distinguishing field via update so a NEW column set can group
    // on it — simplest: regroup on 'pnl' itself as a text-coerced bucket
    // isn't available, so instead change rowGroupCols to empty (bypass)
    // then back to a different partition via desk alone is the same
    // signature. Use a synthetic second grouping column instead.
    const cols2: WorkerColumn[] = [
      { colId: 'pnl', field: 'pnl', type: 'number' },
      { colId: 'desk', field: 'desk', type: 'text' },
      { colId: 'id', field: 'id', type: 'text' },
    ];
    const group2 = new GroupPass<Row>(store, cols2);
    group2.setModel({ rowGroupCols: ['id'] }); // every row its own group — different signature
    out = group2.apply(ids);
    calc.ensureStageB(store, out, ids, fieldOf);
    // Each new group has exactly 1 row — old cached group states must NOT
    // leak (would show 2 if the cache were reused).
    expect(calc.valueAt('1', 'cnt')).toBe(1);
    expect(calc.valueAt('2', 'cnt')).toBe(1);
    expect(calc.valueAt('3', 'cnt')).toBe(1);
    expect(calc.valueAt('4', 'cnt')).toBe(1);
  });
});

describe('CalcPass Stage B — tick delta updates one group, not siblings (case 6)', () => {
  it('an updateRow transaction on group A does not touch group B state identity or value', () => {
    const store = fixtureStore();
    const { out } = groupedByDesk(store, ['1', '2', '3', '4']);
    const calc = new CalcProgramStore();
    calc.install(pctProgram('group'));
    calc.ensureStageB(store, out, ['1', '2', '3', '4'], fieldOf);

    const beforeB3 = calc.valueAt('3', 'pctOfGroup');
    const beforeB4 = calc.valueAt('4', 'pctOfGroup');

    // Update row '1' (desk A) — pnl 10 → 15.
    const newRow1 = { id: '1', pnl: 15, desk: 'A' };
    calc.capturePrevForUpdates(store, [newRow1]);
    const results = store.apply({ update: [newRow1] });
    calc.onTransaction(results);
    // Regroup output for the (unchanged) grouping — grouping membership is
    // unaffected by a pnl-only update, so re-apply the same GroupPass.
    const { group: group2 } = groupedByDesk(store, ['1', '2', '3', '4']);
    const out2 = group2.apply(['1', '2', '3', '4']);
    calc.ensureStageB(store, out2, ['1', '2', '3', '4'], fieldOf);

    // Desk A sum now 15+20=35 → row1 = 15/35*100, row2 = 20/35*100.
    expect(calc.valueAt('1', 'pctOfGroup')).toBeCloseTo((15 / 35) * 100);
    expect(calc.valueAt('2', 'pctOfGroup')).toBeCloseTo((20 / 35) * 100);
    // Desk B (group B) untouched — same finalized scalars as before.
    expect(calc.valueAt('3', 'pctOfGroup')).toBe(beforeB3);
    expect(calc.valueAt('4', 'pctOfGroup')).toBe(beforeB4);
  });

  it('probe: factory init stamps an instance id — group B state identity survives an unrelated delta', () => {
    const store = fixtureStore();
    const cols: WorkerColumn[] = [
      { colId: 'pnl', field: 'pnl', type: 'number' },
      { colId: 'desk', field: 'desk', type: 'text' },
    ];
    const group = new GroupPass<Row>(store, cols);
    group.setModel({ rowGroupCols: ['desk'] });
    const ids = ['1', '2', '3', '4'];
    const out = group.apply(ids);

    const instanceIdProgram: WorkerCalcProgram = {
      columns: [
        {
          colId: 'iid',
          ast: { kind: 'field', name: 'pnl' },
          prePass: [{ slot: 0, fn: 'counting', colId: 'pnl', scope: { kind: 'group' } }],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      // Expose the instance id itself as the computed value so the test
      // can assert identity survival via the scalar.
      interpreterSource: `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) { return aggSlots[0]; })`,
      aggregateSources: [{
        name: 'counting',
        source: `(function countingFactory() {
          let nextInstanceId = 1;
          return {
            init() { return { instanceId: nextInstanceId++ }; },
            addRow(state, value) { return state; },
            removeRow(state, value) { return state; },
            updateRow(state, oldValue, newValue) { return state; },
            finalize(state) { return state.instanceId; },
          };
        })`,
      }],
    };

    const calc = new CalcProgramStore();
    calc.install(instanceIdProgram);
    calc.ensureStageB(store, out, ids, fieldOf);
    const groupBInstanceIdBefore = calc.valueAt('3', 'iid');

    const newRow1 = { id: '1', pnl: 15, desk: 'A' };
    calc.capturePrevForUpdates(store, [newRow1]);
    const results = store.apply({ update: [newRow1] });
    calc.onTransaction(results);
    calc.ensureStageB(store, out, ids, fieldOf); // SAME groupOutput — cause 'delta'

    const groupBInstanceIdAfter = calc.valueAt('3', 'iid');
    expect(groupBInstanceIdAfter).toBe(groupBInstanceIdBefore);
  });
});

describe('CalcPass Stage B — row moves between groups (case 7)', () => {
  it("update changes the row's group-key field: removeRow on old scope + addRow on new scope", () => {
    const store = fixtureStore();
    const cols: WorkerColumn[] = [
      { colId: 'pnl', field: 'pnl', type: 'number' },
      { colId: 'desk', field: 'desk', type: 'text' },
    ];
    const group = new GroupPass<Row>(store, cols);
    group.setModel({ rowGroupCols: ['desk'] });
    const ids = ['1', '2', '3', '4'];
    let out = group.apply(ids);

    const calc = new CalcProgramStore();
    calc.install(pctProgram('group'));
    calc.ensureStageB(store, out, ids, fieldOf);

    expect(calc.valueAt('1', 'pctOfGroup')).toBeCloseTo((10 / 30) * 100);
    expect(calc.valueAt('3', 'pctOfGroup')).toBeCloseTo((100 / 300) * 100);

    // Move row '1' from desk A to desk B.
    const movedRow1 = { id: '1', pnl: 10, desk: 'B' };
    calc.capturePrevForUpdates(store, [movedRow1]);
    const results = store.apply({ update: [movedRow1] });
    calc.onTransaction(results);
    // Regroup — membership changed, so GroupPass output must be rebuilt.
    out = group.apply(ids);
    calc.ensureStageB(store, out, ids, fieldOf);

    // Desk A now just row 2 → sum 20 → row2 = 100%.
    expect(calc.valueAt('2', 'pctOfGroup')).toBeCloseTo(100);
    // Desk B now rows 1,3,4 → sum 10+100+200=310.
    expect(calc.valueAt('1', 'pctOfGroup')).toBeCloseTo((10 / 310) * 100);
    expect(calc.valueAt('3', 'pctOfGroup')).toBeCloseTo((100 / 310) * 100);
    expect(calc.valueAt('4', 'pctOfGroup')).toBeCloseTo((200 / 310) * 100);
  });
});

// Task 4 — `oldGroupKeyFor` (calcPass.ts) independently mirrors GroupPass's
// bucket-key construction to resolve the OLD scope of a moved/updated row.
// It MUST escape segments identically to the real GroupPass keys stored in
// `rowScopeKey`/`parentOfGroup` — a value containing the key's own `::`
// separator must not desync the two, or the old-scope `removeRow` silently
// targets the wrong (or a nonexistent) scope, leaking stale state into the
// group the row left.
describe("CalcPass Stage B — row moves between groups with a separator-bearing value (Task 4 regression)", () => {
  it("desk value containing '::' round-trips through oldGroupKeyFor so the OLD group's scalar updates correctly on a cross-group move", () => {
    const store = new RowStore<Row>('id');
    store.setAll([
      { id: '1', pnl: 10, desk: 'A::weird' },
      { id: '2', pnl: 20, desk: 'A::weird' },
      { id: '3', pnl: 100, desk: 'B' },
      { id: '4', pnl: 200, desk: 'B' },
    ]);
    const cols: WorkerColumn[] = [
      { colId: 'pnl', field: 'pnl', type: 'number' },
      { colId: 'desk', field: 'desk', type: 'text' },
    ];
    const group = new GroupPass<Row>(store, cols);
    group.setModel({ rowGroupCols: ['desk'] });
    const ids = ['1', '2', '3', '4'];
    let out = group.apply(ids);

    const calc = new CalcProgramStore();
    calc.install(pctProgram('group'));
    calc.ensureStageB(store, out, ids, fieldOf);

    expect(calc.valueAt('1', 'pctOfGroup')).toBeCloseTo((10 / 30) * 100);
    expect(calc.valueAt('3', 'pctOfGroup')).toBeCloseTo((100 / 300) * 100);

    // Move row '1' OUT of the "::"-bearing group into desk B.
    const movedRow1 = { id: '1', pnl: 10, desk: 'B' };
    calc.capturePrevForUpdates(store, [movedRow1]);
    const results = store.apply({ update: [movedRow1] });
    calc.onTransaction(results);
    out = group.apply(ids);
    calc.ensureStageB(store, out, ids, fieldOf);

    // Desk "A::weird" now just row 2 → sum 20 → row2 = 100%. If
    // `oldGroupKeyFor` mis-escaped (or failed to escape) the old key, the
    // removeRow against the old group scope silently no-ops (key mismatch)
    // and row2 would still read the stale 20/30 = 66.6%.
    expect(calc.valueAt('2', 'pctOfGroup')).toBeCloseTo(100);
    // Desk B now rows 1,3,4 → sum 10+100+200=310.
    expect(calc.valueAt('1', 'pctOfGroup')).toBeCloseTo((10 / 310) * 100);
    expect(calc.valueAt('3', 'pctOfGroup')).toBeCloseTo((100 / 310) * 100);
    expect(calc.valueAt('4', 'pctOfGroup')).toBeCloseTo((200 / 310) * 100);
  });
});

describe('CalcPass Stage B — cache hit across untouched scopes (case 8)', () => {
  it('an unrelated delta leaves an untouched group scope`s instance identity unchanged (instance-id probe)', () => {
    const store = fixtureStore();
    const cols: WorkerColumn[] = [
      { colId: 'pnl', field: 'pnl', type: 'number' },
      { colId: 'desk', field: 'desk', type: 'text' },
    ];
    const group = new GroupPass<Row>(store, cols);
    group.setModel({ rowGroupCols: ['desk'] });
    const ids = ['1', '2', '3', '4'];
    const out = group.apply(ids);

    const instanceIdProgram: WorkerCalcProgram = {
      columns: [
        {
          colId: 'iid',
          ast: { kind: 'field', name: 'pnl' },
          prePass: [{ slot: 0, fn: 'counting', colId: 'pnl', scope: { kind: 'group' } }],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      interpreterSource: `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) { return aggSlots[0]; })`,
      aggregateSources: [{
        name: 'counting',
        source: `(function countingFactory() {
          let nextInstanceId = 1;
          return {
            init() { return { instanceId: nextInstanceId++ }; },
            addRow(state, value) { return state; },
            removeRow(state, value) { return state; },
            updateRow(state, oldValue, newValue) { return state; },
            finalize(state) { return state.instanceId; },
          };
        })`,
      }],
    };
    const calc = new CalcProgramStore();
    calc.install(instanceIdProgram);
    calc.ensureStageB(store, out, ids, fieldOf);
    const idBefore = calc.valueAt('3', 'iid'); // desk B group

    // Second ensureStageB pass with NO transaction in between ('full'
    // cause, since no onTransaction happened) still recognises no rows
    // changed... but per spec, non-'delta' causes wholesale-clear. To
    // probe a TRUE cache hit we simulate a delta tick that touches only
    // desk A (row 1 update) and confirm desk B's instance id is stable.
    const newRow1 = { id: '1', pnl: 11, desk: 'A' };
    calc.capturePrevForUpdates(store, [newRow1]);
    const results = store.apply({ update: [newRow1] });
    calc.onTransaction(results);
    calc.ensureStageB(store, out, ids, fieldOf);
    const idAfter = calc.valueAt('3', 'iid');
    expect(idAfter).toBe(idBefore);
  });
});

describe('CalcPass Stage B — one-frame settle (case 9)', () => {
  it('FilterPass reading valueAt BEFORE ensureStageB ran this pass sees the PREVIOUS pass value; no reentrant recompute', () => {
    const store = fixtureStore();
    let evalCount = 0;
    const program: WorkerCalcProgram = {
      columns: [
        {
          colId: 'pctOfGroup',
          ast: { kind: 'field', name: 'pnl' },
          prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'all' } }],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      interpreterSource: PCT_INTERP,
      aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
    };
    const calc = new CalcProgramStore();
    calc.install(program);

    // Pass 1 — before ensureStageB has run at all: valueAt returns
    // undefined (no rows computed yet).
    expect(calc.valueAt('1', 'pctOfGroup')).toBeUndefined();

    // ensureStageB runs once (pass 1's compute).
    calc.ensureStageB(store, NO_GROUP, ['1', '2', '3', '4'], fieldOf);
    const afterPass1 = calc.valueAt('1', 'pctOfGroup');
    expect(afterPass1).toBeCloseTo((10 / 330) * 100);

    // Pass 2 — re-run with the SAME (unchanged) inputs. Cause is 'full'
    // (no onTransaction called), so states rebuild, but the FINAL value
    // should settle to the same scalar (idempotent on unchanged input).
    calc.ensureStageB(store, NO_GROUP, ['1', '2', '3', '4'], fieldOf);
    expect(calc.valueAt('1', 'pctOfGroup')).toBeCloseTo(afterPass1 as number);
  });
});

// ─── FIRST/LAST (assembler addition: Stage-B-computed, NO registry factory) ──

interface NullableRow { id: string; pnl: number | null; desk: string }

const nullableFieldOf = (colId: string): string | undefined => {
  if (colId === 'pnl') return 'pnl';
  if (colId === 'desk') return 'desk';
  return undefined;
};

/** Two-column FIRST/LAST program. CRITICAL contract under test:
 *  `aggregateSources` deliberately does NOT contain 'FIRST'/'LAST' —
 *  they are NOT delta-contract registry impls (the registry has no entry
 *  for them); Stage B computes them directly via an order-aware scan. */
function firstLastProgram(scopeKind: string): WorkerCalcProgram {
  return {
    columns: [
      {
        colId: 'firstPnl',
        ast: { kind: 'slot' },
        prePass: [{ slot: 0, fn: 'FIRST', colId: 'pnl', scope: { kind: scopeKind } }],
        cellDataType: 'number',
        usesPrev: false,
      },
      {
        colId: 'lastPnl',
        ast: { kind: 'slot' },
        prePass: [{ slot: 0, fn: 'LAST', colId: 'pnl', scope: { kind: scopeKind } }],
        cellDataType: 'number',
        usesPrev: false,
      },
    ],
    interpreterSource: `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
      if (ast === null) return null;
      return aggSlots[0];
    })`,
    aggregateSources: [], // NO factory for FIRST/LAST — by design
  };
}

describe('CalcPass Stage B — FIRST/LAST (no registry factory; assembler addition)', () => {
  it("per scope 'all' incl. null-skipping: first/last NON-NULL value in store insertion order", () => {
    const store = new RowStore<NullableRow>('id');
    store.setAll([
      { id: '1', pnl: null, desk: 'A' }, // null head — skipped
      { id: '2', pnl: 20, desk: 'A' },
      { id: '3', pnl: 30, desk: 'B' },
      { id: '4', pnl: null, desk: 'B' }, // null tail — skipped by LAST
    ]);
    const calc = new CalcProgramStore();
    calc.install(firstLastProgram('all'));
    calc.ensureStageB(store, NO_GROUP, ['1', '2', '3', '4'], nullableFieldOf);
    expect(calc.valueAt('1', 'firstPnl')).toBe(20); // first NON-NULL
    expect(calc.valueAt('1', 'lastPnl')).toBe(30);  // last NON-NULL
  });

  it("per scope 'visible': post-filter order, null-skipping", () => {
    const store = new RowStore<NullableRow>('id');
    store.setAll([
      { id: '1', pnl: 10, desk: 'A' },
      { id: '2', pnl: null, desk: 'A' },
      { id: '3', pnl: 30, desk: 'B' },
    ]);
    const calc = new CalcProgramStore();
    calc.install(firstLastProgram('visible'));
    // Filter removed row '1' — visible order starts at the null row '2'.
    calc.ensureStageB(store, NO_GROUP, ['2', '3'], nullableFieldOf);
    expect(calc.valueAt('2', 'firstPnl')).toBe(30); // '2' is null → skipped
    expect(calc.valueAt('2', 'lastPnl')).toBe(30);
  });

  it("per scope 'group': group-bucket order, null-skipping, per-group scalars", () => {
    const store = new RowStore<NullableRow>('id');
    store.setAll([
      { id: '1', pnl: null, desk: 'A' },
      { id: '2', pnl: 20, desk: 'A' },
      { id: '3', pnl: 100, desk: 'B' },
      { id: '4', pnl: 200, desk: 'B' },
    ]);
    const cols: WorkerColumn[] = [
      { colId: 'pnl', field: 'pnl', type: 'number' },
      { colId: 'desk', field: 'desk', type: 'text' },
    ];
    const group = new GroupPass<NullableRow>(store, cols);
    group.setModel({ rowGroupCols: ['desk'] });
    const ids = ['1', '2', '3', '4'];
    const out = group.apply(ids);

    const calc = new CalcProgramStore();
    calc.install(firstLastProgram('group'));
    calc.ensureStageB(store, out, ids, nullableFieldOf);
    // Group A: FIRST skips row 1's null → 20; LAST → 20.
    expect(calc.valueAt('1', 'firstPnl')).toBe(20);
    expect(calc.valueAt('2', 'lastPnl')).toBe(20);
    // Group B: FIRST → 100, LAST → 200.
    expect(calc.valueAt('3', 'firstPnl')).toBe(100);
    expect(calc.valueAt('4', 'lastPnl')).toBe(200);
  });

  it('tick update changing the head row value → recompute observed (delta path)', () => {
    const store = new RowStore<NullableRow>('id');
    store.setAll([
      { id: '1', pnl: 10, desk: 'A' },
      { id: '2', pnl: 20, desk: 'A' },
    ]);
    const calc = new CalcProgramStore();
    calc.install(firstLastProgram('all'));
    calc.ensureStageB(store, NO_GROUP, ['1', '2'], nullableFieldOf);
    expect(calc.valueAt('1', 'firstPnl')).toBe(10);

    const newRow1 = { id: '1', pnl: 99, desk: 'A' };
    calc.capturePrevForUpdates(store, [newRow1]);
    const results = store.apply({ update: [newRow1] });
    calc.onTransaction(results);
    calc.ensureStageB(store, NO_GROUP, ['1', '2'], nullableFieldOf);
    // The head row's value changed — FIRST must be RECOMPUTED (O(scope)
    // rescan on version bump; no stale cached scalar).
    expect(calc.valueAt('1', 'firstPnl')).toBe(99);
    expect(calc.valueAt('2', 'firstPnl')).toBe(99);
  });

  it('row removed at head → FIRST becomes the next non-null value (delta path)', () => {
    const store = new RowStore<NullableRow>('id');
    store.setAll([
      { id: '1', pnl: 10, desk: 'A' },
      { id: '2', pnl: 20, desk: 'A' },
      { id: '3', pnl: 30, desk: 'A' },
    ]);
    const calc = new CalcProgramStore();
    calc.install(firstLastProgram('visible'));
    calc.ensureStageB(store, NO_GROUP, ['1', '2', '3'], nullableFieldOf);
    expect(calc.valueAt('1', 'firstPnl')).toBe(10);

    const results = store.apply({ remove: ['1'] });
    calc.onTransaction(results);
    calc.ensureStageB(store, NO_GROUP, ['2', '3'], nullableFieldOf);
    expect(calc.valueAt('2', 'firstPnl')).toBe(20); // head removed → next
    expect(calc.valueAt('3', 'lastPnl')).toBe(30);
  });

  it('regression: mixed program (SUM + FIRST) whose aggregateSources contains ONLY sum installs + evaluates without throwing', () => {
    const store = fixtureStore(); // pnl: 10, 20, 100, 200
    const program: WorkerCalcProgram = {
      columns: [
        {
          colId: 'mixed',
          ast: { kind: 'mixed' },
          prePass: [
            { slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'all' } },
            { slot: 1, fn: 'FIRST', colId: 'pnl', scope: { kind: 'all' } },
          ],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      interpreterSource: `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
        if (ast === null) return null;
        return aggSlots[0] * 1000 + aggSlots[1];
      })`,
      aggregateSources: [{ name: 'sum', source: SUM_FACTORY }], // no 'FIRST' entry — by design
    };
    const calc = new CalcProgramStore();
    calc.install(program);
    expect(() => calc.ensureStageB(store, NO_GROUP, ['1', '2', '3', '4'], fieldOf)).not.toThrow();
    // sum(all) = 330, FIRST(all) = 10 → 330 * 1000 + 10.
    expect(calc.valueAt('1', 'mixed')).toBe(330 * 1000 + 10);
  });
});

// ─── Worker-level integration (Step 6) ──────────────────────────────────────

function makeHost() {
  const outbox: (WorkerResponse | WorkerPush)[] = [];
  const host = createWorkerHost((msg) => outbox.push(msg));
  return { host, outbox };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('worker host — CalcPass Stage B end-to-end', () => {
  it('grouped grid + PCT_OF_GROUP program: getViewport chunk numericCols per-row values correct per group', async () => {
    const { host, outbox } = makeHost();
    host.handle({
      id: 1,
      type: 'init',
      payload: {
        columns: [
          { colId: 'pnl', field: 'pnl', type: 'number' },
          { colId: 'desk', field: 'desk', type: 'text' },
          { colId: 'pctOfGroup', type: 'number' },
        ],
        rowIdField: 'id',
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: {
        columns: [
          {
            colId: 'pctOfGroup',
            ast: { kind: 'field', name: 'pnl' },
            prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'group' } }],
            cellDataType: 'number',
            usesPrev: false,
          },
        ],
        interpreterSource: PCT_INTERP,
        aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 3, type: 'setRowData',
      payload: {
        rows: [
          { id: '1', pnl: 10, desk: 'A' },
          { id: '2', pnl: 20, desk: 'A' },
          { id: '3', pnl: 100, desk: 'B' },
          { id: '4', pnl: 200, desk: 'B' },
        ],
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 4, type: 'setGroupModel',
      payload: { rowGroupCols: ['desk'] },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 5, type: 'getViewport',
      // 2 groups + 4 leaf rows = 6 flatOrder entries; request the whole
      // range so both group headers AND every leaf row land in-chunk.
      payload: { rowStart: 0, rowEnd: 6, columns: ['pnl', 'desk', 'pctOfGroup'] },
    } as unknown as WorkerRequest);
    await flush();

    const reply = outbox.find((m) => 'id' in m && m.id === 5) as any;
    expect(reply).toBeDefined();
    expect(reply.type).toBe('viewport');
    // rowKinds[i] === 0 marks a leaf (data) row; group-header entries
    // (kind 1) carry no per-row Stage-B value (left at the Float64Array
    // default of 0) — filter to leaf rows before comparing.
    const rowKinds: Uint8Array = reply.chunk.rowKinds;
    const allValues: Float64Array = reply.chunk.numericCols.pctOfGroup;
    const values: number[] = [];
    for (let i = 0; i < rowKinds.length; i++) {
      if (rowKinds[i] === 0) values.push(allValues[i]!);
    }
    expect(values).toHaveLength(4);
    const rounded = values.map((v) => Math.round(v * 100) / 100).sort((a, b) => a - b);
    const expected = [
      Math.round((10 / 30) * 100 * 100) / 100,
      Math.round((20 / 30) * 100 * 100) / 100,
      Math.round((100 / 300) * 100 * 100) / 100,
      Math.round((200 / 300) * 100 * 100) / 100,
    ].sort((a, b) => a - b);
    expect(rounded).toEqual(expected);
  });

  it('setGroupModel regroup re-scopes values on the next viewport', async () => {
    const { host, outbox } = makeHost();
    host.handle({
      id: 1,
      type: 'init',
      payload: {
        columns: [
          { colId: 'pnl', field: 'pnl', type: 'number' },
          { colId: 'desk', field: 'desk', type: 'text' },
          { colId: 'pctOfGroup', type: 'number' },
        ],
        rowIdField: 'id',
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: {
        columns: [
          {
            colId: 'pctOfGroup',
            ast: { kind: 'field', name: 'pnl' },
            prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'group' } }],
            cellDataType: 'number',
            usesPrev: false,
          },
        ],
        interpreterSource: PCT_INTERP,
        aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 3, type: 'setRowData',
      payload: {
        rows: [
          { id: '1', pnl: 10, desk: 'A' },
          { id: '2', pnl: 20, desk: 'A' },
          { id: '3', pnl: 100, desk: 'B' },
          { id: '4', pnl: 200, desk: 'B' },
        ],
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({ id: 4, type: 'setGroupModel', payload: { rowGroupCols: ['desk'] } } as unknown as WorkerRequest);
    await flush();
    host.handle({
      id: 5, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 6, columns: ['pnl', 'desk', 'pctOfGroup'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply1 = outbox.find((m) => 'id' in m && m.id === 5) as any;
    const leafValues1: number[] = [];
    {
      const kinds: Uint8Array = reply1.chunk.rowKinds;
      const arr: Float64Array = reply1.chunk.numericCols.pctOfGroup;
      for (let i = 0; i < kinds.length; i++) if (kinds[i] === 0) leafValues1.push(arr[i]!);
    }
    // Grouped: each row's value is its GROUP's pnl share (30 or 300).
    expect(leafValues1.map((v) => Math.round(v)).sort((a, b) => a - b)).toEqual([33, 33, 67, 67]);

    // Regroup: bypass grouping entirely — scope 'group' now has no group
    // tree, so per spec the row falls back to the visible instance (no
    // active grouping) — every row's share is now of the WHOLE (330) set.
    host.handle({ id: 6, type: 'setGroupModel', payload: { rowGroupCols: [] } } as unknown as WorkerRequest);
    await flush();
    host.handle({
      id: 7, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 4, columns: ['pnl', 'desk', 'pctOfGroup'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply2 = outbox.find((m) => 'id' in m && m.id === 7) as any;
    expect(reply2).toBeDefined();
    const leafValues2: number[] = Array.from(reply2.chunk.numericCols.pctOfGroup as ArrayLike<number>);
    // Re-scoped: values differ from the grouped pass (proves the regroup
    // actually re-ran Stage B, not stale cached scalars).
    expect(leafValues2.sort((a, b) => a - b)).not.toEqual(leafValues1.sort((a, b) => a - b));
    // pnl 10/20/100/200 over the WHOLE 330 total.
    const expected2 = [10, 20, 100, 200].map((v) => Math.round((v / 330) * 100)).sort((a, b) => a - b);
    expect(leafValues2.map((v) => Math.round(v)).sort((a, b) => a - b)).toEqual(expected2);
  });
});

// ─── Final review Fix 1 — parameterized aggregate fn resolution ────────────
//
// The transform emits parameterized fn strings like 'PERCENTILE(95)'
// (packages/calc/src/aggTransform.ts:151), but `aggregateSources` ships the
// BASE factory name ('PERCENTILE') per the registry's arity convention
// (packages/calc/src/aggregates/registry.ts:130-146: `getAggregate('PERCENTILE(95)')`
// parses the `NAME(p)` suffix and calls the 1-arg factory with p). Prior to
// this fix, `CalcProgramStore.entryFor` did a verbatim `factories.get(fn)`
// lookup — 'PERCENTILE(95)' never matches the 'PERCENTILE' key, so every
// PERCENTILE program threw 'unresolved aggregate function' and killed
// `ensureStageB` (and therefore `buildVisibleAsync`) end-to-end.

/** PERCENTILE(p) factory source — same shape @wellsfargo-starui/velocity-grid/calc ships
 *  (packages/calc/src/aggregates/stats.ts's makePercentile): a
 *  1-arg factory using PERCENTILE.INC linear interpolation. */
const PERCENTILE_FACTORY = `(function makePercentile(p) {
  return {
    init() { return { values: [] }; },
    addRow(state, value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return state;
      const values = state.values;
      let lo = 0, hi = values.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid] < value) lo = mid + 1; else hi = mid; }
      values.splice(lo, 0, value);
      return state;
    },
    removeRow(state, value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return state;
      const values = state.values;
      let lo = 0, hi = values.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid] < value) lo = mid + 1; else hi = mid; }
      if (lo < values.length && values[lo] === value) values.splice(lo, 1);
      return state;
    },
    updateRow(state, oldValue, newValue) { return this.addRow(this.removeRow(state, oldValue), newValue); },
    finalize(state) {
      const values = state.values;
      const n = values.length;
      if (n === 0) return null;
      const q = Math.min(100, Math.max(0, p));
      const rank = (q / 100) * (n - 1);
      const lo = Math.floor(rank);
      const hi = Math.min(lo + 1, n - 1);
      return values[lo] + (rank - lo) * (values[hi] - values[lo]);
    },
  };
})`;

/** MEDIAN — zero-arg control: registered under its OWN name (not a
 *  `NAME(p)` suffix), so `entryFor`'s plain `factories.get(fn)` path
 *  must keep working unchanged. */
const MEDIAN_FACTORY = `(function makeMedian() {
  return {
    init() { return { values: [] }; },
    addRow(state, value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return state;
      const values = state.values;
      let lo = 0, hi = values.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid] < value) lo = mid + 1; else hi = mid; }
      values.splice(lo, 0, value);
      return state;
    },
    removeRow(state, value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return state;
      const values = state.values;
      let lo = 0, hi = values.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (values[mid] < value) lo = mid + 1; else hi = mid; }
      if (lo < values.length && values[lo] === value) values.splice(lo, 1);
      return state;
    },
    updateRow(state, oldValue, newValue) { return this.addRow(this.removeRow(state, oldValue), newValue); },
    finalize(state) {
      const values = state.values;
      const n = values.length;
      if (n === 0) return null;
      const rank = 0.5 * (n - 1);
      const lo = Math.floor(rank);
      const hi = Math.min(lo + 1, n - 1);
      return values[lo] + (rank - lo) * (values[hi] - values[lo]);
    },
  };
})`;

const SLOT_INTERP = `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
  if (ast === null) return null;
  return aggSlots[0];
})`;

describe('CalcPass Stage B — Fix 1: parameterized aggregate fn resolution (PERCENTILE(p))', () => {
  it("store-level: prePass fn 'PERCENTILE(95)' resolves against aggregateSources entry named 'PERCENTILE' (base name) and computes the correct percentile", () => {
    // pnl values: 10, 20, 100, 200, 300 — 5-element multiset.
    interface PnlRow { id: string; pnl: number }
    const store = new RowStore<PnlRow>('id');
    store.setAll([
      { id: '1', pnl: 10 },
      { id: '2', pnl: 20 },
      { id: '3', pnl: 100 },
      { id: '4', pnl: 200 },
      { id: '5', pnl: 300 },
    ]);
    const pnlFieldOf = (colId: string): string | undefined => (colId === 'pnl' ? 'pnl' : undefined);

    const program: WorkerCalcProgram = {
      columns: [
        {
          colId: 'p95',
          ast: { kind: 'slot' },
          prePass: [{ slot: 0, fn: 'PERCENTILE(95)', colId: 'pnl', scope: { kind: 'all' } }],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      interpreterSource: SLOT_INTERP,
      // aggregateSources ships the BASE name only — mirrors the real
      // @wellsfargo-starui/velocity-grid/calc bridge (registry.ts serializeAggregates()).
      aggregateSources: [{ name: 'PERCENTILE', source: PERCENTILE_FACTORY }],
    };

    const calc = new CalcProgramStore();
    calc.install(program);
    expect(() => calc.ensureStageB(store, NO_GROUP, ['1', '2', '3', '4', '5'], pnlFieldOf)).not.toThrow();

    // PERCENTILE.INC(95) over [10,20,100,200,300]: rank = 0.95*4 = 3.8
    // → interpolate between index 3 (200) and index 4 (300): 200 + 0.8*100 = 280.
    expect(calc.valueAt('1', 'p95')).toBeCloseTo(280);
  });

  it("MEDIAN (zero-arg control): registered under its own name — unaffected by the NAME(p) parse path", () => {
    interface PnlRow { id: string; pnl: number }
    const store = new RowStore<PnlRow>('id');
    store.setAll([
      { id: '1', pnl: 10 },
      { id: '2', pnl: 20 },
      { id: '3', pnl: 100 },
      { id: '4', pnl: 200 },
      { id: '5', pnl: 300 },
    ]);
    const pnlFieldOf = (colId: string): string | undefined => (colId === 'pnl' ? 'pnl' : undefined);

    const program: WorkerCalcProgram = {
      columns: [
        {
          colId: 'med',
          ast: { kind: 'slot' },
          prePass: [{ slot: 0, fn: 'MEDIAN', colId: 'pnl', scope: { kind: 'all' } }],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      interpreterSource: SLOT_INTERP,
      aggregateSources: [{ name: 'MEDIAN', source: MEDIAN_FACTORY }],
    };

    const calc = new CalcProgramStore();
    calc.install(program);
    expect(() => calc.ensureStageB(store, NO_GROUP, ['1', '2', '3', '4', '5'], pnlFieldOf)).not.toThrow();
    // Median of [10,20,100,200,300] = 100 (middle element).
    expect(calc.valueAt('1', 'med')).toBeCloseTo(100);
  });

  it('worker host end-to-end: install → setRowData → getViewport with a real PERCENTILE program computes the correct percentile, no throw', async () => {
    const { host, outbox } = makeHost();
    host.handle({
      id: 1,
      type: 'init',
      payload: {
        columns: [
          { colId: 'pnl', field: 'pnl', type: 'number' },
          { colId: 'p95', type: 'number' },
        ],
        rowIdField: 'id',
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: {
        columns: [
          {
            colId: 'p95',
            ast: { kind: 'slot' },
            prePass: [{ slot: 0, fn: 'PERCENTILE(95)', colId: 'pnl', scope: { kind: 'all' } }],
            cellDataType: 'number',
            usesPrev: false,
          },
        ],
        interpreterSource: SLOT_INTERP,
        aggregateSources: [{ name: 'PERCENTILE', source: PERCENTILE_FACTORY }],
      },
    } as unknown as WorkerRequest);
    await flush();

    // setCalcProgram's own rowCount reply must NOT be an error envelope —
    // this is the reviewer's repro: pre-fix, ensureStageB threw inside
    // invalidateAndCount() and the whole buildVisibleAsync chain died.
    const installReply = outbox.find((m) => 'id' in m && m.id === 2) as any;
    expect(installReply).toBeDefined();
    expect(installReply.type).not.toBe('error');

    host.handle({
      id: 3, type: 'setRowData',
      payload: {
        rows: [
          { id: '1', pnl: 10 },
          { id: '2', pnl: 20 },
          { id: '3', pnl: 100 },
          { id: '4', pnl: 200 },
          { id: '5', pnl: 300 },
        ],
      },
    } as unknown as WorkerRequest);
    await flush();
    const setRowDataReply = outbox.find((m) => 'id' in m && m.id === 3) as any;
    expect(setRowDataReply).toBeDefined();
    expect(setRowDataReply.type).not.toBe('error');

    host.handle({
      id: 4, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 5, columns: ['pnl', 'p95'] },
    } as unknown as WorkerRequest);
    await flush();

    const reply = outbox.find((m) => 'id' in m && m.id === 4) as any;
    expect(reply).toBeDefined();
    expect(reply.type).toBe('viewport');
    const values: Float64Array = reply.chunk.numericCols.p95;
    for (let i = 0; i < values.length; i++) {
      expect(values[i]).toBeCloseTo(280);
    }
  });
});

// ─── Final review Fix 2 — delta REMOVE never subtracts ─────────────────────
//
// `capturePrevForUpdates` only ever captured `tx.update` rows into
// `tickPrevRowsB` — the remove path in `applyDeltaToScopes` later reads
// `tickPrevRowsB.get(rowId)` (undefined, since removes were never
// captured) and falls back to `read(rowId)`, which resolves through
// `store.getById(rowId)` — POST-removal, so `undefined` — for a
// data-field column. The SUM factory's `typeof value === 'number'` guard
// then no-ops `removeRow`, so the cached scalar keeps the removed row's
// contribution until the next FULL rebuild (reviewer's repro: SUM(all)
// over [10,20,100,200] = 330 expected to become 130 after removing rows
// 3 and 4 (100+200), but delta leaves it at 330).

describe('CalcPass Stage B — Fix 2: delta REMOVE subtracts the removed row from cached scope state', () => {
  it("store-level: SUM(all) after a delta remove reflects the removed row's value (reviewer repro: expect 130, not 330)", () => {
    const store = fixtureStore(); // pnl: 10, 20, 100, 200 → sum 330
    const program: WorkerCalcProgram = {
      columns: [
        {
          colId: 'sumAll',
          ast: { kind: 'slot' },
          prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'all' } }],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      interpreterSource: SLOT_INTERP,
      aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
    };
    const calc = new CalcProgramStore();
    calc.install(program);
    calc.ensureStageB(store, NO_GROUP, ['1', '2', '3', '4'], fieldOf);
    expect(calc.valueAt('1', 'sumAll')).toBeCloseTo(330);

    // Remove row '4' (pnl 200) — pre-apply snapshot must be captured
    // BEFORE store.apply, mirroring the worker.ts / handlers/dataPipeline.ts
    // call sites' capture-before-apply protocol.
    calc.capturePrevForUpdates(store, [], ['4']); // no updates this tick — remove-only
    const results = store.apply({ remove: ['4'] });
    calc.onTransaction(results);
    calc.ensureStageB(store, NO_GROUP, ['1', '2', '3'], fieldOf);

    // Expected: 330 - 200 = 130.
    expect(calc.valueAt('1', 'sumAll')).toBeCloseTo(130);
  });

  it('two removes in one transaction: SUM(all) subtracts both removed values (reviewer repro shape, remove desk B)', () => {
    const store = fixtureStore(); // pnl: 10, 20, 100, 200 → sum 330
    const program: WorkerCalcProgram = {
      columns: [
        {
          colId: 'sumAll',
          ast: { kind: 'slot' },
          prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'all' } }],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      interpreterSource: SLOT_INTERP,
      aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
    };
    const calc = new CalcProgramStore();
    calc.install(program);
    calc.ensureStageB(store, NO_GROUP, ['1', '2', '3', '4'], fieldOf);
    expect(calc.valueAt('1', 'sumAll')).toBeCloseTo(330);

    // Remove desk B's rows (3: pnl 100, 4: pnl 200) — leaves desk A (10+20=30).
    calc.capturePrevForUpdates(store, [], ['3', '4']); // capture BEFORE apply
    const results = store.apply({ remove: ['3', '4'] });
    calc.onTransaction(results);
    calc.ensureStageB(store, NO_GROUP, ['1', '2'], fieldOf);

    expect(calc.valueAt('1', 'sumAll')).toBeCloseTo(30);
  });

  it('grouped scope: removing a row from group A subtracts from group A only, group B untouched', () => {
    const store = fixtureStore(); // desk A: rows 1,2 (10+20=30); desk B: rows 3,4 (100+200=300)
    const { out } = groupedByDesk(store, ['1', '2', '3', '4']);
    const calc = new CalcProgramStore();
    calc.install(pctProgram('group'));
    calc.ensureStageB(store, out, ['1', '2', '3', '4'], fieldOf);
    expect(calc.valueAt('3', 'pctOfGroup')).toBeCloseTo((100 / 300) * 100);

    // Remove row '1' (desk A, pnl 10) — desk A sum should become 20 (row 2 only).
    calc.capturePrevForUpdates(store, [], ['1']); // capture BEFORE apply
    const results = store.apply({ remove: ['1'] });
    calc.onTransaction(results);
    const { group: group2 } = groupedByDesk(store, ['2', '3', '4']);
    const out2 = group2.apply(['2', '3', '4']);
    calc.ensureStageB(store, out2, ['2', '3', '4'], fieldOf);

    // Desk A now just row 2 → sum 20 → row2 = 100%.
    expect(calc.valueAt('2', 'pctOfGroup')).toBeCloseTo(100);
    // Desk B untouched — sum still 300.
    expect(calc.valueAt('3', 'pctOfGroup')).toBeCloseTo((100 / 300) * 100);
    expect(calc.valueAt('4', 'pctOfGroup')).toBeCloseTo((200 / 300) * 100);
  });

  it('worker host end-to-end: applyTransaction remove updates a SUM(all) calc column on the next viewport', async () => {
    const { host, outbox } = makeHost();
    host.handle({
      id: 1,
      type: 'init',
      payload: {
        columns: [
          { colId: 'pnl', field: 'pnl', type: 'number' },
          { colId: 'sumAll', type: 'number' },
        ],
        rowIdField: 'id',
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: {
        columns: [
          {
            colId: 'sumAll',
            ast: { kind: 'slot' },
            prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'all' } }],
            cellDataType: 'number',
            usesPrev: false,
          },
        ],
        interpreterSource: SLOT_INTERP,
        aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 3, type: 'setRowData',
      payload: {
        rows: [
          { id: '1', pnl: 10, desk: 'A' },
          { id: '2', pnl: 20, desk: 'A' },
          { id: '3', pnl: 100, desk: 'B' },
          { id: '4', pnl: 200, desk: 'B' },
        ],
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 4, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 4, columns: ['pnl', 'sumAll'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply1 = outbox.find((m) => 'id' in m && m.id === 4) as any;
    expect(Array.from(reply1.chunk.numericCols.sumAll as ArrayLike<number>)).toEqual([330, 330, 330, 330]);

    // Sync remove of row '4' (pnl 200) — delta path.
    host.handle({
      id: 5, type: 'applyTransaction',
      payload: { remove: ['4'], async: false },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 6, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 3, columns: ['pnl', 'sumAll'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply2 = outbox.find((m) => 'id' in m && m.id === 6) as any;
    expect(Array.from(reply2.chunk.numericCols.sumAll as ArrayLike<number>)).toEqual([130, 130, 130]);
  });
});

// ─── Final review Fix 3 — delta add/update outside postFilterIds pollutes
// visible/group scopes ────────────────────────────────────────────────────
//
// `chainFrom` unconditionally includes the 'visible' (and, when grouped,
// the group chain) cache key for EVERY add/update row, with no check
// against `postFilterIds` membership. A row that is filtered OUT of the
// view still gets `addRow`'d into the 'visible' scope's cached state,
// inflating every SUM/COUNT/etc reader of that scope — e.g. adding a
// filtered-out row worth 1000 to a visible set that should sum to 30
// produces 1030 instead.
//
// `rowScopeKey` also has no filter-membership awareness: a row that
// CROSSES the filter boundary via an update (enters or leaves the
// filtered set) needs its old-scope contribution removed and/or its
// new-scope contribution added — synthesizing that correctly from a
// pure delta is complex, so the fix falls back to a full-cause rebuild
// of the pass whenever a touched row's filter membership changed since
// the last completed pass (documented tradeoff: O(scope) cost on a
// boundary-crossing tick, same cost class as a regroup).

describe('CalcPass Stage B — Fix 3: delta respects postFilterIds membership for visible/group scopes', () => {
  it("store-level: adding a row OUTSIDE postFilterIds does not pollute the 'visible' SUM (reviewer repro: expect 30, not 1030)", () => {
    interface Row2 { id: string; pnl: number }
    const store = new RowStore<Row2>('id');
    store.setAll([
      { id: '1', pnl: 10 },
      { id: '2', pnl: 20 },
    ]);
    const pnlFieldOf = (colId: string): string | undefined => (colId === 'pnl' ? 'pnl' : undefined);
    const program: WorkerCalcProgram = {
      columns: [
        {
          colId: 'sumVisible',
          ast: { kind: 'slot' },
          prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'visible' } }],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      interpreterSource: SLOT_INTERP,
      aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
    };
    const calc = new CalcProgramStore();
    calc.install(program);
    // Both rows visible initially: sum = 30.
    calc.ensureStageB(store, NO_GROUP, ['1', '2'], pnlFieldOf);
    expect(calc.valueAt('1', 'sumVisible')).toBeCloseTo(30);

    // Add a NEW row worth 1000 that is FILTERED OUT (not in postFilterIds —
    // e.g. it fails an active column filter). The store gains it, but the
    // visible set does not.
    store.apply({ add: [{ id: '3', pnl: 1000 }] });
    const results = { add: [{ rowId: '3' }], update: [], remove: [] };
    calc.onTransaction(results);
    // postFilterIds still excludes row '3' — it was filtered out.
    calc.ensureStageB(store, NO_GROUP, ['1', '2'], pnlFieldOf);

    // 'visible' sum must stay 30 — row 3 never entered the filtered view.
    expect(calc.valueAt('1', 'sumVisible')).toBeCloseTo(30);
  });

  it("worker host: applyTransaction add of a row that fails an active column filter leaves the visible SUM unpolluted", async () => {
    const { host, outbox } = makeHost();
    host.handle({
      id: 1,
      type: 'init',
      payload: {
        columns: [
          { colId: 'pnl', field: 'pnl', type: 'number' },
          { colId: 'sumVisible', type: 'number' },
        ],
        rowIdField: 'id',
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: {
        columns: [
          {
            colId: 'sumVisible',
            ast: { kind: 'slot' },
            prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'visible' } }],
            cellDataType: 'number',
            usesPrev: false,
          },
        ],
        interpreterSource: SLOT_INTERP,
        aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 3, type: 'setRowData',
      payload: { rows: [{ id: '1', pnl: 10 }, { id: '2', pnl: 20 }] },
    } as unknown as WorkerRequest);
    await flush();

    // Filter: pnl <= 100 — excludes any row with pnl > 100.
    host.handle({
      id: 4, type: 'setFilterModel',
      payload: { pnl: { filterType: 'number', type: 'lessThanOrEqual', filter: 100 } },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 5, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 2, columns: ['pnl', 'sumVisible'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply1 = outbox.find((m) => 'id' in m && m.id === 5) as any;
    expect(Array.from(reply1.chunk.numericCols.sumVisible as ArrayLike<number>)).toEqual([30, 30]);

    // Sync add of a row that FAILS the filter (pnl 1000 > 100).
    host.handle({
      id: 6, type: 'applyTransaction',
      payload: { add: [{ id: '3', pnl: 1000 }], async: false },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 7, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 2, columns: ['pnl', 'sumVisible'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply2 = outbox.find((m) => 'id' in m && m.id === 7) as any;
    // Row 3 is filtered out — visible sum must remain 30, not 1030.
    expect(Array.from(reply2.chunk.numericCols.sumVisible as ArrayLike<number>)).toEqual([30, 30]);
  });

  it('row crossing the filter boundary via update: entering the filtered set adds its value to the visible SUM', async () => {
    const { host, outbox } = makeHost();
    host.handle({
      id: 1,
      type: 'init',
      payload: {
        columns: [
          { colId: 'pnl', field: 'pnl', type: 'number' },
          { colId: 'sumVisible', type: 'number' },
        ],
        rowIdField: 'id',
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: {
        columns: [
          {
            colId: 'sumVisible',
            ast: { kind: 'slot' },
            prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'visible' } }],
            cellDataType: 'number',
            usesPrev: false,
          },
        ],
        interpreterSource: SLOT_INTERP,
        aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
      },
    } as unknown as WorkerRequest);
    await flush();

    // Row '3' starts OUT of the filtered set (pnl 1000 > 100).
    host.handle({
      id: 3, type: 'setRowData',
      payload: { rows: [{ id: '1', pnl: 10 }, { id: '2', pnl: 20 }, { id: '3', pnl: 1000 }] },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 4, type: 'setFilterModel',
      payload: { pnl: { filterType: 'number', type: 'lessThanOrEqual', filter: 100 } },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 5, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 2, columns: ['pnl', 'sumVisible'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply1 = outbox.find((m) => 'id' in m && m.id === 5) as any;
    expect(Array.from(reply1.chunk.numericCols.sumVisible as ArrayLike<number>)).toEqual([30, 30]);

    // Update row '3': pnl 1000 -> 50 — now it CROSSES the filter boundary
    // and enters the visible set.
    host.handle({
      id: 6, type: 'applyTransaction',
      payload: { update: [{ id: '3', pnl: 50 }], async: false },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 7, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 3, columns: ['pnl', 'sumVisible'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply2 = outbox.find((m) => 'id' in m && m.id === 7) as any;
    // Visible set is now rows 1, 2, 3 → sum = 10 + 20 + 50 = 80.
    expect(Array.from(reply2.chunk.numericCols.sumVisible as ArrayLike<number>)).toEqual([80, 80, 80]);
  });

  it('row crossing the filter boundary via update: leaving the filtered set removes its value from the visible SUM', async () => {
    const { host, outbox } = makeHost();
    host.handle({
      id: 1,
      type: 'init',
      payload: {
        columns: [
          { colId: 'pnl', field: 'pnl', type: 'number' },
          { colId: 'sumVisible', type: 'number' },
        ],
        rowIdField: 'id',
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: {
        columns: [
          {
            colId: 'sumVisible',
            ast: { kind: 'slot' },
            prePass: [{ slot: 0, fn: 'sum', colId: 'pnl', scope: { kind: 'visible' } }],
            cellDataType: 'number',
            usesPrev: false,
          },
        ],
        interpreterSource: SLOT_INTERP,
        aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
      },
    } as unknown as WorkerRequest);
    await flush();

    // Row '3' starts IN the filtered set (pnl 50 <= 100).
    host.handle({
      id: 3, type: 'setRowData',
      payload: { rows: [{ id: '1', pnl: 10 }, { id: '2', pnl: 20 }, { id: '3', pnl: 50 }] },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 4, type: 'setFilterModel',
      payload: { pnl: { filterType: 'number', type: 'lessThanOrEqual', filter: 100 } },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 5, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 3, columns: ['pnl', 'sumVisible'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply1 = outbox.find((m) => 'id' in m && m.id === 5) as any;
    expect(Array.from(reply1.chunk.numericCols.sumVisible as ArrayLike<number>)).toEqual([80, 80, 80]);

    // Update row '3': pnl 50 -> 1000 — now it LEAVES the filtered set.
    host.handle({
      id: 6, type: 'applyTransaction',
      payload: { update: [{ id: '3', pnl: 1000 }], async: false },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 7, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 2, columns: ['pnl', 'sumVisible'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply2 = outbox.find((m) => 'id' in m && m.id === 7) as any;
    // Visible set is now just rows 1, 2 → sum = 10 + 20 = 30.
    expect(Array.from(reply2.chunk.numericCols.sumVisible as ArrayLike<number>)).toEqual([30, 30]);
  });
});
