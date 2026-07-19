/**
 * Cycle 26 — regression locks for the per-scroll-event redundancy cuts in
 * ViewportManager (the "scroll-coalescing" work):
 *
 *   1. `syncSizer` skips its DOM reads + style writes while neither the
 *      content extent (`maxScroll*`) nor the canvas bounds changed — a
 *      scroll-position change alone must not touch the sizer.
 *   2. Vertical-only scroll ticks skip `detectVirtualColumnsChanged`
 *      (they cannot move the horizontal window); horizontal ticks and
 *      plain recomputes still detect.
 *   3. The widened-overscan single-pass prediction produces the SAME
 *      viewport state as the old base+widened double compute — including
 *      across a resize, where the predicted bodyHeight goes stale and the
 *      corrective pass must land the exact post-resize geometry.
 */
import { describe, it, expect, vi } from 'vitest';
import { ViewportManager, type ViewportManagerDeps } from '../src/core/viewportManager';
import { DisposableRegistry } from '../src/core/disposable';
import { TypedEventEmitter } from '../src/core/eventEmitter';
import type { CGridEvent } from '../src/types';
import type { Subgrid } from '../src/core/subgrid';
import type { ColumnLayout } from '../src/core/layout';

function header(height = 32): Subgrid {
  return {
    type: 'header',
    isHeader: true, isData: false, isTotals: false, isFooter: false,
    getRowCount: () => 1,
    getRowHeight: () => height,
    getCell: () => null,
  };
}
function data(rowCount = 1000, rowHeight = 30): Subgrid {
  return {
    type: 'data',
    isHeader: false, isData: true, isTotals: false, isFooter: false,
    getRowCount: () => rowCount,
    getRowHeight: () => rowHeight,
    getCell: () => null,
  };
}

function makeHarness(opts: {
  containerWidth?: number;
  containerHeight?: number;
  columns?: ColumnLayout[];
  rowCount?: number;
} = {}) {
  const root = document.createElement('div');
  const scroller = document.createElement('div');
  const sizer = document.createElement('div');
  root.appendChild(scroller);
  scroller.appendChild(sizer);
  document.body.appendChild(root);
  const cw = opts.containerWidth ?? 300;
  const ch = opts.containerHeight ?? 200;
  Object.defineProperty(scroller, 'clientWidth', { value: cw, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: ch, configurable: true });
  Object.defineProperty(root, 'clientWidth', { value: cw, configurable: true });
  Object.defineProperty(root, 'clientHeight', { value: ch, configurable: true });

  const state = {
    columnLayout: opts.columns ?? ([
      { colId: 'a', left: 0, width: 400 },
      { colId: 'b', left: 400, width: 400 },
      { colId: 'c', left: 800, width: 400 },
    ] as ColumnLayout[]),
    subgrids: [header(32), data(opts.rowCount ?? 1000, 30)],
    canvasBounds: { width: cw, height: ch },
    options: { rowHeight: 30 } as Record<string, unknown>,
    rowHeight: 30,
    destroyed: false,
  };
  const events = new TypedEventEmitter<CGridEvent>();
  const deps: ViewportManagerDeps = {
    disposables: new DisposableRegistry(),
    events,
    scroller,
    sizer,
    root,
    getColumnLayout: () => state.columnLayout,
    getSubgrids: () => state.subgrids,
    getCanvasBounds: () => state.canvasBounds,
    getOptions: () => state.options,
    getRowHeightFallback: () => state.rowHeight,
    getRowHeightIndex: () => null,
    afterRecompute: vi.fn(),
    afterScrollTick: vi.fn(),
    isDestroyed: () => state.destroyed,
    dispatchViewportRequest: vi.fn(() => Promise.resolve()),
  };
  const manager = new ViewportManager(deps);
  manager.recompute();
  return { manager, events, scroller, sizer, state };
}

