import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';

// happy-dom shims: Worker + canvas 2D context. Mirrors the pattern used by
// commitBack.test.ts so the grid construction has a working worker + paintable
// canvas without spinning a real Web Worker.
beforeAll(() => {
  (globalThis as any).Worker = (globalThis as any).Worker ?? class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  if (!HTMLCanvasElement.prototype.getContext || (HTMLCanvasElement.prototype.getContext as any).__cgFake !== true) {
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
    const getCtx = (() => fakeCtx as any) as any;
    getCtx.__cgFake = true;
    HTMLCanvasElement.prototype.getContext = getCtx;
  }
});

function buildWiredGrid<T extends { id: string }>(rows: T[] | undefined, cols: any[]) {
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
  const opts: any = {
    columnDefs: cols,
    getRowId: (r: T) => r.id,
  };
  if (rows !== undefined) opts.rowData = rows;
  const grid = new VelocityGrid<T>(container, opts);
  const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
  return { grid, container, restore };
}

describe('Lifecycle events (Task 10)', () => {
  it('fires gridPreDestroyed synchronously inside destroy() with a state snapshot', async () => {
    type Row = { id: string };
    const { grid, restore } = buildWiredGrid<Row>([{ id: '1' }], [{ field: 'id' }]);
    await new Promise((r) => setTimeout(r, 50));
    const events: any[] = [];
    grid.on('gridPreDestroyed', (e) => events.push(e));
    expect(events.length).toBe(0);
    grid.destroy();
    // Synchronous — the listener fires inside destroy(), no microtask needed.
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('gridPreDestroyed');
    expect(events[0].state).toBeDefined();
    restore();
  });

  it('does not fire gridPreDestroyed twice on repeated destroy() calls', async () => {
    type Row = { id: string };
    const { grid, restore } = buildWiredGrid<Row>([{ id: '1' }], [{ field: 'id' }]);
    await new Promise((r) => setTimeout(r, 50));
    const events: any[] = [];
    grid.on('gridPreDestroyed', (e) => events.push(e));
    grid.destroy();
    grid.destroy();
    expect(events.length).toBe(1);
    restore();
  });

  it('fires gridSizeChanged when host bounds change after initial paint', async () => {
    type Row = { id: string };
    const { grid, restore } = buildWiredGrid<Row>([{ id: '1' }], [{ field: 'id' }]);
    await new Promise((r) => setTimeout(r, 50));
    const events: any[] = [];
    grid.on('gridSizeChanged', (e) => events.push(e));
    const canvas: any = (grid as any).cgridCanvas;
    // Drive a real bounds change through the component callback so the cgrid
    // wrapper's diff check decides emit / no-emit (same path as a real
    // browser-driven resize-poll tick).
    canvas.component.setBounds({ x: 0, y: 0, width: 900, height: 700 });
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ type: 'gridSizeChanged', width: 900, height: 700 });
    // A second setBounds with the same dims does NOT re-emit.
    canvas.component.setBounds({ x: 0, y: 0, width: 900, height: 700 });
    expect(events.length).toBe(1);
    // A third call with a different size DOES re-emit.
    canvas.component.setBounds({ x: 0, y: 0, width: 1000, height: 700 });
    expect(events.length).toBe(2);
    expect(events[1]).toMatchObject({ type: 'gridSizeChanged', width: 1000, height: 700 });
    grid.destroy();
    restore();
  });

  it('does not fire gridSizeChanged on refresh() without a bounds change', async () => {
    type Row = { id: string };
    const { grid, restore } = buildWiredGrid<Row>([{ id: '1' }], [{ field: 'id' }]);
    await new Promise((r) => setTimeout(r, 50));
    const events: any[] = [];
    grid.on('gridSizeChanged', (e) => events.push(e));
    grid.refresh();
    grid.refresh();
    expect(events.length).toBe(0);
    grid.destroy();
    restore();
  });

  it('fires firstDataRendered exactly once after the first non-empty viewport chunk', async () => {
    type Row = { id: string; v: number };
    const events: any[] = [];
    const { grid, restore } = buildWiredGrid<Row>(
      [{ id: '1', v: 1 }, { id: '2', v: 2 }],
      [{ field: 'id' }, { field: 'v', type: 'number' }],
    );
    grid.on('firstDataRendered', (e) => events.push(e));
    // Let worker init + setRowData + first getViewport round-trip complete.
    await new Promise((r) => setTimeout(r, 120));
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('firstDataRendered');

    // A subsequent refresh does NOT re-fire.
    grid.refresh();
    await new Promise((r) => setTimeout(r, 30));
    expect(events.length).toBe(1);

    // A subsequent setRowData (which triggers another viewport fetch) also
    // does NOT re-fire — the event is once-per-grid-instance.
    grid.setRowData([{ id: '3', v: 3 }]);
    await new Promise((r) => setTimeout(r, 80));
    expect(events.length).toBe(1);

    grid.destroy();
    restore();
  });

  it('does not fire firstDataRendered when the grid has no data', async () => {
    const events: any[] = [];
    const { grid, restore } = buildWiredGrid<any>(undefined, [{ field: 'id' }]);
    grid.on('firstDataRendered', (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 120));
    expect(events.length).toBe(0);

    grid.destroy();
    restore();
  });
});
