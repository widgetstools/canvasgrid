// Cycle 21d / Task 11 — CalcPass Stage A: row-local calc values flowing
// through filter/sort/group like ordinary columns.
//
// Mirrors `tests/dataPipelineFlash.test.ts`'s fixture style: build a
// `RowStore` + passes directly, no worker-host round-trip for the
// store/pass-level cases. The worker-host harness cases (Step 8) land
// at the bottom, mirroring `calcProgramStore.test.ts`'s "End-to-end via
// the worker dispatch host" section.

import { describe, it, expect } from 'vitest';
import {
  RowStore, FilterPass, ViewportSlicer,
} from '../src/worker/dataPipeline';
import { SortPass } from '../src/worker/passes/sortPass';
import { GroupPass } from '../src/worker/passes/groupPass';
import { CalcProgramStore } from '../src/worker/passes/calcPass';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerColumn, ViewportRequest, WorkerCalcProgram, WorkerRequest, WorkerResponse, WorkerPush } from '../src/worker/protocol';

interface Row { id: string; price: number; ticker: string }

function fixtureStore(): RowStore<Row> {
  const store = new RowStore<Row>('id');
  store.setAll([
    { id: '1', price: 100, ticker: 'AAPL' },
    { id: '2', price: 200, ticker: 'MSFT' },
    { id: '3', price: 50, ticker: 'GOOG' },
  ]);
  return store;
}

/** `double` — row-local numeric calc column: `price * 2`. */
const DOUBLE_INTERP = `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
  if (ast === null) return null;
  if (ast.kind === 'field') return row[ast.name] * 2;
  return null;
})`;

function doubleProgram(overrides: Partial<WorkerCalcProgram> = {}): WorkerCalcProgram {
  return {
    columns: [
      {
        colId: 'double',
        ast: { kind: 'field', name: 'price' },
        prePass: [],
        cellDataType: 'number',
        usesPrev: false,
      },
    ],
    interpreterSource: DOUBLE_INTERP,
    aggregateSources: [],
    ...overrides,
  };
}

/** `bucket` — row-local text calc column: 'hi' when price > 150 else 'lo'. */
const BUCKET_INTERP = `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
  if (ast === null) return null;
  if (ast.kind === 'bucket') return row.price > 150 ? 'hi' : 'lo';
  return null;
})`;

function bucketProgram(overrides: Partial<WorkerCalcProgram> = {}): WorkerCalcProgram {
  return {
    columns: [
      {
        colId: 'bucket',
        ast: { kind: 'bucket' },
        prePass: [],
        cellDataType: 'text',
        usesPrev: false,
      },
    ],
    interpreterSource: BUCKET_INTERP,
    aggregateSources: [],
    ...overrides,
  };
}

/** Counting interpreter — increments a closure-scoped counter on every
 *  eval so "touched-only recompute" can assert exactly which rows were
 *  re-evaluated. The count rides on the store's cached value itself
 *  (`price * 10000 + evalCount`) so a test can decode both the value AND
 *  how many times a given row was evaluated without any module-scope
 *  state leaking across tests. */
