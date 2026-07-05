/**
 * Grid Layouts — Phase B / B5 (carry-in fix): switching to a layout that
 * OMITS a layout-tier module slice must CLEAR the outgoing layout's slice.
 *
 * `calc` (calculated columns) and `columnOverrides` (template assignments +
 * per-column styling) are layout-tier. Before this fix, `setState`'s
 * exhaustive (switch) mode cleared standard view fields but NOT module slices,
 * so switching from a styled layout back to Default leaked its calc columns
 * and template assignments. Proves the fix end-to-end on a real wired CGrid,
 * and that the GRID-tier `templates` library survives the switch.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { wireIntoKernel } from '@cgrid/calc';

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
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const grid = new CGrid<{ id: string; qty: number; price: number }>(container, {
    columnDefs: [{ field: 'id' }, { field: 'qty' }, { field: 'price' }],
    getRowId: (r) => r.id,
    theme: 'cg-theme-quartz',
  });
  const { calc } = wireIntoKernel(grid);
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  await new Promise((r) => setTimeout(r, 0));
  return { grid, calc };
}

describe('B5 — layout switch clears absent layout-tier module slices', () => {
  it('switching Styled → Default clears calc columns + template assignments; keeps the shared library', async () => {
    const { grid, calc } = await mountWired();

    // Default is empty. Build a "Styled" layout with a calc column + a
    // template assigned to a data column.
    grid.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0.00' } });
    calc.registerCalculatedColumn({ colId: 'total', headerName: 'Total', expression: '[qty] * [price]' });
    grid.applyTemplate('price', 'money');
    const styled = grid.saveLayout('Styled'); // captures calc + columnOverrides

    expect(calc.listCalculatedColumns().map((c) => c.colId)).toEqual(['total']);
    expect(calc.getOverrides().find((o) => o.colId === 'price')!.templateIds).toEqual(['money']);

    // Switch to Default (which carries no calc / columnOverrides slices).
    grid.loadLayout('default');
    expect(calc.listCalculatedColumns()).toEqual([]);            // calc col CLEARED
    expect(calc.getOverrides()).toEqual([]);                     // assignment CLEARED
    expect(grid.getTemplates().map((t) => t.id)).toEqual(['money']); // grid-tier library SURVIVES

    // Switch back to Styled → slices restore.
    grid.loadLayout(styled.id);
    expect(calc.listCalculatedColumns().map((c) => c.colId)).toEqual(['total']);
    expect(calc.getOverrides().find((o) => o.colId === 'price')!.templateIds).toEqual(['money']);

    grid.destroy();
  });

  it('switching between two styled layouts swaps their slices (no leak)', async () => {
    const { grid, calc } = await mountWired();
    grid.saveTemplate({ id: 'money', name: 'Money', overrides: { format: '#,##0' } });
    grid.saveTemplate({ id: 'compact', name: 'Compact', overrides: { width: 90 } });

    grid.applyTemplate('price', 'money');
    const a = grid.saveLayout('A');

    // New layout B: different assignment (clear then re-assign on the live grid).
    calc.clearOverrides();
    grid.applyTemplate('qty', 'compact');
    const b = grid.saveLayout('B');

    grid.loadLayout(a.id);
    expect(calc.getOverrides().map((o) => o.colId)).toEqual(['price']); // only A's
    grid.loadLayout(b.id);
    expect(calc.getOverrides().map((o) => o.colId)).toEqual(['qty']);   // only B's — A's gone

    grid.destroy();
  });
});
