// Cycle 14 / Task 3 — custom column-aggregation registry.
//
// Apps register agg funcs by name (`'p99' | 'weightedAvg' | …`) via
// `setGridOption('aggFuncs', { name: fn, … })` (or seed via the
// constructor option). Column defs reference the registered function by
// string (`aggFunc: 'p99'`). The agg pass runs on the worker; the
// function string-serialises across `postMessage` and reconstructs on
// the worker via `new Function(...)` — closure capture is detected on
// the MAIN thread before serialisation and rejected with a clear error
// pointing the app at the constraint.
//
// Built-in names (`sum / avg / min / max / count / first / last`) are
// pre-registered on the worker and bypass the wire format — column defs
// can reference them with zero registration.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import { AggFuncRegistry } from '../src/worker/aggFuncRegistry';
import { AggPass, RowStore } from '../src/worker/dataPipeline';
import type { WorkerColumn } from '../src/worker/protocol';
import type { IAggFunc } from '../src/types';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    host = createWorkerHost((msg) => {
      queueMicrotask(() => this.listeners.forEach((cb) => cb({ data: msg })));
    });
    constructor(public url: URL) {}
    postMessage(msg: any) { this.host.handle(msg); }
    addEventListener(_: string, cb: (e: { data: any }) => void) { this.listeners.push(cb); }
    terminate() {}
  };

  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    return () => fakeCtx as any;
  })() as any;
});

// 1 — Built-in `sum / avg / min / max / count / first / last` are
// pre-registered on a fresh registry. Apps don't have to opt in to use
// the canonical aggs, just reference the name on the column def.
describe('AggFuncRegistry — built-ins', () => {
  it('built-in sum / avg / min / max / count / first / last resolve out of the box', () => {
    const r = new AggFuncRegistry();
    expect(r.get('sum')).toBeTypeOf('function');
    expect(r.get('avg')).toBeTypeOf('function');
    expect(r.get('min')).toBeTypeOf('function');
    expect(r.get('max')).toBeTypeOf('function');
    expect(r.get('count')).toBeTypeOf('function');
    expect(r.get('first')).toBeTypeOf('function');
    expect(r.get('last')).toBeTypeOf('function');
  });

  // 2 — Built-ins delegate to aggMath.aggregate so the totals row and
  // the status-panel agg component cannot drift on NaN / Infinity
  // handling. Same input → same output as the panel.
  it('built-in sum / avg / min / max / count compute against the shared aggMath', () => {
    const r = new AggFuncRegistry();
    const values = [10, 20, 30];
    expect(r.get('sum')!({ values, colId: 'x' })).toBe(60);
    expect(r.get('avg')!({ values, colId: 'x' })).toBe(20);
    expect(r.get('min')!({ values, colId: 'x' })).toBe(10);
    expect(r.get('max')!({ values, colId: 'x' })).toBe(30);
    expect(r.get('count')!({ values, colId: 'x' })).toBe(3);
  });

  // 3 — first / last are trivial array accessors. Empty input returns
  // null (not undefined) so the value round-trips structured-clone.
  it('built-in first / last index into the values array; empty → null', () => {
    const r = new AggFuncRegistry();
    expect(r.get('first')!({ values: ['a', 'b', 'c'], colId: 'x' })).toBe('a');
    expect(r.get('last')!({ values: ['a', 'b', 'c'], colId: 'x' })).toBe('c');
    expect(r.get('first')!({ values: [], colId: 'x' })).toBeNull();
    expect(r.get('last')!({ values: [], colId: 'x' })).toBeNull();
  });

  // 4 — Numeric aggs over an empty value list. `aggMath` returns NaN
  // for avg / min / max (undefined for empty); the registry surfaces
  // that as `null` so the totals cell renders the placeholder instead
  // of literal `NaN`.
  it('avg / min / max over empty values → null (NaN-safe)', () => {
    const r = new AggFuncRegistry();
    expect(r.get('avg')!({ values: [], colId: 'x' })).toBeNull();
    expect(r.get('min')!({ values: [], colId: 'x' })).toBeNull();
    expect(r.get('max')!({ values: [], colId: 'x' })).toBeNull();
    // sum / count have natural zero defaults.
    expect(r.get('sum')!({ values: [], colId: 'x' })).toBe(0);
    expect(r.get('count')!({ values: [], colId: 'x' })).toBe(0);
  });
});

