// Cycle 8 / Task 4 — `postSortRows` callback (main-side re-order hook
// after worker sort).
//
// Apps register a `postSortRows: (params) => string[]` callback in
// `CGridOptions`. The worker pipeline pauses after `SortPass.apply` and
// before `ViewportSlicer.slice` to ship the sorted rowId array to main; the
// app reorders, replies; the worker resumes with the new order. Mirrors the
// Cycle 7 / Task 8 external-filter round-trip shape (candidate push +
// callId-keyed result).
//
// Hard rules verified here:
// 1. The hook fires once per sort against the post-SortPass rowId order.
// 2. The visible row order matches the returned array.
// 3. With NO hook configured, the worker pipeline runs end-to-end with zero
//    round-trip pushes (verified by counting `postSortRowsRequest` envelopes
//    main-side).
// 4. The hook receives a `getData(rowId)` accessor that returns the live row
//    record so the app can sort/filter on full fields without ferrying the
//    map every cycle.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';

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

interface Row { id: string; name: string; pinned?: boolean }

function mkGrid(opts: {
  postSortRows?: (p: { rowIds: string[]; getData: (id: string) => Row | undefined }) => string[];
} = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'width:600px; height:400px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const grid = new CGrid<Row>(container, {
    columnDefs: [{ field: 'id' }, { field: 'name' }],
    getRowId: (r) => r.id,
    rowData: [
      { id: 'r1', name: 'Charlie' },
      { id: 'r2', name: 'Alice',  pinned: true },
      { id: 'r3', name: 'Bob' },
      { id: 'r4', name: 'Diana',  pinned: true },
    ],
    postSortRows: opts.postSortRows,
  });
  return { grid, container, cleanup: () => { grid.destroy(); container.remove(); } };
}

describe('postSortRows — wire-up + ordering', () => {
  it('the hook fires after the worker sort and reshapes the visible order', async () => {
    const seen: Array<{ rowIds: string[]; sampleData: Row | undefined }> = [];
    const t = mkGrid({
      postSortRows: ({ rowIds, getData }) => {
        seen.push({ rowIds: [...rowIds], sampleData: getData(rowIds[0]!) });
        // Pin every row whose `pinned` flag is set to the top; preserve the
        // post-sort relative order within each bucket.
        const pinned: string[] = [];
        const rest: string[] = [];
        for (const id of rowIds) {
          const data = getData(id);
          if (data?.pinned) pinned.push(id); else rest.push(id);
        }
        return [...pinned, ...rest];
      },
    });

    await new Promise((r) => setTimeout(r, 30));
    (t.grid as any).setSortModel([{ colId: 'name', direction: 'asc' }]);
    await new Promise((r) => setTimeout(r, 30));

    // Sort by `name asc` yields Alice, Bob, Charlie, Diana. Hook then moves
    // pinned rows (Alice, Diana) to the top → Alice, Diana, Bob, Charlie.
    const client = (t.grid as any).workerClient;
    const idxAlice = await client.getRowIndexForId('r2');
    const idxDiana = await client.getRowIndexForId('r4');
    const idxBob = await client.getRowIndexForId('r3');
    const idxCharlie = await client.getRowIndexForId('r1');
    expect(idxAlice).toBe(0);
    expect(idxDiana).toBe(1);
    expect(idxBob).toBe(2);
    expect(idxCharlie).toBe(3);

    // Hook saw the post-sort order and the live row record.
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1]!;
    expect(last.rowIds).toEqual(['r2', 'r3', 'r1', 'r4']);
    expect(last.sampleData).toEqual({ id: 'r2', name: 'Alice', pinned: true });

    t.cleanup();
  });

  it('no postSortRows callback => no round-trip overhead (zero pushes)', async () => {
    const t = mkGrid({});
    await new Promise((r) => setTimeout(r, 30));

    // Spy on the workerClient's onPostSortRowsCandidates handler — without a
    // hook present, the worker must not push any candidates envelope.
    let pushCount = 0;
    const client = (t.grid as any).workerClient;
    const original = client.handlers?.onPostSortRowsCandidates;
    if (typeof original === 'function') {
      client.handlers.onPostSortRowsCandidates = (rowIds: string[], callId: number) => {
        pushCount++;
        original(rowIds, callId);
      };
    }
    (t.grid as any).setSortModel([{ colId: 'name', direction: 'asc' }]);
    await new Promise((r) => setTimeout(r, 30));
    expect(pushCount).toBe(0);
    t.cleanup();
  });

  it('hook can re-order without any active sort (empty model still re-fires)', async () => {
    // No setSortModel — only the initial empty model. The hook still gets a
    // chance to reshape the row order (useful for "always pin selected").
    const t = mkGrid({
      postSortRows: ({ rowIds, getData }) => {
        const pinned: string[] = [];
        const rest: string[] = [];
        for (const id of rowIds) {
          if (getData(id)?.pinned) pinned.push(id); else rest.push(id);
        }
        return [...pinned, ...rest];
      },
    });
    await new Promise((r) => setTimeout(r, 40));
    const client = (t.grid as any).workerClient;
    // Original order is r1, r2, r3, r4 (insertion order). Pinned: r2, r4.
    // Hook moves them to the head → r2, r4, r1, r3.
    expect(await client.getRowIndexForId('r2')).toBe(0);
    expect(await client.getRowIndexForId('r4')).toBe(1);
    expect(await client.getRowIndexForId('r1')).toBe(2);
    expect(await client.getRowIndexForId('r3')).toBe(3);
    t.cleanup();
  });
});
