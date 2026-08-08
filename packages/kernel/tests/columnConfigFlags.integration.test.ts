// Grid Layouts / column-config flags — kernel integration proof (Task 2).
//
// Task 1 (this branch) added seven def-flag keys (floatingFilter, filter,
// enableRowGroup, enablePivot, sortable, resizable, suppressAggFuncInHeader)
// to @wellsfargo-starui/velocity-grid-calc's editColumn/ColumnEditPatch pipeline and pinned their
// resolvedPatchFor behavior at the calc-package level
// (packages/calc/tests/columnConfigFlags.test.ts). This file is the
// cross-package proof: `grid.editColumn(...)` on a REAL VelocityGrid, wired to the
// REAL @wellsfargo-starui/velocity-grid-calc engine via wireIntoKernel, must land the patched flags on
// the kernel's RESOLVED colDef surface (`columnDefsMap`, fed by
// core/calcSlot.ts's foldCalcColumnDefs → resolveColumnTree — see
// velocityGrid.ts:1219-1220 / 6137-6159), and those flags must round-trip through
// getState/setState (the calc module's `calc` + `columnOverrides` state
// slices registered in packages/calc/src/bridge.ts).
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import { wireIntoKernel as wireCalc } from '@wellsfargo-starui/velocity-grid-calc';

// Canvas 2D context stub — happy-dom does not implement it. Copied verbatim
// from cgrid.integration.test.ts's top-level beforeAll (CACHED_PROPS walk
// needs real methods + plain data properties on the fake context).
beforeAll(() => {
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

// Reuse the wired-grid harness idiom from cgrid.integration.test.ts (fake
// Worker routed through the real createWorkerHost) — copied locally per the
// task brief rather than imported across test files.
function buildWiredGrid<T extends { id: string }>(rows: T[], cols: any[]) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const prevWorker = (globalThis as any).Worker;
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
  const grid = new VelocityGrid<T>(container, {
    columnDefs: cols,
    getRowId: (r) => r.id,
    rowSelection: 'multiple',
    rowData: rows,
  });
  const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
  return { grid, container, restore };
}

describe('column-config flags — template → resolved def', () => {
  it('editColumn flags reach the resolved colDef and survive a defs rebuild', async () => {
    const { grid, restore } = buildWiredGrid(
      [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }],
      [{ field: 'id' }, { field: 'qty', type: 'number' }],
    );
    wireCalc(grid as never);
    await new Promise((r) => setTimeout(r, 50));

    grid.editColumn('qty', {
      floatingFilter: true, filter: 'set', enableRowGroup: true,
      sortable: false, suppressAggFuncInHeader: true,
    } as never);
    await new Promise((r) => setTimeout(r, 50));

    // Resolved def readback — the calcSlot folds the patch pre-resolve.
    const def = (grid as any).columnDefsMap.get('qty');
    expect(def.floatingFilter).toBe(true);
    expect(def.filter).toBe('set');
    expect(def.enableRowGroup).toBe(true);
    expect(def.sortable).toBe(false);
    expect(def.suppressAggFuncInHeader).toBe(true);

    // filter: null reverts to the type default (key gone from the def).
    grid.editColumn('qty', { filter: null } as never);
    await new Promise((r) => setTimeout(r, 50));
    expect((grid as any).columnDefsMap.get('qty').filter).toBeUndefined();

    grid.destroy();
    restore();
  });

  it('flags round-trip getState/setState via the calc module slices', async () => {
    const { grid, restore } = buildWiredGrid(
      [{ id: 'a', qty: 1 }],
      [{ field: 'id' }, { field: 'qty', type: 'number' }],
    );
    wireCalc(grid as never);
    await new Promise((r) => setTimeout(r, 50));
    grid.editColumn('qty', { enableRowGroup: true, floatingFilter: true } as never);
    await new Promise((r) => setTimeout(r, 50));
    const snap = grid.getState();
    grid.editColumn('qty', { enableRowGroup: false, floatingFilter: false } as never);
    await new Promise((r) => setTimeout(r, 50));
    grid.setState(snap);
    await new Promise((r) => setTimeout(r, 50));
    const def = (grid as any).columnDefsMap.get('qty');
    expect(def.enableRowGroup).toBe(true);
    expect(def.floatingFilter).toBe(true);
    grid.destroy();
    restore();
  });
});