describe('AggFuncRegistry — register + resolve', () => {
  // 5 — Register a custom func by name; resolve returns the registered
  // callable. Custom names slot alongside built-ins.
  it('register(name, fn) → resolve(name) returns the registered function', () => {
    const r = new AggFuncRegistry();
    const median: IAggFunc<number, number> = ({ values }) => {
      if (values.length === 0) return 0;
      const s = [...values].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)]!;
    };
    r.register('median', median);
    const fn = r.resolve('median')!;
    expect(fn({ values: [3, 1, 2, 5, 4], colId: 'x' })).toBe(3);
  });

  // 6 — Custom registration with the same name as a built-in shadows
  // the built-in. Apps that want app-specific sum semantics (e.g.
  // ignoring negatives) can override `'sum'` without losing the other
  // built-ins.
  it('register("sum", customFn) overrides the built-in sum', () => {
    const r = new AggFuncRegistry();
    const absSum: IAggFunc<number, number> = ({ values }) =>
      values.reduce((s, v) => s + Math.abs(v), 0);
    r.register('sum', absSum);
    expect(r.get('sum')!({ values: [-10, -20, 30], colId: 'x' })).toBe(60);
  });

  // 7 — Unknown names return undefined. `AggPass` reads this and skips
  // emitting a `chunk.totals` entry for the column, so the totals row
  // paints the cell blank.
  it('resolve(unknownName) returns undefined', () => {
    const r = new AggFuncRegistry();
    expect(r.resolve('p99')).toBeUndefined();
    expect(r.get('p99')).toBeUndefined();
  });

  // 8 — Array form picks the FIRST entry that resolves. Apps can
  // declare an ordered fallback list on a column def
  // (`aggFunc: ['p99', 'avg']`) so unregistered names degrade
  // gracefully to a working built-in instead of dropping the column's
  // totals entry entirely.
  it('resolve(["p99", "avg"]) falls back to the first resolved name', () => {
    const r = new AggFuncRegistry();
    // 'p99' is unregistered; should fall through to 'avg'.
    const fn = r.resolve(['p99', 'avg'])!;
    expect(fn({ values: [10, 20, 30], colId: 'x' })).toBe(20);
  });

  // 9 — Empty array OR all-unknown list returns undefined. Same path
  // as a missing aggFunc declaration — the column gets no totals.
  it('resolve([]) and resolve(["unknownA", "unknownB"]) return undefined', () => {
    const r = new AggFuncRegistry();
    expect(r.resolve([])).toBeUndefined();
    expect(r.resolve(['unknownA', 'unknownB'])).toBeUndefined();
  });

  // 10 — replaceCustom swaps the entire custom layer at once. Mirrors
  // the `setGridOption('aggFuncs', { ... })` semantics — the new map
  // replaces the previous map wholesale. Built-ins are NOT touched.
  it('replaceCustom() wipes prior custom entries but preserves built-ins', () => {
    const r = new AggFuncRegistry();
    const first: IAggFunc = ({ values }) => values[0] ?? null;
    r.register('p50', first);
    expect(r.get('p50')).toBeTypeOf('function');
    r.replaceCustom({});
    expect(r.get('p50')).toBeUndefined();
    // Built-ins still resolve.
    expect(r.get('sum')!({ values: [1, 2], colId: 'x' })).toBe(3);
  });
});

