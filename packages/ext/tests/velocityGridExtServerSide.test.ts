import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGridExt } from '../src/velocityGridExt';
// Test-only cross-package import: the real worker host, so VelocityGrid's async
// init actually completes and the SSRM controller mounts. `installGridTestEnv`'s
// no-op Worker never replies, which would hang init before the mount.
import { createWorkerHost } from '../../kernel/src/worker/worker';
import type { IServerSideDatasourceV2 } from '@wellsfargo-starui/velocity-grid';

// Proves the SSRM blotter grid works when wrapped in VelocityGridExt. VelocityGridExt
// is a thin shell over VelocityGrid — it spreads every non-`ext` option into
// `new VelocityGrid(...)` — so `rowModelType: 'serverSide'` + a datasource +
// grouping / grandTotalRow / autoGroupColumnDef must flow straight
// through and mount + drive the SSRM controller, exactly as the
// standalone blotterHost does.

interface Row { id: string; region: string; desk: string; notional: number }

beforeAll(() => {
  installGridTestEnv();
  // happy-dom lacks Path2D; the group cell renderer's chevron drawIcon
  // constructs one during paint. Stub it so paints don't throw.
  if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
    (globalThis as { Path2D?: unknown }).Path2D = class { constructor(_d?: string) {} };
  }
});
beforeEach(() => localStorage.clear());

let origWorker: unknown;
beforeEach(() => {
  origWorker = (globalThis as { Worker?: unknown }).Worker;
  // A FakeWorker backed by the REAL worker host — replies to every
  // protocol message so init settles and the controller mounts/fetches.
  (globalThis as { Worker: unknown }).Worker = class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    private listeners = new Set<(e: MessageEvent) => void>();
    private host = createWorkerHost((msg: unknown) => {
      queueMicrotask(() => {
        const ev = { data: msg } as MessageEvent;
        this.onmessage?.(ev);
        for (const l of this.listeners) l(ev);
      });
    });
    postMessage(msg: unknown): void { this.host.handle(msg as never); }
    terminate(): void {}
    addEventListener(type: string, cb: (e: MessageEvent) => void): void {
      if (type === 'message') this.listeners.add(cb);
    }
    removeEventListener(_: string, cb: (e: MessageEvent) => void): void {
      this.listeners.delete(cb);
    }
  };
});
afterEach(() => { (globalThis as { Worker?: unknown }).Worker = origWorker; });

function waitFor(pred: () => boolean, label: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (pred()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timed out: ${label}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

// v2 (client-owned skeleton) datasource — detected by getGroupSkeleton.
function v2Datasource(counters?: { flat: () => void; skeleton: (cols: string[]) => void }) {
  const ds: IServerSideDatasourceV2<Row> = {
    getRows: ({ success }) => { counters?.flat(); success({ rowData: [], rowCount: 0 }); },
    getGroupSkeleton: ({ request, success }) => {
      counters?.skeleton([...request.rowGroupCols]);
      const roots = ['AMER', 'EMEA'];
      const groups = roots.map((r) => ({ path: [r], leafCount: 2, aggregates: { notional: 100 } }));
      success({ groups });
    },
    getLeafRows: ({ request, success }) => {
      success({ rowData: [{ id: `${request.groupPath.join('-')}-1`, region: 'x', desk: 'y', notional: 1 }] });
    },
  };
  return ds;
}
function v1Datasource() {
  return { getRows: ({ success }: any) => success({ rowData: [], rowCount: 0 }) };
}

// Mirrors the demo blotter's option shape (blotterHost.ts).
function ssrmOptions(datasource: unknown) {
  return {
    getRowId: (r: Row) => r.id,
    columnDefs: [
      { field: 'region', enableRowGroup: true },
      { field: 'desk', enableRowGroup: true },
      { field: 'notional', type: 'number', aggFunc: 'sum' },
    ],
    rowModelType: 'serverSide',
    serverSideDatasource: datasource,
    serverSideEnableClientSidePipeline: false,
    cacheBlockSize: 100,
    maxConcurrentDatasourceRequests: 2,
    rowGroupPanelShow: 'always',
    groupDefaultExpanded: 0,
    grandTotalRow: 'pinnedBottom',
    autoGroupColumnDef: {
      cellRendererParams: {
        totalValueGetter: (p: { isGrandTotal: boolean; value: string }) =>
          p.isGrandTotal ? 'Grand Total' : `Total ${p.value}`,
      },
    },
    groupDisplayType: 'singleColumn',
    statusBar: {
      statusPanels: [
        { statusPanel: 'agTotalAndFilteredRowCountComponent' },
        { statusPanel: 'agSelectedRowCountComponent' },
      ],
    },
  } as never;
}

describe('VelocityGridExt — server-side (SSRM) blotter grid', () => {
  it('mounts + drives the v2 SSRM controller through the shell wrapper', async () => {
    const host = document.createElement('div');
    host.style.width = '800px'; host.style.height = '400px';
    document.body.appendChild(host);
    let flat = 0; const skel: string[][] = [];
    const ext = new VelocityGridExt<Row>(host, ssrmOptions(
      v2Datasource({ flat: () => { flat++; }, skeleton: (c) => skel.push(c) }),
    ));

    // Shell + grid are live.
    expect(host.querySelector('.vgext-grid')).toBeTruthy();
    expect(ext.grid).toBeTruthy();

    // serverSide flowed through, mounted the controller, and drove the
    // datasource — v2 detected from the getGroupSkeleton shape.
    await waitFor(() => flat > 0, 'controller mounted (flat getRows fired)');
    expect((ext.grid as any).ssrmV2).toBe(true);

    // Group through the exposed grid API → skeleton fetch in group order.
    ext.grid.setRowGroupColumns(['region', 'desk']);
    await waitFor(() => skel.some((r) => r[0] === 'region' && r[1] === 'desk'), 'skeleton fetch');
    await waitFor(() => ext.grid.getDisplayedRowCount() === 2, 'two collapsed roots');

    ext.destroy();
  }, 15000);

  it('detects a v1 datasource (getRows only) through the wrapper', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let flat = 0;
    const ds = v1Datasource();
    const spied = { ...ds, getRows: (p: any) => { flat++; return (ds.getRows as any)(p); } };
    const ext = new VelocityGridExt<Row>(host, ssrmOptions(spied));
    await waitFor(() => flat > 0, 'v1 controller mounted');
    expect((ext.grid as any).ssrmV2).toBe(false);
    ext.destroy();
  }, 15000);

  it('round-trips grouping + expansion state through the profiles/state layer', async () => {
    const host = document.createElement('div');
    host.style.width = '800px'; host.style.height = '400px';
    document.body.appendChild(host);
    let flat = 0; const skel: string[][] = [];
    const ext = new VelocityGridExt<Row>(host, ssrmOptions(
      v2Datasource({ flat: () => { flat++; }, skeleton: (c) => skel.push(c) }),
    ));
    await waitFor(() => flat > 0, 'controller mounted');

    ext.grid.setRowGroupColumns(['region', 'desk']);
    await waitFor(() => skel.some((r) => r[0] === 'region'), 'grouped');
    ext.grid.setExpanded('region:AMER', true);

    const snap = ext.getState();
    expect(snap.rowGroupColumns).toEqual(['region', 'desk']);
    expect(snap.expandedRouteIds).toContain('region:AMER');

    ext.destroy();
  }, 15000);
});
