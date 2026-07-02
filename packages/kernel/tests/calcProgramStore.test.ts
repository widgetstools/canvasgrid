// Cycle 21d / Task 10 — CalcProgramStore unit tests + setCalcProgram
// worker-protocol handler tests.
//
// Coverage:
//   • install/replace/remove (null) lifecycle on CalcProgramStore.
//   • Reconstruction via `new Function` (interpreter + aggregate
//     factories), mirroring the setAggFuncs precedent.
//   • Reconstruction-failure paths throw with an entry-naming message.
//   • End-to-end setCalcProgram dispatch through the worker host:
//     install / replace / remove all reply with the rowCount envelope;
//     malformed sources reply with the error envelope and leave the
//     host alive for subsequent requests.

import { describe, it, expect, vi } from 'vitest';
import { CalcProgramStore } from '../src/worker/passes/calcPass';
import type { WorkerCalcProgram } from '../src/worker/protocol';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest, WorkerResponse, WorkerPush } from '../src/worker/protocol';
import { WorkerClient } from '../src/worker/client';

const INTERP = `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
  if (ast === null) return null;
  if (ast.kind === 'field') return row[ast.name];
  if (ast.kind === 'agg') return aggSlots[ast.slot];
  return null;
})`;

const SUM_FACTORY = `(function sumFactory() {
  return {
    init: function () { return { total: 0 }; },
    addRow: function (st, v) { st.total += Number(v) || 0; return st; },
    removeRow: function (st, v) { st.total -= Number(v) || 0; return st; },
    updateRow: function (st, o, n) { st.total += (Number(n) || 0) - (Number(o) || 0); return st; },
    finalize: function (st) { return st.total; },
  };
})`;

function makeProgram(overrides: Partial<WorkerCalcProgram> = {}): WorkerCalcProgram {
  return {
    columns: [
      {
        colId: 'spread',
        ast: { kind: 'field', name: 'bid' },
        prePass: [],
        cellDataType: 'number',
        usesPrev: false,
      },
    ],
    interpreterSource: INTERP,
    aggregateSources: [{ name: 'sum', source: SUM_FACTORY }],
    ...overrides,
  };
}