// 11–13 — AggPass dispatches each column's aggFunc through the
// registry. Column field reads + value-array assembly stay inside the
// pass; the registry just supplies the reducer.
describe('AggPass dispatches through AggFuncRegistry', () => {
  const cols: WorkerColumn[] = [
    { colId: 'x', field: 'x', type: 'number', aggFunc: 'sum' },
    { colId: 'y', field: 'y', type: 'number', aggFunc: 'p99' },
    { colId: 'z', field: 'z', type: 'number', aggFunc: ['p99', 'avg'] },
    { colId: 'noagg', field: 'noagg', type: 'number' },
  ];

  function store() {
    const s = new RowStore('id');
    s.setAll([
      { id: '1', x: 1, y: 10, z: 100, noagg: 1 },
      { id: '2', x: 2, y: 20, z: 200, noagg: 2 },
      { id: '3', x: 3, y: 30, z: 300, noagg: 3 },
    ]);
    return s;
  }

  // 11 — Custom func registered → AggPass uses it. Verifies the
  // dispatch path beats the column's aggFunc string through resolve()
  // and applies the registered function to the filtered values.
  it('custom aggFunc registered on the registry computes the column total', () => {
    const reg = new AggFuncRegistry();
    reg.register('p99', ({ values }) => Math.max(...(values as number[])));
    const p = new AggPass(store(), cols, reg);
    const { totals } = p.apply(['1', '2', '3']);
    expect(totals.x).toBe(6);   // built-in sum
    expect(totals.y).toBe(30);  // custom p99 → max
  });

  // 12 — Column with no aggFunc gets no totals entry. The totals row
  // paints the cell blank for those columns; only aggFunc-declared
  // columns contribute.
  it('column without aggFunc declared produces no totals entry', () => {
    const p = new AggPass(store(), cols, new AggFuncRegistry());
    const { totals } = p.apply(['1', '2', '3']);
    expect(totals.noagg).toBeUndefined();
  });

  // 13 — Array-form aggFunc falls back to the second entry when the
  // first is unregistered.
  it('array-form aggFunc ["p99", "avg"] falls back to avg when p99 unregistered', () => {
    const reg = new AggFuncRegistry();
    // No 'p99' registration; resolution must skip to 'avg'.
    const p = new AggPass(store(), cols, reg);
    const { totals } = p.apply(['1', '2', '3']);
    expect(totals.z).toBe(200); // avg of [100, 200, 300]
  });

  // 14 — A custom func that THROWS shouldn't bring down the whole
  // viewport pass; the column simply emits no totals entry while the
  // rest of the chunk ships normally. Matches the defensive contract
  // the pass documents.
  it('a custom aggFunc that throws leaves the column empty and does not bubble', () => {
    const reg = new AggFuncRegistry();
    reg.register('p99', () => { throw new Error('boom'); });
    const p = new AggPass(store(), cols, reg);
    const { totals } = p.apply(['1', '2', '3']);
    expect(totals.x).toBe(6);          // sum still ships
    expect(totals.y).toBeUndefined();  // p99 swallowed
  });
});

// 15 — End-to-end across `postMessage`. Confirms the serialisation
// pathway (`Function.toString()` → `setAggFuncs` → `new Function()` on
// the worker) round-trips a custom func and `chunk.totals[colId]`
// reflects it on the next viewport reply.
describe('VelocityGrid.setGridOption("aggFuncs", ...) — end-to-end across postMessage', () => {
  function mkGrid(opts?: Parameters<typeof VelocityGrid>[1]) {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'vg-theme-quartz';
    document.body.appendChild(container);
    const grid = new VelocityGrid<{ id: string; price: number }>(container, {
      columnDefs: [
        { field: 'id' },
        { field: 'price', aggFunc: 'p99' },
      ],
      getRowId: (r) => r.id,
      rowData: [
        { id: 'r1', price: 10 },
        { id: 'r2', price: 20 },
        { id: 'r3', price: 30 },
      ],
      ...(opts ?? {}),
    });
    return { grid, container, cleanup: () => { grid.destroy(); container.remove(); } };
  }

  it('setGridOption("aggFuncs", { p99: fn }) propagates to the worker and the next chunk.totals reflects it', async () => {
    const t = mkGrid();
    // Let init + initial setRowData round-trip.
    await new Promise((r) => setTimeout(r, 30));
    // Use the pure-function form so the closure detector accepts.
    (t.grid as any).setGridOption('aggFuncs', {
      p99: ({ values }: { values: unknown[] }) => Math.max(...(values as number[])),
    });
    await new Promise((r) => setTimeout(r, 30));
    const client = (t.grid as any).workerClient;
    const { chunk } = await client.getViewport({
      rowStart: 0,
      rowEnd: 3,
      columns: ['id', 'price'],
    });
    expect(chunk.totals?.price).toBe(30);
    t.cleanup();
  });

  // 16 — Closure-over-outer-scope aggFunc fails fast at the
  // `setGridOption` call with a clear error pointing the app at the
  // constraint. The function would otherwise silently throw on the
  // worker (ReferenceError in the rebuilt scope); detecting on main
  // means the error rides out the call that registered the function.
  it('a closure-capturing aggFunc throws at setGridOption with a clear error', async () => {
    const t = mkGrid();
    await new Promise((r) => setTimeout(r, 30));
    // Force a closure by referencing a variable from this test's scope.
    // The reconstructed `new Function(...)` copy can't see it and will
    // throw on first invocation — which the main-side detector catches.
    let outerCutoff = 100;
    // The reference to `outerCutoff` inside the function body makes the
    // toString output reference an identifier the rebuilt copy can't
    // resolve, triggering the detector.
    void outerCutoff;
    expect(() => (t.grid as any).setGridOption('aggFuncs', {
      p99: ({ values }: { values: unknown[] }) =>
        (values as number[]).filter((v) => v < outerCutoff).reduce((a, b) => a + b, 0),
    })).toThrow(/closes over outer scope|pure/i);
    t.cleanup();
  });
});
