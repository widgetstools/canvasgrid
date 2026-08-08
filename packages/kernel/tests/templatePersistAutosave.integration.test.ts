/**
 * Grid Layouts — Phase B / B5 closeout fix (H1): template & calc mutations
 * must dirty the persist bus so `persistState` autosave captures them.
 *
 * Before the fix, `templatesChanged` was not mapped in the stateUpdatedBus and
 * the calc bridge never signalled a module change, so `saveTemplate` /
 * `renameTemplate` / `applyTemplate` / `editColumn` / `registerCalculatedColumn`
 * were silently lost on reload (spec §11). `renameTemplate` is the purest repro
 * — it triggers no colDef rebuild, so nothing else could dirty the bus.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { wireIntoKernel } from '@wellsfargo-starui/velocity-grid-calc';
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

function memAdapter() {
  let store: any = null;
  return {
    load: () => store,
    save(_id: string, state: any) { store = JSON.parse(JSON.stringify(state)); },
    clear() { store = null; },
    raw: () => store,
  };
}

async function mountWired(extra: Record<string, unknown> = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const grid = new VelocityGrid<{ id: string; qty: number; price: number }>(container, {
    columnDefs: [{ field: 'id' }, { field: 'qty' }, { field: 'price' }],
    getRowId: (r) => r.id,
    theme: 'vg-theme-quartz',
    ...extra,
  });
  const { calc } = wireIntoKernel(grid);
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 25)); // let restore() arm autosave
  return { grid, calc };
}

function forcePersist(grid: any) {
  grid.stateUpdatedBus.flush();
  grid.statePersistence.flush();
}

describe('B5 fix (H1) — template & calc mutations autosave through persistState', () => {
  it('saveTemplate + applyTemplate + a bare renameTemplate all persist and restore', async () => {
    const adapter = memAdapter();
    const { grid } = await mountWired({ gridId: 'tp1', persistState: { adapter, debounceMs: 0 } });

    grid.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0.00' } });
    grid.applyTemplate('price', 'money');
    forcePersist(grid);
    expect(adapter.raw().modules.templates.data.map((t: any) => t.id)).toEqual(['money']);
    expect(adapter.raw().modules.columnOverrides.data.find((o: any) => o.colId === 'price').templateIds).toEqual(['money']);

    // A BARE rename (no other mutation) must dirty the bus on its own.
    grid.renameTemplate('money', 'Currency');
    forcePersist(grid);
    expect(adapter.raw().modules.templates.data[0].name).toBe('Currency');

    grid.destroy();

    // Fresh grid, same adapter → template library + assignment survive reload.
    const { grid: g2, calc: calc2 } = await mountWired({ gridId: 'tp1', persistState: { adapter, debounceMs: 0 } });
    expect(g2.getTemplates().map((t) => t.id)).toEqual(['money']);
    expect(g2.getTemplates()[0].name).toBe('Currency');
    expect(calc2.getOverrides().find((o) => o.colId === 'price')!.templateIds).toEqual(['money']);
    g2.destroy();
  });

  it('a registered calc column persists (calc bridge signals a module change)', async () => {
    const adapter = memAdapter();
    const { grid, calc } = await mountWired({ gridId: 'tp2', persistState: { adapter, debounceMs: 0 } });
    calc.registerCalculatedColumn({ colId: 'total', headerName: 'Total', expression: '[qty] * [price]' });
    forcePersist(grid);
    expect(adapter.raw().modules.calc.data.map((c: any) => c.colId)).toEqual(['total']);
    grid.destroy();

    const { grid: g2, calc: calc2 } = await mountWired({ gridId: 'tp2', persistState: { adapter, debounceMs: 0 } });
    expect(calc2.listCalculatedColumns().map((c) => c.colId)).toEqual(['total']);
    g2.destroy();
  });
});
