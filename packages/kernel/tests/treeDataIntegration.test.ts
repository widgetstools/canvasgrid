import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { TREE_PATH_FIELD } from '../src/types/group';

/**
 * Tree data end to end through the public API: `treeData` + `getDataPath` on
 * the options, a real `setRowData`, and the hierarchy coming out the far side.
 *
 * The worker is faked (as in the other integration tests here), so what this
 * pins is the MAIN-THREAD half — path stamping, the group model the
 * coordinator ships, and the auto group column — which is exactly the part the
 * GroupPass unit tests cannot reach.
 */

beforeAll(() => {
  if (!(globalThis as any).__cgridFakeWorkerInstalled) {
    (globalThis as any).Worker = class {
      listeners: Array<(e: { data: any }) => void> = [];
      postedMessages: any[] = [];
      constructor(public url: URL) {}
      postMessage(msg: any): void { this.postedMessages.push(msg); }
      addEventListener = (_: string, cb: (e: { data: any }) => void) => { this.listeners.push(cb); };
      terminate = vi.fn();
    };
    HTMLCanvasElement.prototype.getContext = (() => {
      const ctx: any = {
        fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), save: vi.fn(),
        restore: vi.fn(), rect: vi.fn(), clip: vi.fn(), beginPath: vi.fn(),
        stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), setTransform: vi.fn(),
        clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
        measureText: () => ({ width: 50 }),
        fillStyle: '', strokeStyle: '', font: '', textBaseline: '', textAlign: '',
        lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter',
        miterLimit: 10, lineDashOffset: 0, shadowOffsetX: 0, shadowOffsetY: 0,
        shadowBlur: 0, shadowColor: '', globalCompositeOperation: 'source-over',
        imageSmoothingEnabled: true, direction: 'inherit', filter: 'none',
      };
      return () => ctx as any;
    })() as any;
    (globalThis as any).__cgridFakeWorkerInstalled = true;
  }
});

interface Row { id: string; name: string; size: number; path: string[] }

const ROWS: Row[] = [
  { id: 'a', name: 'Book 1', size: 10, path: ['FX', 'EMEA', 'Book 1'] },
  { id: 'b', name: 'Book 2', size: 20, path: ['FX', 'EMEA', 'Book 2'] },
  { id: 'c', name: 'Book 3', size: 30, path: ['FX', 'AMER', 'Book 3'] },
  { id: 'd', name: 'Solo', size: 40, path: ['Rates'] },
];

function mount(opts: Record<string, unknown> = {}) {
  const host = document.createElement('div');
  host.style.cssText = 'width:900px; height:600px;';
  host.className = 'vg-theme-quartz';
  document.body.appendChild(host);
  const grid = new VelocityGrid<Row>(host, {
    columnDefs: [
      { colId: 'name', field: 'name' },
      { colId: 'size', field: 'size', cellDataType: 'number' },
    ],
    getRowId: (r) => r.id,
    theme: 'vg-theme-quartz',
    ...opts,
  } as never);
  const worker = (grid as any).workerClient.worker;
  worker.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  return { grid, host, worker };
}

/** Every payload the grid posted to the worker, newest last. */
const posted = (worker: any, type: string): any[] =>
  worker.postedMessages.filter((m: any) => m?.type === type).map((m: any) => m.payload);

