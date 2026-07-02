// Cycle 21d / Task 13 — calc program lifecycle verification.
//
// Confirms, black-box through the worker host (and one main-side case
// through CGrid), the claims made in the Task 13 brief:
//   1. program survives setRowData — a full data replace re-derives calc
//      values for the NEW rows (onSetRowData marks full-dirty; the
//      `setRowData` handler never touches `state.calc.install`).
//   2. program survives updateColumns — the `updateColumns` handler swaps
//      pass column metadata (filter/quickFilter/distinct/sort/group/
//      pivot/agg/slicer) and never touches `state.calc`; a getViewport
//      after the reship still ships calc values.
//   3. destroy teardown — WorkerClient.destroy() terminates the worker
//      unconditionally (no calc-specific worker-side teardown needed —
//      the whole worker dies); main-side, grid.destroy() runs Task 9's
//      calcProviderUnsub().
//   4. existing distinct-values tests are unmodified (git diff --stat
//      assertion is procedural — see Step 5 verification; this file just
//      re-runs distinctValuesPass.test.ts alongside as part of the gate).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest, WorkerResponse, WorkerPush, WorkerCalcProgram } from '../src/worker/protocol';
import { CGrid } from '../src/cgrid';
import { _resetCalcProvider_forTests, type CalcProviderShape } from '../src/core/calcSlot';

function makeHost() {
  const outbox: (WorkerResponse | WorkerPush)[] = [];
  const host = createWorkerHost((msg) => outbox.push(msg));
  return { host, outbox };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** `double` — row-local numeric calc column: `price * 2`. */
const DOUBLE_INTERP = `(function evaluateCalcAst(ast, row, aggSlots, prevLookup) {
  if (ast === null) return null;
  if (ast.kind === 'field') return row[ast.name] * 2;
  return null;
})`;

function doubleProgram(): WorkerCalcProgram {
  return {
    columns: [
      { colId: 'double', ast: { kind: 'field', name: 'price' }, prePass: [], cellDataType: 'number', usesPrev: false },
    ],
    interpreterSource: DOUBLE_INTERP,
    aggregateSources: [],
  };
}

function initReq(id: number): WorkerRequest {
  return {
    id, type: 'init',
    payload: {
      columns: [
        { colId: 'price', field: 'price', type: 'number' },
        { colId: 'double', type: 'number' },
      ],
      rowIdField: 'id',
    },
  } as unknown as WorkerRequest;
}

describe('calc program lifecycle — survives setRowData (Cycle 21d / Task 13)', () => {
  it('a full setRowData replace re-derives calc values for the NEW row set (onSetRowData marks full-dirty, never touches state.calc.install)', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();

    host.handle({ id: 2, type: 'setCalcProgram', payload: doubleProgram() } as WorkerRequest);
    await flush();

    host.handle({
      id: 3, type: 'setRowData',
      payload: { rows: [{ id: '1', price: 100 }, { id: '2', price: 200 }] },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 4, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 2, columns: ['price', 'double'] },
    } as unknown as WorkerRequest);
    await flush();
    const first = outbox.find((m) => 'id' in m && m.id === 4) as any;
    expect(Array.from(first.chunk.numericCols.double)).toEqual([200, 400]);

    // Full data replace with an ENTIRELY NEW row set — the program must
    // still be installed and compute fresh values for these new rows.
    host.handle({
      id: 5, type: 'setRowData',
      payload: { rows: [{ id: 'a', price: 10 }, { id: 'b', price: 20 }, { id: 'c', price: 30 }] },
    } as unknown as WorkerRequest);
    await flush();

    host.handle({
      id: 6, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 3, columns: ['price', 'double'] },
    } as unknown as WorkerRequest);
    await flush();
    const second = outbox.find((m) => 'id' in m && m.id === 6) as any;
    expect(Array.from(second.chunk.numericCols.double)).toEqual([20, 40, 60]);
  });
});

describe('calc program lifecycle — survives updateColumns (Cycle 21d / Task 13)', () => {
  it('updateColumns reshipping the column list does not clear the program; calc values still ship after the reship', async () => {
    const { host, outbox } = makeHost();
    host.handle(initReq(1));
    await flush();

    host.handle({ id: 2, type: 'setCalcProgram', payload: doubleProgram() } as WorkerRequest);
    await flush();

    host.handle({
      id: 3, type: 'setRowData',
      payload: { rows: [{ id: '1', price: 100 }, { id: '2', price: 200 }] },
    } as unknown as WorkerRequest);
    await flush();

    // Reship the same column list (e.g. a width/order-only change) — the
    // `updateColumns` handler swaps filter/quickFilter/distinct/sort/
    // group/pivot/agg/slicer column metadata but never touches state.calc.
    host.handle({
      id: 4, type: 'updateColumns',
      payload: {
        columns: [
          { colId: 'price', field: 'price', type: 'number' },
          { colId: 'double', type: 'number' },
        ],
      },
    } as unknown as WorkerRequest);
    await flush();
    const updateReply = outbox.find((m) => 'id' in m && m.id === 4) as any;
    expect(updateReply.type).toBe('rowCount');

    host.handle({
      id: 5, type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 2, columns: ['price', 'double'] },
    } as unknown as WorkerRequest);
    await flush();
    const reply = outbox.find((m) => 'id' in m && m.id === 5) as any;
    expect(Array.from(reply.chunk.numericCols.double)).toEqual([200, 400]);
  });
});

describe('calc provider teardown on grid.destroy() (Cycle 21d / Task 13)', () => {
  afterEach(() => _resetCalcProvider_forTests());

  it('grid.destroy() runs the calc provider unsubscribe (Task 9 slot); the calc module-level slot is intentionally NOT cleared', () => {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'cg-theme-quartz';
    document.body.appendChild(container);
    (globalThis as any).Worker = class {
      listeners: Array<(e: { data: any }) => void> = [];
      constructor(public url: URL) {}
      postMessage = vi.fn();
      addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
      terminate = vi.fn();
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

    const grid = new CGrid<{ id: string; px: number }>(container, {
      columnDefs: [{ field: 'id' }, { field: 'px' }],
      getRowId: (r) => r.id,
      theme: 'cg-theme-quartz',
    });

    const unsub = vi.fn();
    const provider: CalcProviderShape = {
      synthesizedColDefs: () => [],
      resolvedPatchFor: () => null,
      workerProgram: () => null,
      onColumnsChanged: () => unsub,
    };
    grid.registerCalcProvider(provider);
    expect(unsub).not.toHaveBeenCalled();

    grid.destroy();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
