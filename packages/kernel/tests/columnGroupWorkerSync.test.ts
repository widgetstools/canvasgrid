import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import type { CColDef, CColGroupDef } from '../src/types';

/**
 * Cycle 28 regression — toggling a column group must re-ship the worker's
 * column metadata BEFORE re-fetching the viewport chunk.
 *
 * `workerColumns()` starts from the VISIBLE column order, so a leaf hidden
 * at init time (grid booted with its group collapsed, e.g. from saved
 * state) is absent from the worker's colIndex. Expanding the group then
 * requested values for a column the worker didn't know, leaving its cells
 * permanently blank (user report: "market value column doesn't show its
 * values"). The fix routes the group-state change through
 * `updateColumns(workerColumns())` → `requestViewport()`, mirroring the
 * `setColumnsVisible` / column-move paths.
 */
beforeAll(() => {
  if (!(globalThis as any).__cgridFakeWorkerInstalled) {
    (globalThis as any).Worker = class {
      listeners: Array<(e: { data: any }) => void> = [];
      postedMessages: any[] = [];
      constructor(public url: URL) {}
      postMessage(msg: any): void { this.postedMessages.push(msg); }
      addEventListener = (_: string, cb: (e: { data: any }) => void) => {
        this.listeners.push(cb);
      };
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
    (globalThis as any).__cgridFakeWorkerInstalled = true;
  }
});

function mount(columnDefs: (CColDef | CColGroupDef)[]) {
  const el = document.createElement('div');
  el.style.cssText = 'width:800px; height:600px;';
  document.body.appendChild(el);
  return new VelocityGrid(el, { columnDefs, rowData: [], getRowId: (r: any) => r.id });
}

describe('column-group toggle re-ships worker columns', () => {
  it('expanding a group booted closed sends the revealed leaf to the worker before the chunk re-fetch', async () => {
    const grid = mount([
      { colId: 'a', field: 'a' },
      {
        groupId: 'G', headerName: 'Grp', openByDefault: false,
        children: [
          { colId: 'b', field: 'b' },
          { colId: 'c', field: 'c', columnGroupShow: 'open' }, // hidden at boot
        ],
      },
    ]);
    const coord = (grid as any).workerCoord;
    const updateSpy = vi.spyOn(coord, 'updateColumns');
    const api = (grid as any).makeApi();

    api.setColumnGroupState([{ groupId: 'G', open: true }]);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const shipped = updateSpy.mock.calls[0]![0] as Array<{ colId: string }>;
    expect(shipped.map((c) => c.colId)).toContain('c');
    grid.destroy();
  });

  it('collapsing back also re-syncs (revealed "closed" leaves ride the same path)', () => {
    const grid = mount([
      {
        groupId: 'G', headerName: 'Grp', openByDefault: true,
        children: [
          { colId: 'b', field: 'b' },
          { colId: 'c', field: 'c', columnGroupShow: 'closed' },
        ],
      },
    ]);
    const coord = (grid as any).workerCoord;
    const updateSpy = vi.spyOn(coord, 'updateColumns');
    const api = (grid as any).makeApi();

    api.setColumnGroupState([{ groupId: 'G', open: false }]);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const shipped = updateSpy.mock.calls[0]![0] as Array<{ colId: string }>;
    expect(shipped.map((c) => c.colId)).toContain('c');
    grid.destroy();
  });
});