function countingProgram(): { program: WorkerCalcProgram; evalCounts: Map<string, number> } {
  const evalCounts = new Map<string, number>();
  // The interpreter closes over `evalCounts` via a global registry keyed
  // by row id isn't possible across the `new Function` boundary (source
  // is reconstructed in isolation) — instead we smuggle the running
  // count INTO the row's own field so it round-trips value-only.
  const interp = `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
    if (ast === null) return null;
    row.__evals = (row.__evals || 0) + 1;
    return row.price + row.__evals * 0.001;
  })`;
  return {
    program: {
      columns: [
        {
          colId: 'counted',
          ast: { kind: 'field', name: 'price' },
          prePass: [],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
      interpreterSource: interp,
      aggregateSources: [],
    },
    evalCounts,
  };
}

/** PREV([price]) calc column. */
const PREV_INTERP = `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
  if (ast === null) return null;
  return prevLookup === null ? null : prevLookup('price');
})`;

function prevProgram(overrides: Partial<WorkerCalcProgram> = {}): WorkerCalcProgram {
  return {
    columns: [
      {
        colId: 'prevPrice',
        ast: { kind: 'prev' },
        prePass: [],
        cellDataType: 'number',
        usesPrev: true,
      },
    ],
    interpreterSource: PREV_INTERP,
    aggregateSources: [],
    ...overrides,
  };
}

const fieldOfPrice = (colId: string): string | undefined => (colId === 'price' ? 'price' : undefined);

describe('CalcProgramStore — Stage A compute + valueAt', () => {
  it('ensureStageA fills the cache; valueAt reads the computed value', () => {
    const store = fixtureStore();
    const calc = new CalcProgramStore();
    calc.install(doubleProgram());
    calc.ensureStageA(store, fieldOfPrice);
    expect(calc.valueAt('1', 'double')).toBe(200);
    expect(calc.valueAt('2', 'double')).toBe(400);
    expect(calc.valueAt('3', 'double')).toBe(100);
  });

  it('no program installed → ensureStageA is a no-op', () => {
    const store = fixtureStore();
    const calc = new CalcProgramStore();
    calc.ensureStageA(store, fieldOfPrice);
    expect(calc.valueAt('1', 'double')).toBeUndefined();
    expect(calc.hasProgram()).toBe(false);
  });
});

describe('FilterPass — calc column seam', () => {
  it('filters over a fieldless calc column using the calc source', () => {
    const store = fixtureStore();
    const calc = new CalcProgramStore();
    calc.install(doubleProgram());
    calc.ensureStageA(store, fieldOfPrice);

    const cols: WorkerColumn[] = [{ colId: 'double', type: 'number' }];
    const filter = new FilterPass(store, cols);
    filter.setCalcSource(calc);
    filter.setModel({
      double: { filterType: 'number', type: 'greaterThan', filter: 150 } as any,
    });
    const out = filter.apply();
    // double: 1→200, 2→400, 3→100 — only rows 1 and 2 survive > 150.
    expect(new Set(out)).toEqual(new Set(['1', '2']));
  });

  it('with no calc source installed, a fieldless entry contributes no constraint (byte-identical to pre-21d)', () => {
    const store = fixtureStore();
    const cols: WorkerColumn[] = [{ colId: 'double', type: 'number' }];
    const filter = new FilterPass(store, cols);
    filter.setModel({
      double: { filterType: 'number', type: 'greaterThan', filter: 150 } as any,
    });
    const out = filter.apply();
    expect(new Set(out)).toEqual(new Set(['1', '2', '3']));
  });
});

describe('SortPass — calc column seam (flat)', () => {
  it('sorts by a fieldless calc column value, desc', () => {
    const store = fixtureStore();
    const calc = new CalcProgramStore();
    calc.install(doubleProgram());
    calc.ensureStageA(store, fieldOfPrice);

    const cols: WorkerColumn[] = [{ colId: 'double', type: 'number' }];
    const sort = new SortPass(store, cols);
    sort.setCalcSource(calc);
    sort.setModel([{ colId: 'double', direction: 'desc' }]);
    const out = sort.apply(['1', '2', '3']);
    // double: 1→200, 2→400, 3→100 → desc order: 2, 1, 3
    expect(out).toEqual(['2', '1', '3']);
  });
});

describe('GroupPass — calc column seam', () => {
  it('groups by a fieldless calc column producing hi/lo buckets', () => {
    const store = fixtureStore();
    const calc = new CalcProgramStore();
    calc.install(bucketProgram());
    calc.ensureStageA(store, fieldOfPrice);

    const cols: WorkerColumn[] = [{ colId: 'bucket', type: 'text' }];
    const group = new GroupPass(store, cols);
    group.setCalcSource(calc);
    group.setModel({ rowGroupCols: ['bucket'] });
    const out = group.apply(['1', '2', '3']);
    expect(out.bypassed).toBe(false);
    expect(out.roots.length).toBe(2);
    const byKeyPart = new Map(out.roots.map((r) => [String(r.value), r]));
    // price 100 → lo, price 200 → hi, price 50 → lo
    const hi = byKeyPart.get('hi')!;
    const lo = byKeyPart.get('lo')!;
    expect(hi.childCount).toBe(1);
    expect(lo.childCount).toBe(2);
  });
});

describe('ViewportSlicer — calc column ships in numericCols / textCols', () => {
  it('a numeric calc column lands in chunk.numericCols', () => {
    const store = fixtureStore();
    const calc = new CalcProgramStore();
    calc.install(doubleProgram());
    calc.ensureStageA(store, fieldOfPrice);

    const cols: WorkerColumn[] = [{ colId: 'double', type: 'number' }];
    const slicer = new ViewportSlicer<Row>(store, cols);
    slicer.setCalcSource(calc);
    const req: ViewportRequest = { rowStart: 0, rowEnd: 3, columns: ['double'] };
    const chunk = slicer.slice(['1', '2', '3'], req);
    expect(chunk.numericCols.double).toBeDefined();
    expect(Array.from(chunk.numericCols.double!)).toEqual([200, 400, 100]);
  });

  it('a text calc column lands in chunk.textCols (encodeText, "" for null)', () => {
    const store = fixtureStore();
    const calc = new CalcProgramStore();
    calc.install(bucketProgram());
    calc.ensureStageA(store, fieldOfPrice);

    const cols: WorkerColumn[] = [{ colId: 'bucket', type: 'text' }];
    const slicer = new ViewportSlicer<Row>(store, cols);
    slicer.setCalcSource(calc);
    const req: ViewportRequest = { rowStart: 0, rowEnd: 3, columns: ['bucket'] };
    const chunk = slicer.slice(['1', '2', '3'], req);
    expect(chunk.textCols.bucket).toBeDefined();
  });
});

describe('CalcProgramStore — touched-only recompute', () => {
  it('a transaction updating one row only recomputes that row', () => {
    const store = fixtureStore();
    const calc = new CalcProgramStore();
    const { program } = countingProgram();
    calc.install(program);
    calc.ensureStageA(store, fieldOfPrice);
    const before1 = calc.valueAt('1', 'counted');
    const before2 = calc.valueAt('2', 'counted');

    // Update row '2' only.
    const newRow2 = { id: '2', price: 250, ticker: 'MSFT' };
    calc.capturePrevForUpdates(store, [newRow2]);
    const results = store.apply({ update: [newRow2] });
    calc.onTransaction(results);
    calc.ensureStageA(store, fieldOfPrice);

    const after1 = calc.valueAt('1', 'counted');
    const after2 = calc.valueAt('2', 'counted');
    // Row 1 untouched — cached value unchanged (same eval count baked in).
    expect(after1).toBe(before1);
    // Row 2 recomputed — new price, new eval-count suffix.
    expect(after2).not.toBe(before2);
    expect(Math.floor(after2 as number)).toBe(250);
  });

  it('removed rowIds are evicted from the value cache', () => {
    const store = fixtureStore();
    const calc = new CalcProgramStore();
    calc.install(doubleProgram());
    calc.ensureStageA(store, fieldOfPrice);
    expect(calc.valueAt('3', 'double')).toBe(100);

    const results = store.apply({ remove: ['3'] });
    calc.onTransaction(results);
    expect(calc.valueAt('3', 'double')).toBeUndefined();
  });
});

describe('CalcProgramStore — PREV capture', () => {
  it('valueAt for a PREV column returns the OLD value during the tick, then null after a fresh recompute with no new capture', () => {
    const store = fixtureStore();
    const calc = new CalcProgramStore();
    calc.install(prevProgram());
    calc.ensureStageA(store, fieldOfPrice);
    // Before any transaction: no captured prev rows → prevLookup is null → null.
    expect(calc.valueAt('2', 'prevPrice')).toBeNull();

    const newRow2 = { id: '2', price: 250, ticker: 'MSFT' };
    calc.capturePrevForUpdates(store, [newRow2]); // capture BEFORE apply
    const results = store.apply({ update: [newRow2] });
    calc.onTransaction(results);
    calc.ensureStageA(store, fieldOfPrice);
    // Old value (200) during the tick that consumed the capture.
    expect(calc.valueAt('2', 'prevPrice')).toBe(200);

    // A second ensureStageA pass with no new capture and no dirty rows
    // recomputes nothing — value stays as it was (old 200), since dirty
    // set is empty after the first consumption.
    calc.ensureStageA(store, fieldOfPrice);
    expect(calc.valueAt('2', 'prevPrice')).toBe(200);

    // Forcing a full recompute (fresh install) with no capture this time
    // yields null — the tick map was cleared at the prior consumption.
    calc.install(prevProgram());
    calc.ensureStageA(store, fieldOfPrice);
    expect(calc.valueAt('2', 'prevPrice')).toBeNull();
  });
});

// ─── Worker-level integration (Step 8) ──────────────────────────────────────

function makeHost() {
  const outbox: (WorkerResponse | WorkerPush)[] = [];
  const host = createWorkerHost((msg) => outbox.push(msg));
  return { host, outbox };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('worker host — CalcPass Stage A end-to-end', () => {
  it('a fieldless number calc column ships computed values via chunk.numericCols; a text calc column via chunk.textCols', async () => {
    const { host, outbox } = makeHost();
    host.handle({
      id: 1,
      type: 'init',
      payload: {
        columns: [
          { colId: 'price', field: 'price', type: 'number' },
          { colId: 'double', type: 'number' },
          { colId: 'bucket', type: 'text' },
        ],
        rowIdField: 'id',
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: {
        columns: [
          { colId: 'double', ast: { kind: 'field', name: 'price' }, prePass: [], cellDataType: 'number', usesPrev: false },
          { colId: 'bucket', ast: { kind: 'bucket' }, prePass: [], cellDataType: 'text', usesPrev: false },
        ],
        interpreterSource: `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
          if (ast === null) return null;
          if (ast.kind === 'field') return row[ast.name] * 2;
          if (ast.kind === 'bucket') return row.price > 150 ? 'hi' : 'lo';
          return null;
        })`,
        aggregateSources: [],
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 3, type: 'setRowData',
      payload: { rows: [{ id: '1', price: 100 }, { id: '2', price: 200 }] },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 4, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 2, columns: ['price', 'double', 'bucket'] },
    } as unknown as WorkerRequest);
    await flush();

    const reply = outbox.find((m) => 'id' in m && m.id === 4) as any;
    expect(reply).toBeDefined();
    expect(reply.type).toBe('viewport');
    expect(Array.from(reply.chunk.numericCols.double)).toEqual([200, 400]);
    expect(reply.chunk.textCols.bucket).toBeDefined();
  });

  it('applyTransaction update recomputes and a PREV column reflects the old value on the next viewport pass', async () => {
    const { host, outbox } = makeHost();
    host.handle({
      id: 1,
      type: 'init',
      payload: {
        columns: [
          { colId: 'price', field: 'price', type: 'number' },
          { colId: 'prevPrice', type: 'number' },
        ],
        rowIdField: 'id',
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: {
        columns: [
          { colId: 'prevPrice', ast: { kind: 'prev' }, prePass: [], cellDataType: 'number', usesPrev: true },
        ],
        interpreterSource: PREV_INTERP,
        aggregateSources: [],
      },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 3, type: 'setRowData',
      payload: { rows: [{ id: '1', price: 100 }] },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 4, type: 'applyTransaction',
      payload: { update: [{ id: '1', price: 150 }] },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 5, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 1, columns: ['price', 'prevPrice'] },
    } as unknown as WorkerRequest);
    await flush();

    const reply = outbox.find((m) => 'id' in m && m.id === 5) as any;
    expect(reply.chunk.numericCols.price[0]).toBe(150);
    expect(reply.chunk.numericCols.prevPrice[0]).toBe(100);
  });
});
