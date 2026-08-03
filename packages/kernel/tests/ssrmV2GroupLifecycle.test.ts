import { describe, it, expect, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import type { WorkerRequest } from '../src/worker/protocol';
import type { IServerSideDatasourceV2 } from '../src/types/ssrm';

/**
 * SSRM v2 grouping lifecycle over a REAL flat book (the demo's actual flow):
 * flat data visible → user drags group chips in → grouped skeleton paints →
 * ungroup → flat again → regroup. At every step the painted model must
 * match the chip state — never flat rows under active grouping.
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

const DESKS = ['Credit', 'Rates'];
const REGIONS = ['AMER', 'EMEA'];
const BOOK: Row[] = Array.from({ length: 400 }, (_, i) => ({
  id: `P${String(i).padStart(4, '0')}`,
  desk: DESKS[i % 2]!,
  region: REGIONS[Math.floor(i / 2) % 2]!,
  notional: 1000 + i,
}));

class FakeWorker {
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
}

describe('SSRM v2 grouping lifecycle over a populated flat book', () => {
  it('flat → group → ungroup → regroup always matches the chip state', async () => {
    const origWorker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorker;

    const el = document.createElement('div');
    el.style.width = '800px';
    el.style.height = '400px';
    document.body.appendChild(el);

    const skeletonReqs: string[][] = [];
    let flatCalls = 0;
    const ds: IServerSideDatasourceV2<Row> = {
      getRows: ({ request, success }) => {
        flatCalls++;
        success({
          rowData: BOOK.slice(request.startRow, request.endRow),
          rowCount: BOOK.length,
        });
      },
      getGroupSkeleton: ({ request, success }) => {
        skeletonReqs.push([...request.rowGroupCols]);
        const cols = request.rowGroupCols;
        const rootVals = cols[0] === 'region' ? REGIONS : DESKS;
        const childVals = cols.length > 1 ? (cols[1] === 'desk' ? DESKS : REGIONS) : [];
        const groups = rootVals.flatMap((r) => [
          { path: [r], leafCount: 200, aggregates: { notional: 5000 } },
          ...childVals.map((c) => ({
            path: [r, c],
            leafCount: 100,
            aggregates: { notional: 2500 },
          })),
        ]);
        success({ groups });
      },
      getLeafRows: ({ request, success }) => {
        const [region, desk] = request.groupPath;
        const rows = BOOK.filter((r) => r.region === region && (desk === undefined || r.desk === desk));
        success({ rowData: rows.slice(request.startRow, request.endRow) });
      },
    };

    const grid = new CGrid<Row>(el, {
      columnDefs: [
        { field: 'desk', enableRowGroup: true },
        { field: 'region', enableRowGroup: true },
        { field: 'notional', type: 'number', aggFunc: 'sum' },
      ],
      getRowId: (r: Row) => r.id,
      rowModelType: 'serverSide',
      serverSideEnableClientSidePipeline: false,
      groupDefaultExpanded: 0,
      cacheBlockSize: 50,
      serverSideDatasource: ds,
    } as never);

    try {
      // Flat book paints first (the demo's startup state).
      await waitFor(
        () => flatCalls > 0 && grid.getDisplayedRowCount() === BOOK.length,
        `flat book visible (rows=${grid.getDisplayedRowCount?.()})`,
      );

      // Drag chips in: region, then desk (two separate adds, like the panel).
      grid.addRowGroupColumn('region');
      await waitFor(
        () => skeletonReqs.some((r) => r.length === 1 && r[0] === 'region'),
        'skeleton fetch for (region)',
      );
      grid.addRowGroupColumn('desk');
      await waitFor(
        () => skeletonReqs.some((r) => r.length === 2 && r[0] === 'region' && r[1] === 'desk'),
        'skeleton fetch for (region, desk)',
      );
      // Collapsed roots — 2 region groups, NOT flat rows.
      await waitFor(
        () => grid.getDisplayedRowCount() === 2,
        `grouped roots painted (rows=${grid.getDisplayedRowCount()})`,
      );

      // Ungroup entirely.
      grid.setRowGroupColumns([]);
      await waitFor(
        () => grid.getDisplayedRowCount() === BOOK.length,
        `flat book restored after ungroup (rows=${grid.getDisplayedRowCount()})`,
      );

      // Regroup — the reported failure mode: chips active but flat rows.
      const skeletonsBefore = skeletonReqs.length;
      grid.setRowGroupColumns(['region', 'desk']);
      await waitFor(
        () => skeletonReqs.length > skeletonsBefore,
        'skeleton refetched on regroup',
      );
      await waitFor(
        () => grid.getDisplayedRowCount() === 2,
        `grouped roots painted after regroup (rows=${grid.getDisplayedRowCount()})`,
      );
    } finally {
      grid.destroy();
      el.remove();
      (globalThis as { Worker?: unknown }).Worker = origWorker;
    }
  }, 20000);
});
