/**
 * Cycle 21e / Task 13 — cgrid-layer integration for flashCells per-call
 * overrides. Exercises the `flashOverrides` map staged by `flashCells`:
 * exact keys (rowId\0colId), wildcard keys (rowId\0*) when colIds is
 * omitted, default-path no-op (byte-identical to pre-Task-13 behavior),
 * and expiry sweep via the flash tick loop.
 *
 * Grid fixture copied from the Task 10 pattern (tests/rulesKernelApi.test.ts).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';

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

function makeGrid(themeClass = 'vg-theme-quartz'): VelocityGrid<{ id: string; px: number }> {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = themeClass;
  document.body.appendChild(container);
  return new VelocityGrid<{ id: string; px: number }>(container, {
    columnDefs: [{ field: 'id' }, { field: 'px' }],
    getRowId: (r) => r.id,
    theme: themeClass,
    enableCellChangeFlash: true,
  });
}

// Test seam: `flashOverrides` is a private field on VelocityGrid. We reach in via
// bracket-index access (the same pattern used elsewhere in this codebase's
// tests for private-field seams) rather than exposing a public accessor
// solely for tests.
function overridesOf(grid: VelocityGrid<any>): Map<string, { color?: string; mode?: string; expiresAt: number }> {
  return (grid as any).flashOverrides;
}

describe('VelocityGrid flashCells per-call overrides (Cycle 21e / Task 13)', () => {
  it('stages exact rowId\\0colId keys when colIds is provided', () => {
    const grid = makeGrid();
    grid.flashCells({ rowIds: ['a', 'b'], colIds: ['px'], color: '#ff0000' });
    const overrides = overridesOf(grid);
    expect(overrides.has('a\0px')).toBe(true);
    expect(overrides.has('b\0px')).toBe(true);
    expect(overrides.get('a\0px')?.color).toBe('#ff0000');
    expect(overrides.size).toBe(2);
    grid.destroy();
  });

  it('stages wildcard rowId\\0* keys when colIds is omitted', () => {
    const grid = makeGrid();
    grid.flashCells({ rowIds: ['a'], color: '#00ff00', mode: 'pulse' });
    const overrides = overridesOf(grid);
    expect(overrides.has('a\0*')).toBe(true);
    expect(overrides.get('a\0*')?.color).toBe('#00ff00');
    expect(overrides.get('a\0*')?.mode).toBe('pulse');
    grid.destroy();
  });

  it('a call with no override fields (color/mode/flashDuration/fadeDuration) stages nothing — default path byte-identical', () => {
    const grid = makeGrid();
    grid.flashCells({ rowIds: ['a', 'b'], colIds: ['px'] });
    const overrides = overridesOf(grid);
    expect(overrides.size).toBe(0);
    grid.destroy();
  });

  it('mixing an override call with a plain call only stages the override call entries', () => {
    const grid = makeGrid();
    grid.flashCells({ rowIds: ['a'], colIds: ['px'], color: '#123456' });
    expect(overridesOf(grid).size).toBe(1);
    grid.flashCells({ rowIds: ['b'], colIds: ['px'] }); // plain — stages nothing new
    expect(overridesOf(grid).size).toBe(1);
    expect(overridesOf(grid).has('b\0px')).toBe(false);
    grid.destroy();
  });

  it('flashDuration/fadeDuration-only overrides (no color/mode) still stage an entry', () => {
    const grid = makeGrid();
    grid.flashCells({ rowIds: ['a'], colIds: ['px'], flashDuration: 2000 });
    const entry = overridesOf(grid).get('a\0px');
    expect(entry).toBeDefined();
    expect((entry as any).flashDuration).toBe(2000);
    expect(entry?.color).toBeUndefined();
    grid.destroy();
  });

  it('expired override entries are swept lazily on the next flashCells call', () => {
    const grid = makeGrid();
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1000);
    grid.flashCells({ rowIds: ['a'], colIds: ['px'], color: '#ff0000', flashDuration: 100, fadeDuration: 100 });
    expect(overridesOf(grid).size).toBe(1);
    // expiresAt = 1000 + 100 + 100 + 2000 = 3200. Advance well past it.
    nowSpy.mockReturnValue(5000);
    grid.flashCells({ rowIds: ['b'], colIds: ['px'], color: '#00ff00' });
    const overrides = overridesOf(grid);
    // The stale 'a' entry was swept; only the fresh 'b' entry remains.
    expect(overrides.has('a\0px')).toBe(false);
    expect(overrides.has('b\0px')).toBe(true);
    nowSpy.mockRestore();
    grid.destroy();
  });

  it('flashCells with enableCellChangeFlash: false is a no-op (stages nothing)', () => {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'vg-theme-quartz';
    document.body.appendChild(container);
    const grid = new VelocityGrid<{ id: string; px: number }>(container, {
      columnDefs: [{ field: 'id' }, { field: 'px' }],
      getRowId: (r) => r.id,
      theme: 'vg-theme-quartz',
      // enableCellChangeFlash defaults to false/undefined.
    });
    grid.flashCells({ rowIds: ['a'], colIds: ['px'], color: '#ff0000' });
    expect(overridesOf(grid).size).toBe(0);
    grid.destroy();
  });
});
