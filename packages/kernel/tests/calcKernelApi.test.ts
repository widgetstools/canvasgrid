import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { CGrid } from '../src/cgrid';
import { _resetCalcProvider_forTests, type CalcProviderShape } from '../src/core/calcSlot';

beforeAll(() => {
  // ── stubs copied from tests/cgrid.integration.test.ts / rulesKernelApi.test.ts ──
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

function makeGrid() {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  return new CGrid<{ id: string; px: number }>(container, {
    columnDefs: [{ field: 'id' }, { field: 'px' }],
    getRowId: (r) => r.id,
    theme: 'cg-theme-quartz',
  });
}

function makeProvider(overrides: Partial<CalcProviderShape> = {}): CalcProviderShape {
  return {
    synthesizedColDefs: () => [],
    resolvedPatchFor: () => null,
    workerProgram: () => null,
    onColumnsChanged: () => () => {},
    ...overrides,
  };
}

describe('CGrid calc-facing API (Cycle 21d / Task 9)', () => {
  afterEach(() => _resetCalcProvider_forTests());

  it('registerCalcProvider folds a synthesized calc column into the resolved column tree', () => {
    const grid = makeGrid();
    const provider = makeProvider({
      synthesizedColDefs: () => [
        { colId: 'spread', headerName: 'Spread', editable: false, cellDataType: 'number' },
      ],
    });
    grid.registerCalcProvider(provider);
    const def = (grid as any).columnDefsMap.get('spread');
    expect(def).toBeDefined();
    expect(def.headerName).toBe('Spread');
    expect(def.editable).toBe(false);
    grid.destroy();
  });

  it('a stubbed onColumnsChanged subscription fires the rebuild', () => {
    const grid = makeGrid();
    let notify: (() => void) | null = null;
    let headerName = 'Spread';
    const provider = makeProvider({
      synthesizedColDefs: () => [{ colId: 'spread', headerName, editable: false, cellDataType: 'number' }],
      onColumnsChanged: (fn) => { notify = fn; return () => {}; },
    });
    grid.registerCalcProvider(provider);
    expect((grid as any).columnDefsMap.get('spread').headerName).toBe('Spread');

    headerName = 'Spread (bps)';
    expect(notify).not.toBeNull();
    notify!();
    expect((grid as any).columnDefsMap.get('spread').headerName).toBe('Spread (bps)');
    grid.destroy();
  });

  it('idempotent re-register: second registerCalcProvider unsubscribes the first', () => {
    const grid = makeGrid();
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    const provider1 = makeProvider({ onColumnsChanged: () => unsub1 });
    const provider2 = makeProvider({ onColumnsChanged: () => unsub2 });
    grid.registerCalcProvider(provider1);
    expect(unsub1).not.toHaveBeenCalled();
    grid.registerCalcProvider(provider2);
    expect(unsub1).toHaveBeenCalledTimes(1);
    expect(unsub2).not.toHaveBeenCalled();
    grid.destroy();
    expect(unsub2).toHaveBeenCalledTimes(1);
  });

  it('no registerCalcProvider call → resolved defs are unaffected (zero-diff)', () => {
    const grid = makeGrid();
    expect((grid as any).columnDefsMap.get('spread')).toBeUndefined();
    expect((grid as any).columnDefsMap.get('id')).toBeDefined();
    expect((grid as any).columnDefsMap.get('px')).toBeDefined();
    grid.destroy();
  });
});