describe('CalcProgramStore — install / replace / remove', () => {
  it('starts with no program', () => {
    const store = new CalcProgramStore();
    expect(store.hasProgram()).toBe(false);
    expect(store.isCalcCol('spread')).toBe(false);
    expect(store.interpreter()).toBeNull();
  });

  it('install flips hasProgram and registers columns', () => {
    const store = new CalcProgramStore();
    store.install(makeProgram());
    expect(store.hasProgram()).toBe(true);
    expect(store.isCalcCol('spread')).toBe(true);
    expect(store.isCalcCol('unknownCol')).toBe(false);
    expect(store.columnFor('spread')?.colId).toBe('spread');
  });

  it('interpreter() evaluates through the reconstructed function', () => {
    const store = new CalcProgramStore();
    store.install(makeProgram());
    const interp = store.interpreter();
    expect(interp).not.toBeNull();
    const result = interp!({ kind: 'field', name: 'bid' }, { bid: 42 }, [], null);
    expect(result).toBe(42);
  });

  it('aggregateFactory() returns a working delta contract', () => {
    const store = new CalcProgramStore();
    store.install(makeProgram());
    const factory = store.aggregateFactory('sum');
    expect(factory).toBeDefined();
    const agg = factory!();
    let st = agg.init();
    st = agg.addRow(st, 10);
    st = agg.addRow(st, 5);
    expect(agg.finalize(st)).toBe(15);
    st = agg.removeRow(st, 5);
    expect(agg.finalize(st)).toBe(10);
    st = agg.updateRow(st, 10, 20);
    expect(agg.finalize(st)).toBe(20);
  });

  it('install(null) removes the program wholesale', () => {
    const store = new CalcProgramStore();
    store.install(makeProgram());
    expect(store.hasProgram()).toBe(true);
    store.install(null);
    expect(store.hasProgram()).toBe(false);
    expect(store.isCalcCol('spread')).toBe(false);
    expect(store.interpreter()).toBeNull();
    expect(store.aggregateFactory('sum')).toBeUndefined();
  });

  it('re-install replaces the program wholesale', () => {
    const store = new CalcProgramStore();
    store.install(makeProgram());
    expect(store.isCalcCol('spread')).toBe(true);
    store.install(makeProgram({
      columns: [
        {
          colId: 'notional',
          ast: { kind: 'field', name: 'qty' },
          prePass: [],
          cellDataType: 'number',
          usesPrev: false,
        },
      ],
    }));
    expect(store.isCalcCol('spread')).toBe(false);
    expect(store.isCalcCol('notional')).toBe(true);
  });

  it('malformed interpreter source throws naming the entry', () => {
    const store = new CalcProgramStore();
    expect(() => store.install(makeProgram({ interpreterSource: 'not a function(' })))
      .toThrow(/calc interpreter/);
  });

  it('interpreter source evaluating to a non-function throws', () => {
    const store = new CalcProgramStore();
    expect(() => store.install(makeProgram({ interpreterSource: '(42)' })))
      .toThrow(/calc interpreter/);
  });

  it('malformed aggregate source throws naming the entry', () => {
    const store = new CalcProgramStore();
    expect(() => store.install(makeProgram({
      aggregateSources: [{ name: 'sum', source: 'not a function(' }],
    }))).toThrow(/calc aggregate 'sum'/);
  });

  it('aggregate source evaluating to a non-function throws', () => {
    const store = new CalcProgramStore();
    expect(() => store.install(makeProgram({
      aggregateSources: [{ name: 'sum', source: '(42)' }],
    }))).toThrow(/calc aggregate 'sum'/);
  });

  it('interpreter source referencing a free variable throws at smoke-eval time', () => {
    const store = new CalcProgramStore();
    const freeVarInterp = `(function (a,r,s,p){ return missingGlobal + 1; })`;
    expect(() => store.install(makeProgram({ interpreterSource: freeVarInterp })))
      .toThrow();
  });
});

// ─── End-to-end via the worker dispatch host ────────────────────────────────

function makeHost() {
  const outbox: (WorkerResponse | WorkerPush)[] = [];
  const host = createWorkerHost((msg) => outbox.push(msg));
  return { host, outbox };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function initReq(id: number): WorkerRequest {
  return {
    id,
    type: 'init',
    payload: {
      columns: [
        { colId: 'bid', field: 'bid' },
        { colId: 'spread', field: 'spread' },
      ],
      rowIdField: 'id',
    },
  } as unknown as WorkerRequest;
}

describe('worker dispatch — setCalcProgram', () => {
  it('install replies with the rowCount envelope', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle({ id: 2, type: 'setCalcProgram', payload: makeProgram() } as WorkerRequest);
    await flush();
    const reply = outbox.find((m) => 'id' in m && m.id === 2) as WorkerResponse;
    expect(reply).toBeDefined();
    expect(reply.type).toBe('rowCount');
  });

  it('replace (second install) still replies with rowCount', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle({ id: 2, type: 'setCalcProgram', payload: makeProgram() } as WorkerRequest);
    await flush();
    host.handle({ id: 3, type: 'setCalcProgram', payload: makeProgram() } as WorkerRequest);
    await flush();
    const reply = outbox.find((m) => 'id' in m && m.id === 3) as WorkerResponse;
    expect(reply.type).toBe('rowCount');
  });

  it('null payload removes the program and acknowledges', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle({ id: 2, type: 'setCalcProgram', payload: makeProgram() } as WorkerRequest);
    await flush();
    host.handle({ id: 3, type: 'setCalcProgram', payload: null } as WorkerRequest);
    await flush();
    const reply = outbox.find((m) => 'id' in m && m.id === 3) as WorkerResponse;
    expect(reply.type).toBe('rowCount');
  });

  it('malformed interpreterSource replies with error envelope and keeps host alive', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: makeProgram({ interpreterSource: 'not a function(' }),
    } as WorkerRequest);
    await flush();
    const reply = outbox.find((m) => 'id' in m && m.id === 2) as WorkerResponse;
    expect(reply.type).toBe('error');
    expect((reply as { error: string }).error).toMatch(/failed to deserialise/);

    // Host stays alive — a follow-up setRowData still succeeds.
    host.handle({ id: 3, type: 'setRowData', payload: { rows: [], heightsByRowId: undefined } } as WorkerRequest);
    await flush();
    const followUp = outbox.find((m) => 'id' in m && m.id === 3) as WorkerResponse;
    expect(followUp).toBeDefined();
    expect(followUp.type).toBe('rowCount');
  });

  it('free-variable interpreter source is converted to error envelope at install time', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();
    host.handle({
      id: 2, type: 'setCalcProgram',
      payload: makeProgram({ interpreterSource: '(function (a,r,s,p){ return missingGlobal + 1; })' }),
    } as WorkerRequest);
    await flush();
    const reply = outbox.find((m) => 'id' in m && m.id === 2) as WorkerResponse;
    expect(reply.type).toBe('error');
  });
});

