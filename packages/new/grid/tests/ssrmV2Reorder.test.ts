import { describe, it, expect, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import type { IServerSideDatasourceV2 } from '../src/types/ssrm';

/**
 * SSRM v2 + row-group REORDER (panel drag / moveRowGroupColumn).
 *
 * Reordering group columns must (a) refetch the skeleton with the new
 * column order so the painted hierarchy flips, and (b) leave the refresh
 * pipeline alive — a subsequent soft refresh (live tick) must still reach
 * the datasource.
 */

beforeAll(() => {
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(_d?: string) {}
    };
  }
  HTMLCanvasElement.prototype.getContext = (() => ({
    scale() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    rect() {},
    fill() {},
    stroke() {},
    fillRect() {},
    clearRect() {},
    fillText() {},
    drawImage() {},
    measureText: () => ({ width: 0 }),
    setTransform() {},
    translate() {},
    clip() {},
    arc() {},
    canvas: { width: 1, height: 1 },
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

function waitFor(pred: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (pred()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timed out waiting for: ${label}`));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

interface Row {
  id: string;
  desk: string;
  region: string;
  notional: number;
}

describe('SSRM v2 group-column reorder', () => {
  it('reorder refetches the skeleton in the new order and refreshes keep flowing', async () => {
    const origWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker: unknown }).Worker = class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      private listeners = new Set<(e: MessageEvent) => void>();
      private host = createWorkerHost((msg) => {
        queueMicrotask(() => {
          const ev = { data: msg } as MessageEvent;
          this.onmessage?.(ev);
          for (const l of this.listeners) l(ev);
        });
      });
      postMessage(msg: unknown): void {
        this.host.handle(msg as WorkerRequest);
      }
      terminate(): void {}
      addEventListener(type: string, cb: (e: MessageEvent) => void): void {
        if (type === 'message') this.listeners.add(cb);
      }
      removeEventListener(type: string, cb: (e: MessageEvent) => void): void {
        this.listeners.delete(cb);
      }
    };

    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);

    const skeletonReqs: string[][] = [];
    const leafReqs: string[] = [];
    let flatCalls = 0;
    const ds: IServerSideDatasourceV2<Row> = {
      getRows: ({ success }) => {
        flatCalls++;
        success({ rowData: [], rowCount: 0 });
      },
      getGroupSkeleton: ({ request, success }) => {
        skeletonReqs.push([...request.rowGroupCols]);
        const first = request.rowGroupCols[0];
        const roots = first === 'desk' ? ['FX', 'Rates'] : ['AMER', 'EMEA'];
        const seconds = first === 'desk' ? ['AMER', 'EMEA'] : ['FX', 'Rates'];
        const groups = roots.flatMap((r) => [
          { path: [r], leafCount: 4, aggregates: { notional: 100 } },
          ...seconds.map((s) => ({
            path: [r, s],
            leafCount: 2,
            aggregates: { notional: 50 },
          })),
        ]);
        success({ groups });
      },
      getLeafRows: ({ request, success }) => {
        leafReqs.push(request.groupPath.join('/'));
        success({
          rowData: [
            { id: `${request.groupPath.join('-')}-1`, desk: 'x', region: 'y', notional: 1 },
            { id: `${request.groupPath.join('-')}-2`, desk: 'x', region: 'y', notional: 1 },
          ],
        });
      },
    };

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [
        { field: 'desk', enableRowGroup: true },
        { field: 'region', enableRowGroup: true },
        { field: 'notional', type: 'number', aggFunc: 'sum' },
      ],
      getRowId: (r: Row) => r.id,
      rowModelType: 'serverSide',
      serverSideEnableClientSidePipeline: false,
      groupDefaultExpanded: 0,
      cacheBlockSize: 10,
      serverSideDatasource: ds,
    } as never);

    let ready = false;
    grid.on('gridReady', () => {
      ready = true;
    });

    try {
      await waitFor(() => ready, 'gridReady');
      // The SSRM controller mounts during async construction — wait for the
      // first (ungrouped) getRows before driving grouping.
      await waitFor(() => flatCalls > 0, 'SSRM controller mounted (flat getRows)');

      // Group by desk → region.
      grid.setRowGroupColumns(['desk', 'region']);
      await waitFor(
        () => skeletonReqs.some((r) => r[0] === 'desk' && r[1] === 'region'),
        'initial skeleton fetch (desk, region)',
      );

      // Reorder via the same primitive the row-group panel drag uses.
      // (Splice semantics: `to` is the pre-pluck slot, so moving index 0
      // to the end of a 2-list is (0, 2).)
      grid.moveRowGroupColumn(0, 2);
      await waitFor(
        () => skeletonReqs.some((r) => r[0] === 'region' && r[1] === 'desk'),
        'skeleton refetch in the NEW order (region, desk)',
      );

      // Pipeline must still be alive: a live-tick style soft refresh has to
      // reach the datasource again.
      const before = skeletonReqs.length;
      grid.refreshServerSide({ purge: false });
      await waitFor(
        () => skeletonReqs.length > before,
        'soft refresh after reorder still reaches the datasource',
      );

      // And the painted model reflects the new order: root count for
      // region-first is 2 roots (AMER, EMEA) collapsed → visible rows = 2.
      await waitFor(
        () => grid.getDisplayedRowCount() === 2,
        `collapsed root rows after reorder (got ${grid.getDisplayedRowCount()})`,
      );
    } finally {
      grid.destroy();
      el.remove();
      (globalThis as { Worker?: unknown }).Worker = origWorker;
    }
  }, 15000);

  it('live ticks faster than the refresh pipeline must not starve a reorder (conflation)', async () => {
    const origWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker: unknown }).Worker = class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      private listeners = new Set<(e: MessageEvent) => void>();
      private host = createWorkerHost((msg) => {
        queueMicrotask(() => {
          const ev = { data: msg } as MessageEvent;
          this.onmessage?.(ev);
          for (const l of this.listeners) l(ev);
        });
      });
      postMessage(msg: unknown): void {
        this.host.handle(msg as WorkerRequest);
      }
      terminate(): void {}
      addEventListener(type: string, cb: (e: MessageEvent) => void): void {
        if (type === 'message') this.listeners.add(cb);
      }
      removeEventListener(type: string, cb: (e: MessageEvent) => void): void {
        this.listeners.delete(cb);
      }
    };

    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);

    const skeletonReqs: string[][] = [];
    let flatCalls = 0;
    // Skeleton responses take 40ms — deliberately SLOWER than the 5ms tick
    // interval below, which is the death-spiral condition: without
    // conflation the chain gains one queued op per tick and drains slower
    // than it grows, so a reorder queued at the tail lags by the whole
    // backlog (minutes, in a real session).
    const ds: IServerSideDatasourceV2<Row> = {
      getRows: ({ success }) => {
        flatCalls++;
        success({ rowData: [], rowCount: 0 });
      },
      getGroupSkeleton: ({ request, success }) => {
        skeletonReqs.push([...request.rowGroupCols]);
        const first = request.rowGroupCols[0];
        const roots = first === 'desk' ? ['FX', 'Rates'] : ['AMER', 'EMEA'];
        setTimeout(() => {
          success({ groups: roots.map((r) => ({ path: [r], leafCount: 3 })) });
        }, 40);
      },
      getLeafRows: ({ request, success }) => {
        success({
          rowData: [1, 2, 3].map((i) => ({
            id: `${request.groupPath.join('-')}-${i}`,
            desk: 'x',
            region: 'y',
            notional: i,
          })),
        });
      },
    };

    const grid = new VelocityGrid<Row>(el, {
      columnDefs: [
        { field: 'desk', enableRowGroup: true },
        { field: 'region', enableRowGroup: true },
        { field: 'notional', type: 'number', aggFunc: 'sum' },
      ],
      getRowId: (r: Row) => r.id,
      rowModelType: 'serverSide',
      serverSideEnableClientSidePipeline: false,
      groupDefaultExpanded: 0,
      cacheBlockSize: 10,
      serverSideDatasource: ds,
    } as never);

    let ticker: ReturnType<typeof setInterval> | null = null;
    try {
      await waitFor(() => flatCalls > 0, 'controller mounted');
      grid.setRowGroupColumns(['desk', 'region']);
      await waitFor(() => skeletonReqs.length > 0, 'initial skeleton');

      // Live feed: soft refresh every 5ms (8× faster than the datasource),
      // long enough to build a multi-second backlog without conflation.
      ticker = setInterval(() => {
        grid.refreshServerSide({ purge: false });
      }, 5);
      await new Promise((r) => setTimeout(r, 1200));

      // Reorder mid-stream — must reflect promptly despite the flood.
      grid.moveRowGroupColumn(0, 2);
      await waitFor(
        () => skeletonReqs.some((r) => r[0] === 'region'),
        'reorder skeleton refetch despite tick flood',
        1500,
      );

      // The queue must stay BOUNDED: with conflation at most one soft
      // refresh is pending at any time, so stopping the feed drains the
      // chain within a couple of ops. Without conflation every tick queued
      // an op (~200 pending here — unbounded lag in a real session) and
      // fetches keep firing long after the feed stops.
      clearInterval(ticker);
      ticker = null;
      await new Promise((r) => setTimeout(r, 200));
      const atStop = skeletonReqs.length;
      await new Promise((r) => setTimeout(r, 800));
      const drainedAfterStop = skeletonReqs.length - atStop;
      expect(drainedAfterStop).toBeLessThanOrEqual(3);
    } finally {
      if (ticker !== null) clearInterval(ticker);
      grid.destroy();
      el.remove();
      (globalThis as { Worker?: unknown }).Worker = origWorker;
    }
  }, 15000);
});
