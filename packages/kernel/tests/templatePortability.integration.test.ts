/**
 * Grid Layouts — Phase B / B4: portable layout export WITH templates.
 *
 * Proves the B4 gate — "Portable layout export w/ templates": a layout export
 * bundles the template defs its columns reference, and importing it into a
 * FRESH grid (empty library) re-materializes those defs AND restores the
 * per-column template assignments (which now ride in the layout-tier
 * `columnOverrides` module). Exercised end-to-end on real VelocityGrids wired to
 * @wellsfargo-starui/velocity-grid/calc.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { wireIntoKernel } from '../src/calc/index';
import { _resetCalcProvider_forTests } from '../src/core/calcSlot';

beforeEach(() => { _resetCalcProvider_forTests(); });

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

describe('B4 — portable layout export bundles referenced template defs', () => {
  it('exportLayout carries the referenced defs; import into a FRESH grid re-materializes them + restores assignments', async () => {
    // Source grid: a template applied to a DATA column, captured in a layout.
    const src = await mountWired();
    src.grid.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0.00' } });
    src.grid.saveTemplate({ id: 'unused', name: 'Unused', overrides: { width: 10 } });
    src.grid.applyTemplate('price', 'money');
    const blotter = src.grid.saveLayout('Blotter');

    const exported = src.grid.exportLayout(blotter.id);
    // Only the REFERENCED def travels — not the whole library.
    expect(exported.templates!.map((t) => t.id)).toEqual(['money']);
    src.grid.destroy();

    // Fresh grid: empty library, no assignments.
    const dst = await mountWired();
    expect(dst.grid.getTemplates()).toEqual([]);
    expect(dst.calc.getOverrides()).toEqual([]);

    dst.grid.importLayout(exported, { activate: true });

    // Def re-materialized into the library…
    expect(dst.grid.getTemplates().map((t) => t.id)).toEqual(['money']);
    expect(dst.grid.getTemplates()[0].overrides).toEqual({ format: '#,##0.00' });
    // …and the per-column assignment restored (rides in the columnOverrides module).
    expect(dst.calc.getOverrides().find((o) => o.colId === 'price')!.templateIds).toEqual(['money']);
    dst.grid.destroy();
  });

  it('import does NOT clobber a same-id def already in the destination library', async () => {
    const src = await mountWired();
    src.grid.saveTemplate({ id: 'money', name: 'Money', overrides: { format: 'FROM-SOURCE' } });
    src.grid.applyTemplate('price', 'money');
    const exported = src.grid.exportLayout(src.grid.saveLayout('L').id);
    src.grid.destroy();

    const dst = await mountWired();
    dst.grid.saveTemplate({ id: 'money', name: 'Money', overrides: { format: 'LOCAL' } }); // pre-existing
    dst.grid.importLayout(exported, { activate: true });
    expect(dst.grid.getTemplates().find((t) => t.id === 'money')!.overrides).toEqual({ format: 'LOCAL' });
    dst.grid.destroy();
  });

  it('full-bundle replace round-trips the library + active layout assignment into a fresh grid', async () => {
    const src = await mountWired();
    src.grid.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0' } });
    src.grid.applyTemplate('qty', 'money');
    src.grid.saveLayout('Blotter');
    const bundle = src.grid.exportLayouts();
    expect(bundle.grid.templates!.map((t) => t.id)).toEqual(['money']); // library rides in grid config
    src.grid.destroy();

    const dst = await mountWired();
    dst.grid.importLayouts(bundle, { mode: 'replace' });
    expect(dst.grid.getTemplates().map((t) => t.id)).toEqual(['money']);
    // active layout is Blotter → its assignment is live
    expect(dst.grid.getActiveLayout().name).toBe('Blotter');
    expect(dst.calc.getOverrides().find((o) => o.colId === 'qty')!.templateIds).toEqual(['money']);
    dst.grid.destroy();
  });
});