describe('path stamping', () => {
  it('stamps getDataPath onto rows heading into the worker', () => {
    const { grid, host, worker } = mount({
      treeData: true,
      getDataPath: (r: Row) => r.path,
    });
    grid.setRowData(ROWS);

    const rowsSent = posted(worker, 'setRowData').at(-1)?.rows ?? [];
    expect(rowsSent.length).toBe(4);
    expect(rowsSent[0][TREE_PATH_FIELD]).toEqual(['FX', 'EMEA', 'Book 1']);
    expect(rowsSent[3][TREE_PATH_FIELD]).toEqual(['Rates']);
    grid.destroy(); host.remove();
  });

  it('does not stamp when treeData is off', () => {
    // The option, not the presence of a callback, is what turns this on —
    // otherwise a host that defines getDataPath for later would silently pay
    // for it on every row.
    const { grid, host, worker } = mount({ getDataPath: (r: Row) => r.path });
    grid.setRowData(ROWS);
    const rowsSent = posted(worker, 'setRowData').at(-1)?.rows ?? [];
    expect(rowsSent[0][TREE_PATH_FIELD]).toBeUndefined();
    grid.destroy(); host.remove();
  });

  it('leaves the host row objects untouched', () => {
    // The grid copies rather than mutating: these objects belong to the app.
    const { grid, host } = mount({ treeData: true, getDataPath: (r: Row) => r.path });
    grid.setRowData(ROWS);
    expect((ROWS[0] as Record<string, unknown>)[TREE_PATH_FIELD]).toBeUndefined();
    grid.destroy(); host.remove();
  });

  it('survives a getDataPath that throws, dropping only that row from the tree', () => {
    const { grid, host, worker } = mount({
      treeData: true,
      getDataPath: (r: Row) => { if (r.id === 'b') throw new Error('nope'); return r.path; },
    });
    grid.setRowData(ROWS);
    const rowsSent = posted(worker, 'setRowData').at(-1)?.rows ?? [];
    expect(rowsSent.length).toBe(4);                              // row still shipped
    expect(rowsSent[1][TREE_PATH_FIELD]).toBeUndefined();          // but pathless
    expect(rowsSent[0][TREE_PATH_FIELD]).toEqual(['FX', 'EMEA', 'Book 1']);
    grid.destroy(); host.remove();
  });

  it('coerces path segments to strings', () => {
    const { grid, host, worker } = mount({
      treeData: true,
      getDataPath: () => [1, 2] as unknown as string[],
    });
    grid.setRowData([ROWS[0]!]);
    const rowsSent = posted(worker, 'setRowData').at(-1)?.rows ?? [];
    expect(rowsSent[0][TREE_PATH_FIELD]).toEqual(['1', '2']);
    grid.destroy(); host.remove();
  });
});

describe('the group model', () => {
  // Asserted on the model the coordinator HOLDS rather than on a posted
  // message: the worker dispatch is batched behind the coordinator and does
  // not surface through this fake. The model is what gets shipped, and the
  // GroupPass unit tests already cover what the worker does with it.
  it('carries the tree path field when treeData is on', async () => {
    const { grid, host } = mount({ treeData: true, getDataPath: (r: Row) => r.path });
    grid.setRowData(ROWS);
    await new Promise((r) => setTimeout(r, 0));
    const model = (grid as any).grouping.getGroupModel();
    expect(model.treePathField).toBe(TREE_PATH_FIELD);
    expect(model.rowGroupCols).toEqual([]);   // the tree IS the hierarchy
    grid.destroy(); host.remove();
  });

  it('omits it when treeData is off', async () => {
    const { grid, host } = mount({});
    grid.setRowGroupColumns(['name']);
    await new Promise((r) => setTimeout(r, 0));
    const model = (grid as any).grouping.getGroupModel();
    expect(model.treePathField).toBeUndefined();
    expect(model.rowGroupCols).toEqual(['name']);
    grid.destroy(); host.remove();
  });

  it('needs the option, not just the callback', async () => {
    const { grid, host } = mount({ getDataPath: (r: Row) => r.path });
    await new Promise((r) => setTimeout(r, 0));
    expect((grid as any).grouping.getGroupModel().treePathField).toBeUndefined();
    grid.destroy(); host.remove();
  });
});

describe('the auto group column', () => {
  it('mounts one column in tree mode with no rowGroupCols at all', async () => {
    // Row grouping derives the auto column from the grouped columns; a tree
    // has none, so this used to produce no column and the hierarchy had
    // nowhere to render.
    const { grid, host } = mount({ treeData: true, getDataPath: (r: Row) => r.path });
    grid.setRowData(ROWS);
    // The group model ships through a microtask + a worker promise, and the
    // auto column is rebuilt inside that call — let it settle.
    await new Promise((r) => setTimeout(r, 0));
    const autoCols = (grid as any).grouping.getAutoGroupColumns();
    expect(autoCols.length).toBe(1);
    grid.destroy(); host.remove();
  });

  it('honours autoGroupColumnDef, as row grouping does', async () => {
    const { grid, host } = mount({
      treeData: true,
      getDataPath: (r: Row) => r.path,
      autoGroupColumnDef: { headerName: 'Book hierarchy', width: 320 },
    });
    grid.setRowData(ROWS);
    // The group model ships through a microtask + a worker promise, and the
    // auto column is rebuilt inside that call — let it settle.
    await new Promise((r) => setTimeout(r, 0));
    const col = (grid as any).grouping.getAutoGroupColumns()[0];
    expect(col.headerName).toBe('Book hierarchy');
    expect(col.width).toBe(320);
    grid.destroy(); host.remove();
  });

  it('mounts no auto column when tree data is off and nothing is grouped', () => {
    const { grid, host } = mount({});
    grid.setRowData(ROWS);
    expect((grid as any).grouping.getAutoGroupColumns().length).toBe(0);
    grid.destroy(); host.remove();
  });
});
