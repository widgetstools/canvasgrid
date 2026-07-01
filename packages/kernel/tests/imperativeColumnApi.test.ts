// Cycle 6 / Task 5 — Imperative column API unit tests.
//
// `setColumnsVisible`, `setColumnsPinned`, `setColumnWidths`, `moveColumns`
// are batch-mutation entrypoints on CGridApi. Each call:
//   - resolves every key against `columnDefsMap` (unknowns silently dropped)
//   - applies the Cycle 6 / Task 2 locks (`lockVisible` / `lockPinned`) and
//     the Cycle 6 / Task 1 lock (`lockPosition`)
//   - mutates in place via ONE re-layout + repaint
//   - fires per-call `columnVisible` / `columnPinned` / `columnResized` /
//     `columnMoved` events with `source: 'api'`
//
// `columnResized.finished` flag: false during a drag-resize tick (driven
// from the existing per-tick `resizeColumn`), true on every imperative
// width mutation AND on mouseup of a drag-resize (Cycle 6 / Task 5).

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';

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

function build<TRow extends { id: string }>(
  cols: any[],
  rows: TRow[] = [],
): { grid: CGrid<TRow>; container: HTMLDivElement } {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'cg-theme-quartz';
  document.body.appendChild(container);
  const grid = new CGrid<TRow>(container, {
    columnDefs: cols,
    getRowId: (r) => r.id,
    rowData: rows,
  });
  const w = (grid as any).workerClient.worker;
  w.listeners.forEach((cb: any) => cb({ data: { id: 1, type: 'ready' } }));
  return { grid, container };
}

describe('setColumnsVisible', () => {
  it('hides every listed leaf and fires one columnVisible event with all colIds', () => {
    const { grid } = build<{ id: string; a: number; b: number; c: number }>(
      [{ field: 'id' }, { field: 'a' }, { field: 'b' }, { field: 'c' }],
    );
    const events: any[] = [];
    grid.on('columnVisible', (e) => events.push(e));
    grid.setColumnsVisible(['a', 'b'], false);
    expect((grid as any).columnDefsMap.get('a').hide).toBe(true);
    expect((grid as any).columnDefsMap.get('b').hide).toBe(true);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      type: 'columnVisible', visible: false, source: 'api',
    });
    expect(new Set(events[0].colIds)).toEqual(new Set(['a', 'b']));
    grid.destroy();
  });

  it('lockVisible silently drops the mutation (no event, no change)', () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a', lockVisible: true }],
    );
    const events: any[] = [];
    grid.on('columnVisible', (e) => events.push(e));
    grid.setColumnsVisible(['a'], false);
    expect((grid as any).columnDefsMap.get('a').hide).toBe(false);
    expect(events).toEqual([]);
    grid.destroy();
  });

  it('does exactly one recomputeViewport per call (single re-layout invariant)', () => {
    const { grid } = build<{ id: string; a: number; b: number; c: number }>(
      [{ field: 'id' }, { field: 'a' }, { field: 'b' }, { field: 'c' }],
    );
    const spy = vi.spyOn(grid as any, 'recomputeViewport');
    spy.mockClear();
    grid.setColumnsVisible(['a', 'b', 'c'], false);
    expect(spy).toHaveBeenCalledTimes(1);
    grid.destroy();
  });

  it('unknown keys are silently dropped without throwing', () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a' }],
    );
    expect(() => grid.setColumnsVisible(['a', 'does-not-exist'], false)).not.toThrow();
    expect((grid as any).columnDefsMap.get('a').hide).toBe(true);
    grid.destroy();
  });

  it('no-op when nothing actually changes (idempotent re-hide)', () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a', hide: true }],
    );
    const events: any[] = [];
    grid.on('columnVisible', (e) => events.push(e));
    grid.setColumnsVisible(['a'], false);
    expect(events).toEqual([]);
    grid.destroy();
  });
});

describe('setColumnsPinned', () => {
  it('pins listed columns and fires columnPinned per pinned bucket', () => {
    const { grid } = build<{ id: string; a: number; b: number }>(
      [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
    );
    const events: any[] = [];
    grid.on('columnPinned', (e) => events.push(e));
    grid.setColumnsPinned(['a', 'b'], 'right');
    expect((grid as any).columnDefsMap.get('a').pinned).toBe('right');
    expect((grid as any).columnDefsMap.get('b').pinned).toBe('right');
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      type: 'columnPinned', pinned: 'right', source: 'api',
    });
    expect(new Set(events[0].colIds)).toEqual(new Set(['a', 'b']));
    grid.destroy();
  });

  it('lockPinned silently drops the mutation', () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a', pinned: 'left', lockPinned: true }],
    );
    const events: any[] = [];
    grid.on('columnPinned', (e) => events.push(e));
    grid.setColumnsPinned(['a'], null);
    expect((grid as any).columnDefsMap.get('a').pinned).toBe('left');
    expect(events).toEqual([]);
    grid.destroy();
  });

  it('does exactly one recomputeViewport per call', () => {
    const { grid } = build<{ id: string; a: number; b: number }>(
      [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
    );
    const spy = vi.spyOn(grid as any, 'recomputeViewport');
    spy.mockClear();
    grid.setColumnsPinned(['a', 'b'], 'right');
    expect(spy).toHaveBeenCalledTimes(1);
    grid.destroy();
  });

  it('null unpins a left-pinned column', () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a', pinned: 'left' }],
    );
    grid.setColumnsPinned(['a'], null);
    expect((grid as any).columnDefsMap.get('a').pinned).toBeUndefined();
    grid.destroy();
  });
});

