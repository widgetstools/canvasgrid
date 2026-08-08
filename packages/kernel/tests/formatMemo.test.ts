/**
 * Cycle 26 (W2) — per-column formatted-value memo locks.
 *
 * `formatNumber`/`formatText` run per data cell per paint (the Tier-1
 * bitmap key embeds `valueFormatted`, so even raster-cache hits paid the
 * formatter call + string alloc). Both pass `data: undefined`, making the
 * output a pure function of (formatter identity, value) — the memo turns
 * repeat formats into a Map hit and must invalidate ONLY on formatter
 * identity change.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { createWorkerHost } from '../src/worker/worker';
import type { VelocityGridOptions } from '../src/types/options';

beforeAll(() => {
  (globalThis as any).Worker = class {
    listeners: Array<(e: { data: any }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: any }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  if (typeof (globalThis as any).Path2D === 'undefined') {
    (globalThis as any).Path2D = class { constructor(_d?: string) {} };
  }
  (globalThis as any).requestAnimationFrame = (() => { let id = 0; return () => ++id; })();
  (globalThis as any).cancelAnimationFrame = () => {};
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: any = {
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
      beginPath: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      setTransform: vi.fn(), clearRect: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      drawImage: vi.fn(),
      measureText: () => ({ width: 50 }),
      fillStyle: '', strokeStyle: '', font: '', textBaseline: '',
      textAlign: '', lineWidth: 1, globalAlpha: 1,
      lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, shadowColor: '',
      globalCompositeOperation: 'source-over', imageSmoothingEnabled: true,
      direction: 'inherit', filter: 'none',
    };
    const perCanvas = new WeakMap<object, any>();
    return function (this: object) {
      let ctx = perCanvas.get(this);
      if (!ctx) { ctx = { ...fakeCtx, canvas: this }; perCanvas.set(this, ctx); }
      return ctx;
    };
  })() as any;
});

function buildWiredGrid(cols: unknown[]) {
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
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`, px: 101.25, name: 'ACME',
  }));
  const grid = new VelocityGrid(container, {
    columnDefs: cols as VelocityGridOptions<{ id: string; px: number; name: string }>['columnDefs'],
    getRowId: (r) => r.id,
    rowData: rows,
  } as VelocityGridOptions<{ id: string; px: number; name: string }>);
  const restore = () => { (globalThis as any).Worker = prevWorker; container.remove(); };
  return { grid, g: grid as any, restore };
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('formatted-value memo', () => {
  it('numeric formatter runs ONCE per distinct value across repeated formats', async () => {
    const fmt = vi.fn(({ value }: { value: number }) => `$${value.toFixed(2)}`);
    const { grid, g, restore } = buildWiredGrid([
      { field: 'id' },
      { field: 'px', type: 'number', valueFormatter: fmt },
    ]);
    await tick();
    fmt.mockClear();
    // 20 rows share the value 101.25 — a full cellAt sweep over the rows
    // (what a paint pass does) must invoke the formatter exactly once.
    for (let r = 0; r < 20; r++) {
      expect(g.cellAt(r, 'px')?.valueFormatted).toBe('$101.25');
    }
    expect(fmt).toHaveBeenCalledTimes(1);
    // A second sweep (next paint) is fully memoized.
    for (let r = 0; r < 20; r++) g.cellAt(r, 'px');
    expect(fmt).toHaveBeenCalledTimes(1);
    grid.destroy();
    restore();
  });

  it('distinct values each format once', async () => {
    const fmt = vi.fn(({ value }: { value: number }) => `#${value}`);
    const { g, grid, restore } = buildWiredGrid([
      { field: 'id' },
      { field: 'px', type: 'number', valueFormatter: fmt },
    ]);
    await tick();
    fmt.mockClear();
    expect(g.formatNumber('px', 1)).toBe('#1');
    expect(g.formatNumber('px', 2)).toBe('#2');
    expect(g.formatNumber('px', 1)).toBe('#1');
    expect(fmt).toHaveBeenCalledTimes(2);
    grid.destroy();
    restore();
  });

  it('text formatter memoizes; no formatter is identity (unmemoized, still correct)', async () => {
    const fmt = vi.fn(({ value }: { value: string }) => value.toLowerCase());
    const { g, grid, restore } = buildWiredGrid([
      { field: 'id' },
      { field: 'name', valueFormatter: fmt },
    ]);
    await tick();
    fmt.mockClear();
    expect(g.formatText('name', 'ACME')).toBe('acme');
    expect(g.formatText('name', 'ACME')).toBe('acme');
    expect(fmt).toHaveBeenCalledTimes(1);
    // Column without a formatter: identity.
    expect(g.formatText('id', 'r3')).toBe('r3');
    grid.destroy();
    restore();
  });

  it('swapping the formatter identity invalidates the column memo', async () => {
    const { g, grid, restore } = buildWiredGrid([
      { field: 'id' },
      { field: 'px', type: 'number', valueFormatter: ({ value }: { value: number }) => `A${value}` },
    ]);
    await tick();
    expect(g.formatNumber('px', 7)).toBe('A7');
    // Same shape as editColumn / format-toolbar recompiles: the def's
    // valueFormatter function reference changes.
    const def = g.columnDefsMap.get('px');
    def.valueFormatter = ({ value }: { value: number }) => `B${value}`;
    expect(g.formatNumber('px', 7)).toBe('B7');
    grid.destroy();
    restore();
  });

  it('non-finite numbers stay empty-string and skip the memo', async () => {
    const fmt = vi.fn(() => 'should-not-run');
    const { g, grid, restore } = buildWiredGrid([
      { field: 'id' },
      { field: 'px', type: 'number', valueFormatter: fmt },
    ]);
    await tick();
    fmt.mockClear();
    expect(g.formatNumber('px', NaN)).toBe('');
    expect(g.formatNumber('px', Infinity)).toBe('');
    expect(fmt).not.toHaveBeenCalled();
    grid.destroy();
    restore();
  });

  it('cap overflow clears the column map and stays correct', async () => {
    const fmt = vi.fn(({ value }: { value: number }) => `v${value}`);
    const { g, grid, restore } = buildWiredGrid([
      { field: 'id' },
      { field: 'px', type: 'number', valueFormatter: fmt },
    ]);
    await tick();
    for (let i = 0; i < 5000; i++) g.formatNumber('px', i);
    // Past the 4096 cap the map cleared at least once; correctness holds.
    expect(g.formatNumber('px', 4999)).toBe('v4999');
    expect(g.formatNumber('px', 12)).toBe('v12');
    grid.destroy();
    restore();
  });
});
