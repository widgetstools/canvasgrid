import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';

// happy-dom shims: Worker + canvas 2D context.
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
    rowData: rows,
  });
  const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
  return { grid, container, restore };
}

describe('editor commit-back (Task 9)', () => {
  it('runs valueParser then valueSetter and posts a worker applyTransaction', async () => {
    type Row = { id: string; price: number; label: string };
    const setterSpy = vi.fn(({ data, newValue }: any) => { data.price = newValue; });
    const parserSpy = vi.fn(({ newValue }: any) => Number(newValue) * 2);
    const { grid, restore } = buildWiredGrid<Row>(
      [
        { id: '1', price: 10, label: 'first' },
        { id: '2', price: 20, label: 'second' },
      ],
      [
        { field: 'id' },
        { field: 'label' },
        {
          field: 'price', type: 'number', editable: true,
          valueParser: parserSpy,
          valueSetter: setterSpy,
        },
      ],
    );
    const events: any[] = [];
    grid.on('cellValueChanged', (e) => events.push(e));

    await new Promise((r) => setTimeout(r, 50));
    (grid as any).openEditor(0, 'price');
    // Editor input is now in the DOM.
    const input = document.querySelector('.vg-editor-overlay input') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = '50';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Allow worker round-trip (getRowByIndex + applyTransaction + modelUpdated).
    await new Promise((r) => setTimeout(r, 80));

    expect(parserSpy).toHaveBeenCalledTimes(1);
    expect(setterSpy).toHaveBeenCalledTimes(1);
    const setterCall = setterSpy.mock.calls[0]![0] as any;
    // Parser ran first (raw → 50*2 = 100); setter received the parsed value.
    expect(setterCall.newValue).toBe(100);
    expect(setterCall.oldValue).toBe(10);
    // Full row is passed, not a partial — proves we fetched from the worker
    // instead of synthesising from the on-screen chunk.
    expect(setterCall.data.id).toBe('1');
    expect(setterCall.data.label).toBe('first');
    // Setter mutated data in place.
    expect(setterCall.data.price).toBe(100);

    // cellValueChanged event fires with real rowId + old/new values.
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ rowId: '1', colId: 'price', oldValue: 10, newValue: 100 });

    // Worker actually applied the update — fetch the row again and check.
    const refreshed = await (grid as any).workerClient.getRowByIndex(0);
    expect(refreshed.rowId).toBe('1');
    expect(refreshed.data.price).toBe(100);
    expect(refreshed.data.label).toBe('first');

    grid.destroy();
    restore();
  });

  it('default path writes data[field] = newValue when neither hook is provided', async () => {
    type Row = { id: string; name: string };
    const { grid, restore } = buildWiredGrid<Row>(
      [{ id: 'r1', name: 'alpha' }],
      [
        { field: 'id' },
        { field: 'name', editable: true },
      ],
    );
    const events: any[] = [];
    grid.on('cellValueChanged', (e) => events.push(e));

    await new Promise((r) => setTimeout(r, 50));
    (grid as any).openEditor(0, 'name');
    const input = document.querySelector('.vg-editor-overlay input') as HTMLInputElement;
    input.value = 'beta';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));

    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ rowId: 'r1', colId: 'name', oldValue: 'alpha', newValue: 'beta' });

    const refreshed = await (grid as any).workerClient.getRowByIndex(0);
    expect(refreshed.data.name).toBe('beta');

    grid.destroy();
    restore();
  });

  it('valueParser without valueSetter still writes through the default field assignment', async () => {
    type Row = { id: string; qty: number };
    const { grid, restore } = buildWiredGrid<Row>(
      [{ id: 'r1', qty: 1 }],
      [
        { field: 'id' },
        {
          field: 'qty', type: 'number', editable: true,
          valueParser: ({ newValue }: any) => Number(newValue) + 1000,
        },
      ],
    );

    await new Promise((r) => setTimeout(r, 50));
    (grid as any).openEditor(0, 'qty');
    const input = document.querySelector('.vg-editor-overlay input') as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));

    const refreshed = await (grid as any).workerClient.getRowByIndex(0);
    expect(refreshed.data.qty).toBe(1007);

    grid.destroy();
    restore();
  });
});
