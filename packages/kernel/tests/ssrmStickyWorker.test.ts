import { describe, it, expect } from 'vitest';
import { createWorkerHost } from '../src/worker/worker';
import { attachSsrmRowMeta } from '../src/core/ssrmRowMeta';
import type { StickyAncestor, WorkerRequest } from '../src/worker/protocol';

/**
 * Sparse SSRM sticky band — worker-level regression.
 *
 * The sparse path never ships `setGroupModel` to the worker (GroupPass
 * stays off; the host owns grouping), so the sticky-ancestor scan must be
 * gated by hydrated `__ssrm` group rows (`state.ssrmGroupMetaSeen`), not by
 * the worker group model. Regression: the gate read
 * `state.group.getModel().rowGroupCols.length > 0`, which is always 0 on
 * the sparse path — the band was unreachable.
 */

interface Reply {
  id?: number;
  type: string;
  stickyAncestors?: StickyAncestor[];
  [k: string]: unknown;
}

function makeHost(): {
  send: (msg: unknown) => void;
  waitFor: (id: number) => Promise<Reply>;
} {
  const replies: Reply[] = [];
  const host = createWorkerHost((msg) => {
    replies.push(msg as Reply);
  });
  const send = (msg: unknown): void => {
    host.handle(msg as WorkerRequest);
  };
  const waitFor = async (id: number): Promise<Reply> => {
    for (let i = 0; i < 200; i++) {
      const hit = replies.find((r) => r.id === id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error(`no worker reply for request ${id}`);
  };
  return { send, waitFor };
}

const columns = [
  { colId: 'desk', field: 'desk', type: 'text' as const },
  { colId: 'notional', field: 'notional', type: 'number' as const },
];

describe('sparse SSRM sticky band (worker)', () => {
  it('ships sticky ancestors from __ssrm meta with no group model set', async () => {
    const { send, waitFor } = makeHost();
    send({ id: 1, type: 'init', payload: { columns, rowIdField: 'id' } });
    await waitFor(1);

    const rows = [
      attachSsrmRowMeta(
        { id: 'g-fx', desk: 'FX', notional: 1000 },
        { kind: 'group', key: 'desk:FX', depth: 0, label: 'FX', childCount: 3, expanded: true },
      ),
      { id: 'l1', desk: 'FX', notional: 100 },
      { id: 'l2', desk: 'FX', notional: 200 },
      { id: 'l3', desk: 'FX', notional: 300 },
      attachSsrmRowMeta(
        { id: 'g-rates', desk: 'Rates', notional: 500 },
        { kind: 'group', key: 'desk:Rates', depth: 0, label: 'Rates', childCount: 1, expanded: false },
      ),
    ];
    send({ id: 2, type: 'ssrmHydrate', payload: { rowCount: 5, startRow: 0, rows, reset: true } });
    await waitFor(2);

    // Viewport scrolled past the FX group header — it must appear sticky.
    send({
      id: 3,
      type: 'getViewport',
      payload: { rowStart: 2, rowEnd: 5, columns: ['desk', 'notional'], stickyBoundaryRow: 2 },
    });
    const reply = await waitFor(3);
    expect(reply.type).toBe('viewport');
    expect(reply.stickyAncestors?.length).toBe(1);
    expect(reply.stickyAncestors?.[0]).toMatchObject({
      key: 'desk:FX',
      colId: 'desk',
      value: 'FX',
      depth: 0,
      isExpanded: true,
    });
  });

  it('flat sparse hydrate (no group meta) ships no sticky band', async () => {
    const { send, waitFor } = makeHost();
    send({ id: 1, type: 'init', payload: { columns, rowIdField: 'id' } });
    await waitFor(1);

    const rows = [
      { id: 'r1', desk: 'FX', notional: 100 },
      { id: 'r2', desk: 'FX', notional: 200 },
      { id: 'r3', desk: 'Rates', notional: 300 },
    ];
    send({ id: 2, type: 'ssrmHydrate', payload: { rowCount: 3, startRow: 0, rows, reset: true } });
    await waitFor(2);

    send({
      id: 3,
      type: 'getViewport',
      payload: { rowStart: 1, rowEnd: 3, columns: ['desk', 'notional'], stickyBoundaryRow: 1 },
    });
    const reply = await waitFor(3);
    expect(reply.stickyAncestors ?? []).toEqual([]);
  });

  it('a reset hydrate without group rows clears the sticky gate', async () => {
    const { send, waitFor } = makeHost();
    send({ id: 1, type: 'init', payload: { columns, rowIdField: 'id' } });
    await waitFor(1);

    const grouped = [
      attachSsrmRowMeta(
        { id: 'g-fx', desk: 'FX', notional: 1000 },
        { kind: 'group', key: 'desk:FX', depth: 0, label: 'FX', childCount: 1, expanded: true },
      ),
      { id: 'l1', desk: 'FX', notional: 100 },
    ];
    send({ id: 2, type: 'ssrmHydrate', payload: { rowCount: 2, startRow: 0, rows: grouped, reset: true } });
    await waitFor(2);

    // Ungrouped rebuild (e.g. group-by cleared → purge refresh).
    const flat = [
      { id: 'r1', desk: 'FX', notional: 100 },
      { id: 'r2', desk: 'Rates', notional: 200 },
    ];
    send({ id: 3, type: 'ssrmHydrate', payload: { rowCount: 2, startRow: 0, rows: flat, reset: true } });
    await waitFor(3);

    send({
      id: 4,
      type: 'getViewport',
      payload: { rowStart: 1, rowEnd: 2, columns: ['desk', 'notional'], stickyBoundaryRow: 1 },
    });
    const reply = await waitFor(4);
    expect(reply.stickyAncestors ?? []).toEqual([]);
  });
});
