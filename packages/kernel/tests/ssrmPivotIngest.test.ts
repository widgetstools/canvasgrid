import { describe, it, expect } from 'vitest';
import { createWorkerHost } from '../src/worker/worker';
import {
  encodePivotValueKey, PIVOT_PATH_SEP, PIVOT_ROW_TOTAL_PATH_MARKER,
} from '../src/worker/passes/pivotPass';
import type { WorkerRequest, WorkerResponse, SsrmPivotResult } from '../src/worker/protocol';

/**
 * Sparse-SSRM pivot ingest.
 *
 * `buildVisibleAsync` early-returns on the sparse path BEFORE PivotPass, so
 * `state.pivotOut` is always null there and no pivot ever reached the chunk.
 * A datasource that pivots natively (Perspective `split_by`) pushes its
 * cross-tab through `ssrmSetPivotResult` instead; these tests pin that it
 * lands on the chunk in exactly the shape PivotPass would have produced, and
 * that it never shadows PivotPass when the client pipeline owns the matrix.
 */

const COLUMNS = [
  { colId: 'desk', field: 'desk', type: 'text' as const },
  { colId: 'pnl', field: 'pnl', type: 'number' as const, aggFunc: 'sum' },
];

function makeHost() {
  const replies: WorkerResponse[] = [];
  const host = createWorkerHost((msg) => { replies.push(msg as WorkerResponse); });
  let nextId = 1;
  const send = async <T = WorkerResponse>(req: Omit<WorkerRequest, 'id'>): Promise<T> => {
    const id = nextId++;
    host.handle({ ...req, id } as WorkerRequest);
    for (let i = 0; i < 100; i++) {
      const hit = replies.find((r) => (r as { id?: number }).id === id);
      if (hit) return hit as T;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error(`no reply for ${req.type}`);
  };
  return { send };
}

/** A two-column cross-tab over one group, in the kernel's own key encoding. */
function makePivotResult(): SsrmPivotResult {
  const values = new Map<string, unknown>();
  const gk = 'desk:Rates';
  values.set(encodePivotValueKey(gk, 'EMEA', 'pnl'), 10);
  values.set(encodePivotValueKey(gk, 'AMER', 'pnl'), 20);
  // Row total bucket — what the synthesized row-total column reads.
  values.set(encodePivotValueKey(gk, PIVOT_ROW_TOTAL_PATH_MARKER, 'pnl'), 30);
  // Grand total (groupKey '') — what the pinned totals subgrid reads.
  values.set(encodePivotValueKey('', 'EMEA', 'pnl'), 10);
  return {
    keyTree: [
      { value: 'AMER', path: ['AMER'], children: [] },
      { value: 'EMEA', path: ['EMEA'], children: [] },
    ],
    leafPaths: [['AMER'], ['EMEA']],
    values,
  };
}

/** Put the worker on the sparse SSRM path (what ssrmHydrate does). */
async function enterSparseSsrm(send: ReturnType<typeof makeHost>['send']): Promise<void> {
  await send({ type: 'init', payload: { columns: COLUMNS, rowIdField: 'id' } } as never);
  await send({
    type: 'ssrmHydrate',
    payload: {
      rowCount: 2,
      startRow: 0,
      rows: [{ id: 'a', desk: 'Rates', pnl: 10 }, { id: 'b', desk: 'Rates', pnl: 20 }],
      reset: true,
    },
  } as never);
}

const VIEWPORT = {
  type: 'getViewport',
  payload: { rowStart: 0, rowEnd: 2, columns: ['desk', 'pnl'] },
} as unknown as Omit<WorkerRequest, 'id'>;

interface ViewportReply {
  chunk: {
    pivotColumnTree?: unknown[];
    pivotLeafPaths?: string[][];
    pivotValues?: Map<string, unknown>;
    pivotMaxColumnsReached?: { generatedColumns: number; cap: number };
  };
}

describe('sparse SSRM — host-supplied pivot cross-tab', () => {
  it('stamps a pushed result onto the chunk', async () => {
    const { send } = makeHost();
    await enterSparseSsrm(send);

    // Before any push the sparse path carries no pivot at all.
    const before = await send<ViewportReply>(VIEWPORT);
    expect(before.chunk.pivotColumnTree).toBeUndefined();
    expect(before.chunk.pivotValues).toBeUndefined();

    const result = makePivotResult();
    await send({ type: 'ssrmSetPivotResult', payload: { result } } as never);

    const after = await send<ViewportReply>(VIEWPORT);
    expect(after.chunk.pivotColumnTree).toEqual(result.keyTree);
    expect(after.chunk.pivotLeafPaths).toEqual(result.leafPaths);
    expect(after.chunk.pivotValues?.get(
      encodePivotValueKey('desk:Rates', 'EMEA', 'pnl'),
    )).toBe(10);
  });

  it('keeps serving the matrix across repeated viewport fetches', async () => {
    const { send } = makeHost();
    await enterSparseSsrm(send);
    await send({ type: 'ssrmSetPivotResult', payload: { result: makePivotResult() } } as never);

    for (let i = 0; i < 3; i++) {
      const reply = await send<ViewportReply>(VIEWPORT);
      expect(reply.chunk.pivotValues?.size).toBe(4);
    }
  });

  it('null clears it', async () => {
    const { send } = makeHost();
    await enterSparseSsrm(send);
    await send({ type: 'ssrmSetPivotResult', payload: { result: makePivotResult() } } as never);
    expect((await send<ViewportReply>(VIEWPORT)).chunk.pivotColumnTree).toBeDefined();

    await send({ type: 'ssrmSetPivotResult', payload: { result: null } } as never);
    const cleared = await send<ViewportReply>(VIEWPORT);
    expect(cleared.chunk.pivotColumnTree).toBeUndefined();
    expect(cleared.chunk.pivotValues).toBeUndefined();
  });

  it('carries a producer-side max-columns refusal through to the chunk', async () => {
    const { send } = makeHost();
    await enterSparseSsrm(send);
    await send({
      type: 'ssrmSetPivotResult',
      payload: {
        result: {
          keyTree: [], leafPaths: [], values: new Map(),
          maxColumnsReached: { generatedColumns: 9000, cap: 5000 },
        },
      },
    } as never);

    const reply = await send<ViewportReply>(VIEWPORT);
    expect(reply.chunk.pivotMaxColumnsReached).toEqual({ generatedColumns: 9000, cap: 5000 });
  });

  it('does NOT shadow PivotPass once the client pipeline is on', async () => {
    const { send } = makeHost();
    await enterSparseSsrm(send);
    await send({ type: 'ssrmSetPivotResult', payload: { result: makePivotResult() } } as never);
    expect((await send<ViewportReply>(VIEWPORT)).chunk.pivotColumnTree).toBeDefined();

    // Pipeline on → PivotPass owns the matrix; a stale host push must not win.
    await send({ type: 'ssrmSetClientPipeline', payload: { enabled: true } } as never);
    const reply = await send<ViewportReply>(VIEWPORT);
    expect(reply.chunk.pivotColumnTree).toBeUndefined();
  });

  it('is dropped by setRowData — group keys belong to the replaced dataset', async () => {
    const { send } = makeHost();
    await enterSparseSsrm(send);
    await send({ type: 'ssrmSetPivotResult', payload: { result: makePivotResult() } } as never);

    await send({
      type: 'setRowData',
      payload: { rows: [{ id: 'x', desk: 'Credit', pnl: 5 }] },
    } as never);

    const reply = await send<ViewportReply>({
      type: 'getViewport',
      payload: { rowStart: 0, rowEnd: 1, columns: ['desk', 'pnl'] },
    } as never);
    expect(reply.chunk.pivotColumnTree).toBeUndefined();
  });

  it('exports the key helpers hosts need, with PivotPass semantics', () => {
    // A host in another package must be able to key the map identically —
    // these are the exported primitives it uses.
    expect(PIVOT_ROW_TOTAL_PATH_MARKER).toBe('\x02');
    const joined = ['EMEA', 'Rates'].join(PIVOT_PATH_SEP);
    expect(encodePivotValueKey('g', joined, 'pnl'))
      .toBe(encodePivotValueKey('g', `EMEA${PIVOT_PATH_SEP}Rates`, 'pnl'));
    // Distinct paths must never collide.
    expect(encodePivotValueKey('g', 'A', 'pnl')).not.toBe(encodePivotValueKey('g', 'B', 'pnl'));
    expect(encodePivotValueKey('g1', 'A', 'pnl')).not.toBe(encodePivotValueKey('g2', 'A', 'pnl'));
  });
});
