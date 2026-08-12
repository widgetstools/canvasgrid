/**
 * PORT-NOTE: NOT a copied legacy test — added by the worker port for
 * required refactor #2.
 *
 * `getViewport` has no cancellation: a request issued before a model
 * mutation is still answered afterwards, and its promise still resolves. The
 * main thread relies on that (an unresolved promise would wedge the paint
 * loop) and guards correctness with its own viewport epoch. Legacy left that
 * arrangement incidental — nothing in the worker named it, and the response
 * carried no way to tell a superseded chunk from a current one.
 *
 * The port makes it explicit: `worker/visibleModel.ts` owns cache
 * invalidation and a generation counter, and every `viewport` response is
 * stamped with the generation of the visible order it was sliced from. These
 * tests pin the parts of that contract a future edit could silently undo —
 * chiefly "a stale request still resolves" and "a rebuild that does not
 * change the model does not look like a change".
 */
import { describe, it, expect } from 'vitest';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest, WorkerResponse, WorkerPush } from '../src/worker/protocol';

interface Row { id: string; ticker: string; qty: number }

const ROWS: Row[] = [
  { id: 'a', ticker: 'AAPL', qty: 3 },
  { id: 'b', ticker: 'MSFT', qty: 1 },
  { id: 'c', ticker: 'GOOG', qty: 2 },
];

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

async function makeHost() {
  const outbox: (WorkerResponse | WorkerPush)[] = [];
  const host = createWorkerHost((msg) => outbox.push(msg));
  host.handle({
    id: 0, type: 'init',
    payload: {
      rowIdField: 'id',
      columns: [
        { colId: 'ticker', field: 'ticker', type: 'text' },
        { colId: 'qty', field: 'qty', type: 'number' },
      ],
    },
  } as WorkerRequest);
  await flush();
  host.handle({
    id: 1, type: 'setRowData', payload: { rows: ROWS, heightsByRowId: undefined },
  } as unknown as WorkerRequest);
  await flush();
  outbox.length = 0;
  return { host, outbox };
}

function viewportRequest(id: number): WorkerRequest {
  return {
    id, type: 'getViewport',
    payload: { rowStart: 0, rowEnd: 3, columns: ['ticker', 'qty'] },
  } as unknown as WorkerRequest;
}

function viewportReply(
  outbox: (WorkerResponse | WorkerPush)[],
  id: number,
): Extract<WorkerResponse, { type: 'viewport' }> {
  const reply = outbox.find((m) => (m as WorkerResponse).id === id) as WorkerResponse;
  expect(reply, `no reply for request ${id}`).toBeDefined();
  expect(reply.type).toBe('viewport');
  return reply as Extract<WorkerResponse, { type: 'viewport' }>;
}

describe('getViewport staleness contract', () => {
  it('stamps every viewport response with the generation of the order it sliced', async () => {
    const { host, outbox } = await makeHost();
    host.handle(viewportRequest(2));
    await flush();
    expect(typeof viewportReply(outbox, 2).visibleModelGeneration).toBe('number');
  });

  it('repeated requests against an unchanged model report the SAME generation', async () => {
    // The memoized fill in `visibleAsync` is not a model change. If it
    // advanced the counter, every scroll would look like an invalidation and
    // the main thread could not use the stamp to spot a superseded chunk.
    const { host, outbox } = await makeHost();
    host.handle(viewportRequest(2));
    await flush();
    host.handle(viewportRequest(3));
    await flush();
    expect(viewportReply(outbox, 3).visibleModelGeneration)
      .toBe(viewportReply(outbox, 2).visibleModelGeneration);
  });

  it('a sort mutation advances the generation', async () => {
    const { host, outbox } = await makeHost();
    host.handle(viewportRequest(2));
    await flush();
    const before = viewportReply(outbox, 2).visibleModelGeneration!;
    host.handle({
      id: 3, type: 'setSortModel', payload: [{ colId: 'qty', direction: 'asc' }],
    } as unknown as WorkerRequest);
    await flush();
    host.handle(viewportRequest(4));
    await flush();
    expect(viewportReply(outbox, 4).visibleModelGeneration!).toBeGreaterThan(before);
  });

  it('a request overtaken by a mutation STILL resolves, and is distinguishable as stale', async () => {
    // This is the contract, not an accident: the request is not cancelled and
    // the reply is not dropped, so the main thread's promise always settles.
    // What the port adds is that the reply is now *identifiable* as describing
    // an order the worker has already moved past.
    const { host, outbox } = await makeHost();
    host.handle(viewportRequest(2));
    host.handle({
      id: 3, type: 'setSortModel', payload: [{ colId: 'qty', direction: 'desc' }],
    } as unknown as WorkerRequest);
    await flush();

    const stale = viewportReply(outbox, 2);
    expect(stale.chunk.rowCount).toBe(3);

    host.handle(viewportRequest(4));
    await flush();
    const fresh = viewportReply(outbox, 4);
    expect(fresh.visibleModelGeneration!).toBeGreaterThan(stale.visibleModelGeneration!);
  });

  it('data, filter and group mutations each advance the generation', async () => {
    const { host, outbox } = await makeHost();
    const generationNow = async (id: number): Promise<number> => {
      host.handle(viewportRequest(id));
      await flush();
      return viewportReply(outbox, id).visibleModelGeneration!;
    };

    const g0 = await generationNow(10);

    host.handle({
      id: 11, type: 'setFilterModel',
      payload: { ticker: { filterType: 'text', type: 'contains', filter: 'A' } },
    } as unknown as WorkerRequest);
    await flush();
    const g1 = await generationNow(12);
    expect(g1).toBeGreaterThan(g0);

    host.handle({ id: 13, type: 'setFilterModel', payload: {} } as unknown as WorkerRequest);
    await flush();
    const g2 = await generationNow(14);
    expect(g2).toBeGreaterThan(g1);

    host.handle({
      id: 15, type: 'setGroupModel', payload: { rowGroupCols: ['ticker'] },
    } as unknown as WorkerRequest);
    await flush();
    const g3 = await generationNow(16);
    expect(g3).toBeGreaterThan(g2);

    host.handle({
      id: 17, type: 'setRowData',
      payload: { rows: [...ROWS, { id: 'd', ticker: 'TSLA', qty: 9 }], heightsByRowId: undefined },
    } as unknown as WorkerRequest);
    await flush();
    const g4 = await generationNow(18);
    expect(g4).toBeGreaterThan(g3);
  });
});
