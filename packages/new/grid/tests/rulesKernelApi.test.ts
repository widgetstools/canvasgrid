import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';

beforeAll(() => {
  // ── stubs copied from tests/cgrid.integration.test.ts ──
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

function makeGrid(themeClass = 'vg-theme-quartz') {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = themeClass;
  document.body.appendChild(container);
  return new VelocityGrid<{ id: string; px: number }>(container, {
    columnDefs: [{ field: 'id' }, { field: 'px' }],
    getRowId: (r) => r.id,
    theme: themeClass,
  });
}

describe('VelocityGrid rules-facing API (Cycle 21e / Task 10)', () => {
  it('forEachRow iterates the rowDataById mirror in insertion order', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }, { id: 'b', px: 2 }] });
    grid.applyTransaction({ update: [{ id: 'a', px: 3 }] });
    const seen: Array<[string, number]> = [];
    grid.forEachRow((rowId, row) => seen.push([rowId, row.px]));
    expect(seen).toEqual([['a', 3], ['b', 2]]);
    grid.destroy();
  });

  it('forEachRow drops removed rows', () => {
    const grid = makeGrid();
    grid.applyTransaction({ add: [{ id: 'a', px: 1 }, { id: 'b', px: 2 }] });
    grid.applyTransaction({ remove: [{ id: 'a', px: 1 }] });
    const ids: string[] = [];
    grid.forEachRow((rowId) => ids.push(rowId));
    expect(ids).toEqual(['b']);
    grid.destroy();
  });

  it('getThemeKind reads light from vg-theme-quartz and dark from vg-theme-quartz-dark', () => {
    const light = makeGrid('vg-theme-quartz');
    expect(light.getThemeKind()).toBe('light');
    light.destroy();
    const dark = makeGrid('vg-theme-quartz-dark');
    expect(dark.getThemeKind()).toBe('dark');
    dark.destroy();
  });

  it('setTheme flips getThemeKind at runtime', () => {
    const grid = makeGrid('vg-theme-quartz');
    grid.setTheme('vg-theme-quartz-dark');
    expect(grid.getThemeKind()).toBe('dark');
    grid.destroy();
  });

  it('registerRuleEngine round-trips through the slot', async () => {
    const { getRuleEngine, _resetRuleEngine_forTests } = await import('../src/core/ruleEngineSlot');
    _resetRuleEngine_forTests();
    const grid = makeGrid();
    const engine = {
      evaluateCell: () => ({ matched: [], style: null, indicator: null, formatProgram: null }),
      resolveRuleRef: () => null,
    };
    grid.registerRuleEngine(engine);
    expect(getRuleEngine()).toBe(engine);
    _resetRuleEngine_forTests();
    grid.destroy();
  });
});
