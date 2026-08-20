/**
 * Grid Layouts — Phase B / B1: the calc bridge's `templates` (grid-tier) +
 * `calc` (layout-tier) state modules, exercised end-to-end on a real VelocityGrid.
 *
 * Proves the worklog's B1 gate — "both round-trip through getState/setState" —
 * and that the tier split works: a saved layout carries the layout-tier `calc`
 * module but NOT the grid-tier `templates` library (shared across layouts).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { wireIntoKernel } from '../src/calc/index';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
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
});

async function mountWired() {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const grid = new VelocityGrid<{ id: string; qty: number; price: number }>(container, {
    columnDefs: [{ field: 'id' }, { field: 'qty' }, { field: 'price' }],
    getRowId: (r) => r.id,
    theme: 'vg-theme-quartz',
  });
  const { calc } = wireIntoKernel(grid);
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));
  return { grid, calc };
}

describe('B1 — templates + calc modules round-trip through getState/setState', () => {
  it('captures the template library + calc defs into GridState.modules and restores them', async () => {
    const { grid, calc } = await mountWired();
    calc.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0.00' }, now: 1 });
    calc.registerCalculatedColumn({ colId: 'total', headerName: 'Total', expression: '[qty] * [price]' });

    const state = grid.getState();
    expect((state.modules?.templates?.data as any[]).map((t) => t.id)).toEqual(['money']);
    expect((state.modules?.calc?.data as any[]).map((c) => c.colId)).toEqual(['total']);
    grid.destroy();

    // Restore into a fresh, freshly-wired grid.
    const { grid: g2, calc: calc2 } = await mountWired();
    expect(calc2.listTemplates()).toEqual([]);
    expect(calc2.listCalculatedColumns()).toEqual([]);
    g2.setState(state);
    expect(calc2.listTemplates().map((t) => t.id)).toEqual(['money']);
    expect(calc2.listCalculatedColumns().map((c) => c.colId)).toEqual(['total']);
    g2.destroy();
  });

  it('tiers correctly: a saved layout carries the layout-tier `calc` module but not grid-tier `templates`', async () => {
    const { grid, calc } = await mountWired();
    calc.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0.00' }, now: 1 });
    calc.registerCalculatedColumn({ colId: 'total', headerName: 'Total', expression: '[qty] * [price]' });

    const layout = grid.saveLayout('Calc');
    expect((layout.state.modules?.calc?.data as any[]).map((c) => c.colId)).toEqual(['total']);
    expect(layout.state.modules?.templates).toBeUndefined(); // grid-tier — shared, not per-layout
    grid.destroy();
  });
});