describe('setColumnWidths', () => {
  it('updates widths and fires columnResized per changed column with finished: true', () => {
    const { grid } = build<{ id: string; a: number; b: number }>(
      [{ field: 'id', width: 100 }, { field: 'a', width: 100 }, { field: 'b', width: 100 }],
    );
    const events: any[] = [];
    grid.on('columnResized', (e) => events.push(e));
    grid.setColumnWidths([
      { key: 'a', newWidth: 200 },
      { key: 'b', newWidth: 250 },
    ]);
    expect((grid as any).columnDefsMap.get('a').width).toBe(200);
    expect((grid as any).columnDefsMap.get('b').width).toBe(250);
    expect(events.length).toBe(2);
    for (const e of events) {
      expect(e.finished).toBe(true);
      expect(e.source).toBe('api');
    }
    grid.destroy();
  });

  it('honors explicit finished: false', () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a', width: 100 }],
    );
    const events: any[] = [];
    grid.on('columnResized', (e) => events.push(e));
    grid.setColumnWidths([{ key: 'a', newWidth: 200 }], false);
    expect(events[0]).toMatchObject({ finished: false, source: 'api' });
    grid.destroy();
  });

  it('clamps to minWidth', () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a', width: 100, minWidth: 80 }],
    );
    grid.setColumnWidths([{ key: 'a', newWidth: 10 }]);
    expect((grid as any).columnDefsMap.get('a').width).toBe(80);
    grid.destroy();
  });

  it('does exactly one recomputeViewport per call', () => {
    const { grid } = build<{ id: string; a: number; b: number }>(
      [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
    );
    const spy = vi.spyOn(grid as any, 'recomputeViewport');
    spy.mockClear();
    grid.setColumnWidths([
      { key: 'a', newWidth: 200 },
      { key: 'b', newWidth: 250 },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    grid.destroy();
  });
});

describe('moveColumns', () => {
  it('moves multiple columns to start at toIndex preserving their declared order', () => {
    const { grid } = build<{ id: string; a: number; b: number; c: number; d: number }>(
      [{ field: 'id' }, { field: 'a' }, { field: 'b' }, { field: 'c' }, { field: 'd' }],
    );
    grid.moveColumns(['c', 'd'], 1);
    const order = (grid as any).columnOrder.map((c: { colId: string }) => c.colId);
    expect(order).toEqual(['id', 'c', 'd', 'a', 'b']);
    grid.destroy();
  });

  it('fires columnMoved with source: api', () => {
    const { grid } = build<{ id: string; a: number; b: number; c: number }>(
      [{ field: 'id' }, { field: 'a' }, { field: 'b' }, { field: 'c' }],
    );
    const events: any[] = [];
    grid.on('columnMoved', (e) => events.push(e));
    grid.moveColumns(['c'], 1);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.source).toBe('api');
    }
    grid.destroy();
  });

  it('lockPosition: left clamps a move-away to index 0', () => {
    const { grid } = build<{ id: string; a: number; b: number }>(
      [
        { field: 'id', lockPosition: 'left' },
        { field: 'a' },
        { field: 'b' },
      ],
    );
    grid.moveColumns(['id'], 2);
    const order = (grid as any).columnOrder.map((c: { colId: string }) => c.colId);
    // 'id' must remain pinned to index 0 by lockPosition.
    expect(order[0]).toBe('id');
    grid.destroy();
  });

  it('unknown keys are silently dropped', () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a' }],
    );
    expect(() => grid.moveColumns(['does-not-exist'], 0)).not.toThrow();
    grid.destroy();
  });
});

describe('columnResized finished flag — drag vs imperative', () => {
  it('per-tick drag emission carries finished: false + source: uiColumnResized', () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a', width: 100 }],
    );
    const events: any[] = [];
    grid.on('columnResized', (e) => events.push(e));
    // Drive the private per-tick resize call (same path the resize feature uses).
    (grid as any).resizeColumn('a', 10);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({
      colId: 'a', finished: false, source: 'uiColumnResized',
    });
    grid.destroy();
  });
});