describe('syncSizer skip — scroll must not touch the sizer', () => {
  it('leaves the sizer style untouched across scroll-driven recomputes', () => {
    const h = makeHarness();
    // Baseline application happened in the constructor-time recompute.
    const w0 = h.sizer.style.width;
    const h0 = h.sizer.style.height;
    expect(w0).not.toBe('');
    // Sentinel: any re-application would overwrite these.
    h.sizer.style.width = '1234px';
    h.sizer.style.height = '5678px';
    h.manager.onScrollerScroll(0, 90);
    h.manager.onScrollerScroll(0, 180);
    h.manager.onScrollerScroll(50, 180);
    expect(h.sizer.style.width).toBe('1234px');
    expect(h.sizer.style.height).toBe('5678px');
  });

  it('re-applies when the content extent changes (rows added)', () => {
    const h = makeHarness({ rowCount: 100 });
    const h0 = h.sizer.style.height;
    // Grow the data subgrid → maxScrollTop moves → sizer must re-apply.
    h.state.subgrids = [header(32), data(5000, 30)];
    h.manager.recompute();
    expect(h.sizer.style.height).not.toBe(h0);
  });

  it('re-applies when the canvas bounds change (resize)', () => {
    const h = makeHarness();
    h.sizer.style.height = '5678px';
    h.state.canvasBounds = { width: 300, height: 400 };
    h.manager.recompute();
    expect(h.sizer.style.height).not.toBe('5678px');
  });
});

describe('virtualColumnsChanged — vertical ticks skip detection', () => {
  it('horizontal scroll still emits virtualColumnsChanged', () => {
    // 40 narrow columns in a 300px container → small center window that
    // shifts identity on a large horizontal jump.
    const cols: ColumnLayout[] = Array.from({ length: 40 }, (_, i) => ({
      colId: `c${i}`, left: i * 100, width: 100,
    }));
    const h = makeHarness({ columns: cols });
    const seen: CGridEvent[] = [];
    h.events.on('virtualColumnsChanged', (e) => seen.push(e));
    h.manager.onScrollerScroll(1200, 0);
    expect(seen.length).toBe(1);
    expect((seen[0] as { afterScroll?: boolean }).afterScroll).toBe(true);
  });

  it('vertical scroll cannot emit virtualColumnsChanged even if the window is stale', () => {
    const cols: ColumnLayout[] = Array.from({ length: 40 }, (_, i) => ({
      colId: `c${i}`, left: i * 100, width: 100,
    }));
    const h = makeHarness({ columns: cols });
    const seen: CGridEvent[] = [];
    h.events.on('virtualColumnsChanged', (e) => seen.push(e));
    h.manager.onScrollerScroll(0, 90);
    h.manager.onScrollerScroll(0, 300);
    expect(seen.length).toBe(0);
  });
});

describe('single-pass widened overscan — state equivalence', () => {
  it('steady scroll produces the same firstRow/lastRow window as a fresh manager at the same position', () => {
    // Manager A scrolls there across many ticks (predicted single passes);
    // manager B recomputes fresh at the same position (first-compute
    // two-pass shape). Their fetch windows must be identical.
    const a = makeHarness();
    for (let y = 30; y <= 900; y += 30) a.manager.onScrollerScroll(0, y);

    const b = makeHarness();
    b.manager.onScrollerScroll(0, 900);

    expect(a.manager.state.firstRow).toBe(b.manager.state.firstRow);
    expect(a.manager.state.lastRow).toBe(b.manager.state.lastRow);
    expect(a.manager.state.bodyHeight).toBe(b.manager.state.bodyHeight);
  });

  it('a resize between scrolls self-corrects the widened window', () => {
    const a = makeHarness();
    a.manager.onScrollerScroll(0, 300);
    // Resize: taller container → bigger bodyHeight → wider overscan.
    Object.defineProperty(a.scroller, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(a.scroller.parentElement as HTMLElement, 'clientHeight', { value: 500, configurable: true });
    a.state.canvasBounds = { width: 300, height: 500 };
    const resized = a.manager.recompute();

    const fresh = makeHarness({ containerHeight: 500 });
    fresh.manager.onScrollerScroll(0, 300);

    expect(resized.bodyHeight).toBe(fresh.manager.state.bodyHeight);
    expect(resized.firstRow).toBe(fresh.manager.state.firstRow);
    expect(resized.lastRow).toBe(fresh.manager.state.lastRow);
  });
});