// ─── Task 11 review backfill (opportunistic Minor) ──────────────────────────
//
// Task 10's review flagged two gaps in client-level coverage: the
// `WorkerClient.setCalcProgram` promise must REJECT (not silently
// resolve/hang) when the worker replies with an `error` envelope, and a
// double `install(null)` — through the client, not just the bare store —
// must stay idempotent (second no-op removal doesn't throw or leave the
// client's pending-request map in a bad state).

class FakeWorker {
  private listeners: Array<(e: { data: any }) => void> = [];
  host = createWorkerHost((msg) => {
    queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
  });
  postMessage(msg: any) { this.host.handle(msg); }
  addEventListener(_t: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
  terminate() {}
}

function makeClient() {
  const w = new FakeWorker();
  const client = new WorkerClient(w as any, {
    onModelUpdated: vi.fn(), onAsyncTransactionsFlushed: vi.fn(), onError: vi.fn(),
  });
  return { w, client };
}

describe('WorkerClient.setCalcProgram — rejection correlation + idempotency', () => {
  it('rejects the returned promise (correlated by request id) when the worker replies with an error envelope', async () => {
    const { client } = makeClient();
    await client.init({
      rowIdField: 'id',
      columns: [{ colId: 'bid', field: 'bid', type: 'number' }],
    });
    await expect(
      client.setCalcProgram(makeProgram({ interpreterSource: 'not a function(' })),
    ).rejects.toThrow(/failed to deserialise/);
  });

  it('a rejected setCalcProgram call does not wedge the client — a subsequent valid call still resolves', async () => {
    const { client } = makeClient();
    await client.init({
      rowIdField: 'id',
      columns: [{ colId: 'bid', field: 'bid', type: 'number' }],
    });
    await expect(
      client.setCalcProgram(makeProgram({ interpreterSource: 'not a function(' })),
    ).rejects.toThrow();
    // The failed request's id was consumed by the error reply; a follow-up
    // call gets a fresh id and must resolve normally.
    await expect(client.setCalcProgram(makeProgram())).resolves.toBeUndefined();
  });

  it('install(null) is idempotent through the client — calling it twice in a row both resolve cleanly', async () => {
    const { client } = makeClient();
    await client.init({
      rowIdField: 'id',
      columns: [{ colId: 'bid', field: 'bid', type: 'number' }],
    });
    await client.setCalcProgram(makeProgram());
    await expect(client.setCalcProgram(null)).resolves.toBeUndefined();
    // Second null install — the program is already removed; must not
    // throw, hang, or reject.
    await expect(client.setCalcProgram(null)).resolves.toBeUndefined();
  });
});
