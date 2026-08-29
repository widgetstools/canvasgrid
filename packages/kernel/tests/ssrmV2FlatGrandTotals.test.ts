import { describe, it, expect } from 'vitest';
import {
  ServerSideRowModelV2Controller,
  type SsrmHostV2,
} from '../src/core/serverSideRowModelV2';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import type { IServerSideDatasourceV2 } from '../src/types/ssrm';
import type { FilterModel, SortModel } from '../src/types';

/**
 * Flat (ungrouped) sparse SSRM grand totals.
 *
 * Grouped mode gets its grand totals from the skeleton's `path: []` root on
 * every soft refresh (`ingestSkeleton` → `setGrandTotals`). Flat mode has no
 * skeleton, so the datasource carries them on the `getRows` reply instead —
 * and a live tick (`refreshServerSide({ purge: false })`) must re-apply them,
 * or the pinned grand-total row paints the first value it ever saw while the
 * rows beneath it tick.
 */

interface Row { id: string; notional: number }

function build(totalsSeq: number[]) {
  const events: Array<[string, unknown]> = [];
  let call = 0;

  const host: SsrmHostV2<Row> = {
    getRowId: (r) => r.id,
    getSortModel: () => [] as unknown as SortModel,
    getFilterModel: () => ({}) as FilterModel,
    getRowGroupCols: () => [],            // ← FLAT
    getExpandedGroupKeys: () => [],
    setGroupKeys: () => {},
    setGrandTotals: (totals) => events.push(['grandTotals', totals]),
    setRowCount: (count) => events.push(['rowCount', count]),
    getRefreshRange: () => ({ rowStart: 0, rowEnd: 20 }),
    hydrateWindow: async () => {},
    applyTransaction: () => {},
    requestViewport: () => {},
    isDestroyed: () => false,
  };

  const ds: IServerSideDatasourceV2<Row> = {
    getRows: ({ success }) => {
      const notional = totalsSeq[Math.min(call, totalsSeq.length - 1)]!;
      call++;
      success({
        rowData: [{ id: 'r1', notional: 1 }, { id: 'r2', notional: 2 }],
        rowCount: 2,
        grandTotals: { notional },
      });
    },
    // Present so the controller takes the v2 path; never called when flat.
    getGroupSkeleton: ({ success }) => success({ groups: [] }),
    getLeafRows: ({ success }) => success({ rowData: [] }),
  };

  const ctrl = new ServerSideRowModelV2Controller<Row>(host, { cacheBlockSize: 100 });
  ctrl.setDatasource(ds);
  return { ctrl, events, getRowsCalls: () => call };
}

const totalsSeen = (events: Array<[string, unknown]>): unknown[] =>
  events.filter((e) => e[0] === 'grandTotals').map((e) => e[1]);

describe('sparse SSRM v2 — flat-mode grand totals', () => {
  it('ships grand totals from the getRows reply on first load', async () => {
    const { ctrl, events } = build([100]);
    await ctrl.ensureRange(0, 20);
    expect(totalsSeen(events)).toContainEqual({ notional: 100 });
  });

  it('re-applies grand totals on a live tick (soft refresh)', async () => {
    const { ctrl, events } = build([100, 250]);
    await ctrl.ensureRange(0, 20);
    events.length = 0;

    // A live tick — what StompPerspectiveProvider issues on every batch.
    await ctrl.refresh({ purge: false });

    expect(totalsSeen(events)).toContainEqual({ notional: 250 });
  });
});

/**
 * The worker half, driven with the exact message sequence a flat tick
 * produces: totals first (fire-and-forget from `setGrandTotals`), then the
 * hydrate for the reloaded block, then the viewport request. postMessage is
 * FIFO, so the override must be in place by the time the chunk is built.
 */
describe('sparse SSRM v2 — flat-mode grand totals reach the viewport chunk', () => {
  it('a second tick ships the NEW totals, not the first ones', async () => {
    const replies: Array<{ id?: number; type: string; chunk?: { totals?: Record<string, number> } }> = [];
    const host = createWorkerHost((msg) => { replies.push(msg as never); });
    const send = (m: unknown): void => host.handle(m as WorkerRequest);
    const waitFor = async (id: number): Promise<(typeof replies)[number]> => {
      for (let i = 0; i < 300; i++) {
        const hit = replies.find((r) => r.id === id);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 0));
      }
      throw new Error(`no reply ${id}`);
    };

    send({
      id: 1, type: 'init',
      payload: {
        columns: [{ colId: 'notional', field: 'notional', type: 'number', aggFunc: 'sum' }],
        rowIdField: 'id',
      },
    });
    await waitFor(1);

    // ── first load ──────────────────────────────────────────────────
    send({ id: 2, type: 'ssrmSetGrandTotals', payload: { totals: { notional: 100 } } });
    await waitFor(2);
    send({
      id: 3, type: 'ssrmHydrate',
      payload: { rowCount: 2, startRow: 0, rows: [{ id: 'r1', notional: 1 }, { id: 'r2', notional: 2 }], reset: true },
    });
    await waitFor(3);
    send({ id: 4, type: 'getViewport', payload: { rowStart: 0, rowEnd: 2, columns: ['notional'] } });
    expect((await waitFor(4)).chunk?.totals?.notional).toBe(100);

    // ── live tick: same rows, new totals ────────────────────────────
    send({ id: 5, type: 'ssrmSetGrandTotals', payload: { totals: { notional: 250 } } });
    await waitFor(5);
    send({
      id: 6, type: 'ssrmHydrate',
      payload: { rowCount: 2, startRow: 0, rows: [{ id: 'r1', notional: 3 }, { id: 'r2', notional: 4 }], reset: false },
    });
    await waitFor(6);
    send({ id: 7, type: 'getViewport', payload: { rowStart: 0, rowEnd: 2, columns: ['notional'] } });
    // AggPass over the hydrated window would say 7; the host truth is 250.
    expect((await waitFor(7)).chunk?.totals?.notional).toBe(250);
  });
});
