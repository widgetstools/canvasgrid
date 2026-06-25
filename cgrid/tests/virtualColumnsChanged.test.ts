// Cycle 6 / Task 8 — virtualColumnsChanged + displayedColumnsChanged source widening.
//
// virtualColumnsChanged fires when the slice of center columns materialised
// by `computeViewport` shifts. The catalyst is typically a horizontal scroll
// (the canonical "afterScroll: true" case) but a width / visibility / pin
// change that shifts the visible center slice also triggers it
// (afterScroll: false).
//
// displayedColumnsChanged.source is widened from
// `'columnGroupOpened' | 'columnDefsChanged'` to also include
// `'columnVisible' | 'columnPinned' | 'columnMoved' | 'columnsReset'`. The
// emit-site label tells listeners which mutation kicked off the change so
// they can correlate against the matching per-slot event.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CGrid } from '../src/cgrid';
import { resolveColumnWidths } from '../src/core/layout';

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
  containerCss = 'width:400px; height:400px;',
): { grid: CGrid<TRow>; container: HTMLDivElement } {
  const container = document.createElement('div');
  container.style.cssText = containerCss;
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

describe('virtualColumnsChanged', () => {
  it('does NOT emit on initial construction (baseline capture only)', () => {
    const events: any[] = [];
    // Build with a listener attached AFTER construction — but the
    // construction-time recomputeViewport must NOT have queued an emit.
    const { grid } = build<{ id: string; a: number; b: number }>(
      [{ field: 'id' }, { field: 'a' }, { field: 'b' }],
    );
    grid.on('virtualColumnsChanged', (e) => events.push(e));
    // Force a no-op viewport recompute — same range, no emit.
    (grid as any).recomputeViewport();
    expect(events).toEqual([]);
    grid.destroy();
  });

  it('emits with afterScroll: true after a horizontal scroll that shifts the center slice', () => {
    // Narrow container + many wide columns so center virtualisation has slack.
    const cols = [{ field: 'id' as const, width: 80, pinned: 'left' as const }];
    for (let i = 0; i < 20; i++) cols.push({ field: `c${i}` as const, width: 150 } as any);
    const { grid } = build<{ id: string }>(cols, [], 'width:400px; height:400px;');
    // Force a non-zero scroller size so virtualisation actually kicks in.
    // happy-dom returns 0 for clientWidth without explicit layout.
    Object.defineProperty((grid as any).scroller, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty((grid as any).scroller, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty((grid as any).root, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty((grid as any).root, 'clientHeight', { value: 400, configurable: true });
    // Re-resolve widths now that we know the real container size, then
    // re-baseline the virtual-col-range against the forced size.
(grid as any).columnLayout = resolveColumnWidths((grid as any).columnOrder, 400);
    (grid as any).prevVirtualColRange = null;
    (grid as any).recomputeViewport();
    const events: any[] = [];
    grid.on('virtualColumnsChanged', (e) => events.push(e));
    // Simulate a horizontal scroll event from the native scroller.
    (grid as any).onScrollerScroll(1200, 0);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toMatchObject({ type: 'virtualColumnsChanged', afterScroll: true });
    grid.destroy();
  });

  it('emits with afterScroll: false when a column mutation shifts the center slice', () => {
    const cols = [
      { field: 'id' as const, width: 80 },
      { field: 'a', width: 100 },
      { field: 'b', width: 100 },
    ];
    const { grid } = build<{ id: string; a: number; b: number }>(cols);
    const events: any[] = [];
    grid.on('virtualColumnsChanged', (e) => events.push(e));
    // Hiding the trailing column shifts `last` from 'b' → 'a' so the
    // first/last colId tuple changes and detect fires with `afterScroll:
    // false` (the mutation path runs recomputeViewport without the
    // scroll flag).
    grid.setColumnsVisible(['b'], false);
    expect(events.some((e) => e.afterScroll === false)).toBe(true);
    grid.destroy();
  });

  it('does NOT emit a duplicate when scroll lands on the same center slice', () => {
    const cols = [{ field: 'id' as const, width: 80, pinned: 'left' as const }];
    for (let i = 0; i < 4; i++) cols.push({ field: `c${i}` as const, width: 100 } as any);
    const { grid } = build<{ id: string }>(cols, [], 'width:800px; height:400px;');
    Object.defineProperty((grid as any).scroller, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty((grid as any).scroller, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty((grid as any).root, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty((grid as any).root, 'clientHeight', { value: 400, configurable: true });
(grid as any).columnLayout = resolveColumnWidths((grid as any).columnOrder, 800);
    (grid as any).prevVirtualColRange = null;
    (grid as any).recomputeViewport(); // baseline
    const events: any[] = [];
    grid.on('virtualColumnsChanged', (e) => events.push(e));
    // Tiny horizontal scroll inside the same materialised range — first/last
    // unchanged — no emit.
    (grid as any).onScrollerScroll(2, 0);
    expect(events).toEqual([]);
    grid.destroy();
  });
});

describe('displayedColumnsChanged source widening', () => {
  it('setColumnsPinned emits displayedColumnsChanged with source: columnPinned', () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a' }],
    );
    const events: any[] = [];
    grid.on('displayedColumnsChanged', (e) => events.push(e));
    grid.setColumnsPinned(['a'], 'right');
    expect(events.some((e) => e.source === 'columnPinned')).toBe(true);
    grid.destroy();
  });

  it('resetColumnState emits displayedColumnsChanged with source: columnsReset', async () => {
    const { grid } = build<{ id: string; a: number }>(
      [{ field: 'id' }, { field: 'a' }],
    );
    // Mutate first so reset has work to do. (setColumnsVisible sends an
    // updateColumns request to the worker that the mock never responds to —
    // we don't care, we only need the resolved-state mutation to have
    // happened on main.)
    grid.setColumnsVisible(['a'], false);
    const events: any[] = [];
    grid.on('displayedColumnsChanged', (e) => events.push(e));
    const w: any = (grid as any).workerClient.worker;
    const postsBefore = w.postMessage.mock.calls.length;
    grid.resetColumnState();
    // resetColumnState fires an updateColumns request inside the .then() of
    // a Promise chain. Resolve every still-pending worker request so the
    // chain completes.
    const callsAfter = w.postMessage.mock.calls.slice(postsBefore);
    for (const [msg] of callsAfter) {
      if (msg && typeof msg === 'object' && 'id' in msg && msg.type === 'updateColumns') {
        w.listeners.forEach((cb: any) =>
          cb({ data: { id: msg.id, type: 'updateColumns', visibleCount: 0 } }));
      }
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(events.some((e) => e.source === 'columnsReset')).toBe(true);
    grid.destroy();
  });
});
