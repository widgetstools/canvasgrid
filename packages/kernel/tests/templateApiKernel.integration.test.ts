/**
 * Grid Layouts — Phase B / B3: the Template API on VelocityGridApi, exercised
 * end-to-end on a real VelocityGrid wired to @wellsfargo-starui/velocity-grid-calc.
 *
 * Proves the worklog's B3 gate — "Template API live": getTemplates /
 * saveTemplate / renameTemplate (unique) / deleteTemplate / applyTemplate /
 * removeTemplate route to the calc engine via the calc provider, and every
 * mutation fires a `templatesChanged` event. Also proves the graceful
 * degradation path: a grid with NO calc wired returns `[]` and no-ops.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { wireIntoKernel } from '@wellsfargo-starui/velocity-grid-calc';
import { _resetCalcProvider_forTests } from '../src/core/calcSlot';

// The calc provider is a MODULE-GLOBAL slot (core/calcSlot.ts) — a prior
// wired grid's provider would otherwise leak into the "no calc wired" case.
// Reset before each test so isolation holds; wired mounts re-register.
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

async function mount(opts: { wire?: boolean } = { wire: true }) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const grid = new VelocityGrid<{ id: string; qty: number; price: number }>(container, {
    columnDefs: [{ field: 'id' }, { field: 'qty' }, { field: 'price' }],
    getRowId: (r) => r.id,
    theme: 'vg-theme-quartz',
  });
  const calc = opts.wire === false ? null : wireIntoKernel(grid).calc;
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));
  return { grid, calc };
}

describe('B3 — Template API on VelocityGridApi (calc wired)', () => {
  it('save → getTemplates → rename → delete round-trips, firing templatesChanged', async () => {
    const { grid } = await mount();
    const events: any[] = [];
    grid.on('templatesChanged', (e) => events.push(e));

    expect(grid.getTemplates()).toEqual([]);

    grid.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0.00' } });
    expect(grid.getTemplates().map((t) => t.id)).toEqual(['money']);
    expect(events.at(-1)).toEqual({ type: 'templatesChanged', source: 'save', templateId: 'money' });

    grid.renameTemplate('money', 'Currency');
    expect(grid.getTemplates()[0].name).toBe('Currency');
    expect(events.at(-1)).toEqual({ type: 'templatesChanged', source: 'rename', templateId: 'money' });

    grid.deleteTemplate('money');
    expect(grid.getTemplates()).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'templatesChanged', source: 'delete', templateId: 'money' });

    grid.destroy();
  });

  it('renameTemplate rejects a duplicate name and fires NO event', async () => {
    const { grid } = await mount();
    grid.saveTemplate({ id: 'a', name: 'Alpha', overrides: {} });
    grid.saveTemplate({ id: 'b', name: 'Beta', overrides: {} });
    const events: any[] = [];
    grid.on('templatesChanged', (e) => events.push(e));

    expect(() => grid.renameTemplate('b', 'alpha')).toThrow(/in use/);
    expect(events).toEqual([]);
    expect(grid.getTemplates().find((t) => t.id === 'b')!.name).toBe('Beta'); // unchanged
    grid.destroy();
  });

  it('apply(colId, templateId) assigns to a column; remove(colId, templateId) unassigns (library kept)', async () => {
    const { grid, calc } = await mount();
    const events: any[] = [];
    grid.on('templatesChanged', (e) => events.push(e));
    grid.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0.00' } });

    grid.applyTemplate('price', 'money');
    expect(calc!.getOverrides().find((o) => o.colId === 'price')!.templateIds).toEqual(['money']);
    expect(events.at(-1)).toEqual({ type: 'templatesChanged', source: 'apply', templateId: 'money' });

    grid.removeTemplate('price', 'money');
    expect(calc!.getOverrides().find((o) => o.colId === 'price')!.templateIds).toEqual([]);
    expect(grid.getTemplates().map((t) => t.id)).toEqual(['money']); // still in library
    expect(events.at(-1)).toEqual({ type: 'templatesChanged', source: 'remove', templateId: 'money' });

    grid.destroy();
  });
});

describe('B5 — editColumn (auto-template-on-edit) via VelocityGridApi', () => {
  it('writes the edit into the column’s OWN template + assigns it, firing templatesChanged', async () => {
    const { grid, calc } = await mount();
    const events: any[] = [];
    grid.on('templatesChanged', (e) => events.push(e));

    grid.editColumn('price', { width: 220, format: '#,##0.000' });

    // Own template created + assigned (own id = __cgridOwn:price).
    const override = calc!.getOverrides().find((o) => o.colId === 'price')!;
    expect(override.templateIds).toEqual(['__cgridOwn:price']);
    const own = grid.getTemplates().find((t) => t.id === '__cgridOwn:price')!;
    expect(own.overrides).toMatchObject({ width: 220, format: '#,##0.000' });
    expect(events.at(-1)).toEqual({ type: 'templatesChanged', source: 'save', templateId: undefined });

    // Editing a column that has a SHARED template forks to its own (shared untouched).
    grid.saveTemplate({ id: 'shared', name: 'Shared', overrides: { width: 50 } });
    grid.applyTemplate('qty', 'shared');
    grid.editColumn('qty', { width: 300 });
    expect(grid.getTemplates().find((t) => t.id === 'shared')!.overrides).toEqual({ width: 50 }); // unmutated
    expect(calc!.getOverrides().find((o) => o.colId === 'qty')!.templateIds).toEqual(['shared', '__cgridOwn:qty']);

    grid.destroy();
  });

  it('a rejected edit (non-compiling format) changes nothing and fires NO event (M1)', async () => {
    const { grid, calc } = await mount();
    const events: any[] = [];
    grid.on('templatesChanged', (e) => events.push(e));

    grid.editColumn('price', { format: '0;0;0;0;0' }); // >4 sections → won't compile
    expect(calc!.getOverrides()).toEqual([]);   // nothing stored
    expect(grid.getTemplates()).toEqual([]);      // no own template created
    expect(events).toEqual([]);                    // no phantom event
    grid.destroy();
  });
});

describe('B5 fix (M2) — a deleted template does not resurrect in an export', () => {
  it('getGridConfig/exportLayouts reflect the LIVE (empty) library after delete', async () => {
    const { grid } = await mount();
    grid.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0' } });
    grid.applyTemplate('price', 'money');
    expect(grid.exportLayouts().grid.templates!.map((t) => t.id)).toEqual(['money']);

    grid.deleteTemplate('money');
    expect(grid.getTemplates()).toEqual([]);
    // Bundle must NOT carry the deleted def (was resurrected from stale gridConfig before the fix).
    expect(grid.exportLayouts().grid.templates ?? []).toEqual([]);
    grid.destroy();
  });
});

describe('B3 — Template API degrades gracefully with no calc engine wired', () => {
  it('getTemplates → [] and mutators no-op (no throw, no event)', async () => {
    const { grid } = await mount({ wire: false });
    const events: any[] = [];
    grid.on('templatesChanged', (e) => events.push(e));

    expect(grid.getTemplates()).toEqual([]);
    expect(() => grid.saveTemplate({ id: 'money', name: 'Money', overrides: {} })).not.toThrow();
    expect(() => grid.renameTemplate('money', 'X')).not.toThrow();
    expect(() => grid.applyTemplate('price', 'money')).not.toThrow();
    expect(() => grid.removeTemplate('price', 'money')).not.toThrow();
    expect(() => grid.editColumn('price', { width: 100 })).not.toThrow();
    expect(() => grid.deleteTemplate('money')).not.toThrow();
    expect(grid.getTemplates()).toEqual([]);
    expect(events).toEqual([]);
    grid.destroy();
  });
});
