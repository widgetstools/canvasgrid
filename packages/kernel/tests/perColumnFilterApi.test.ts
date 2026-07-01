/**
 * Cycle 7 / Task 9 — per-column filter API surface.
 *
 * Pins the five new CGridApi methods:
 *   - getColumnFilterModel(colId): TModel | null
 *   - setColumnFilterModel(colId, model): Promise<void>
 *   - isAnyFilterPresent(): boolean
 *   - isColumnFilterPresent(): boolean
 *   - destroyFilter(colId): void
 *
 * Also pins the refined `filterChanged` event payload — Task 9 adds
 * `columns` (changed colIds) on top of the Task 7 `source`.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { createWorkerHost } from '../src/worker/worker';
import type { CFilterModelEntry, CGridEvent } from '../src/types';

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

interface Row { id: string; name: string; price: number }

function buildWiredGrid(rows: Row[]) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
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
  const grid = new CGrid<Row>(container, {
    columnDefs: [
      { field: 'id', filter: 'text' },
      { field: 'name', filter: 'text' },
      { field: 'price', type: 'number', filter: 'number' },
    ],
    getRowId: (r) => r.id,
    rowData: rows,
  });
  const restore = () => {
    (globalThis as any).Worker = prevWorker;
    container.remove();
  };
  return { grid, restore };
}

const rows: Row[] = [
  { id: 'a', name: 'Alpha',   price: 10 },
  { id: 'b', name: 'Beta',    price: 20 },
  { id: 'c', name: 'Gamma',   price: 30 },
];

describe('Per-column filter API (Cycle 7 / Task 9)', () => {
  it('getColumnFilterModel returns null when no filter is set', async () => {
    const { grid, restore } = buildWiredGrid(rows);
    await new Promise((r) => setTimeout(r, 50));
    const api = (grid as any).makeApi();
    expect(api.getColumnFilterModel('name')).toBeNull();
    expect(api.getColumnFilterModel('does-not-exist')).toBeNull();
    grid.destroy();
    restore();
  });

  it('setColumnFilterModel commits + fires filterChanged with columns + source', async () => {
    const { grid, restore } = buildWiredGrid(rows);
    await new Promise((r) => setTimeout(r, 50));
    const events: CGridEvent[] = [];
    grid.on('filterChanged', (e) => events.push(e));
    const api = (grid as any).makeApi();
    await api.setColumnFilterModel('name', {
      filterType: 'text', type: 'contains', filter: 'Alpha',
    } as CFilterModelEntry);
    expect(api.getColumnFilterModel('name')).toEqual({
      filterType: 'text', type: 'contains', filter: 'Alpha',
    });
    const last = events.at(-1) as Extract<CGridEvent, { type: 'filterChanged' }>;
    expect(last.source).toBe('columnFilter');
    expect(last.columns).toEqual(['name']);
    grid.destroy();
    restore();
  });

  it('setColumnFilterModel(null) clears the column', async () => {
    const { grid, restore } = buildWiredGrid(rows);
    await new Promise((r) => setTimeout(r, 50));
    const api = (grid as any).makeApi();
    await api.setColumnFilterModel('price', {
      filterType: 'number', type: 'greaterThan', filter: 15,
    } as CFilterModelEntry);
    expect(api.getColumnFilterModel('price')).not.toBeNull();
    await api.setColumnFilterModel('price', null);
    expect(api.getColumnFilterModel('price')).toBeNull();
    grid.destroy();
    restore();
  });

  it('isAnyFilterPresent + isColumnFilterPresent reflect column-filter state', async () => {
    const { grid, restore } = buildWiredGrid(rows);
    await new Promise((r) => setTimeout(r, 50));
    const api = (grid as any).makeApi();
    expect(api.isAnyFilterPresent()).toBe(false);
    expect(api.isColumnFilterPresent()).toBe(false);
    await api.setColumnFilterModel('name', {
      filterType: 'text', type: 'equals', filter: 'Beta',
    } as CFilterModelEntry);
    expect(api.isAnyFilterPresent()).toBe(true);
    expect(api.isColumnFilterPresent()).toBe(true);
    grid.destroy();
    restore();
  });

  it('isAnyFilterPresent reflects quickFilter state independently of column filters', async () => {
    const { grid, restore } = buildWiredGrid(rows);
    await new Promise((r) => setTimeout(r, 50));
    const api = (grid as any).makeApi();
    api.setGridOption('quickFilterText', 'Alpha');
    expect(api.isAnyFilterPresent()).toBe(true);
    // quickFilter doesn't count as column-filter presence.
    expect(api.isColumnFilterPresent()).toBe(false);
    api.setGridOption('quickFilterText', '');
    expect(api.isAnyFilterPresent()).toBe(false);
    grid.destroy();
    restore();
  });

  it('destroyFilter clears the column AND removes it from the model', async () => {
    const { grid, restore } = buildWiredGrid(rows);
    await new Promise((r) => setTimeout(r, 50));
    const api = (grid as any).makeApi();
    await api.setColumnFilterModel('name', {
      filterType: 'text', type: 'equals', filter: 'Alpha',
    } as CFilterModelEntry);
    expect(api.getColumnFilterModel('name')).not.toBeNull();
    api.destroyFilter('name');
    // destroyFilter is fire-and-forget; the round-trip lands one
    // microtask later. Yield + assert.
    await new Promise((r) => setTimeout(r, 50));
    expect(api.getColumnFilterModel('name')).toBeNull();
    expect(api.isColumnFilterPresent()).toBe(false);
    grid.destroy();
    restore();
  });
});
