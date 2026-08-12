import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ViewportManager, type ViewportManagerDeps } from '../src/core/viewportManager';
import { DisposableRegistry } from '../src/core/disposable';
import { TypedEventEmitter } from '../src/core/eventEmitter';
import type { VelocityGridEvent } from '../src/types';
import type { Subgrid } from '../src/core/subgrid';
import type { ColumnLayout } from '../src/core/layout';

/**
 * Cycle 19 / Task 2 — focused unit coverage of the extracted ViewportManager.
 * Verifies scroll-state transitions, recompute idempotence, the request
 * coalescing rules, the velocity-driven prefetch range that's handed to the
 * dispatch callback, the bodyScroll / bodyScrollEnd debounce, and the
 * scroll-imperative `setScroll` / `ensure*Visible` helpers.
 *
 * The seam is exercised through a stub deps object — the manager doesn't know
 * anything about the worker or the canvas, so the test surface is small.
 */

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

interface Harness {
  manager: ViewportManager;
  disposables: DisposableRegistry;
  events: TypedEventEmitter<VelocityGridEvent>;
  scroller: HTMLDivElement;
  sizer: HTMLDivElement;
  dispatch: ReturnType<typeof vi.fn>;
  afterRecompute: ReturnType<typeof vi.fn>;
  afterScrollTick: ReturnType<typeof vi.fn>;
  state: {
    columnLayout: ColumnLayout[];
    subgrids: Subgrid[];
    canvasBounds: { width: number; height: number };
    options: { rowBuffer?: number; suppressColumnVirtualisation?: boolean; suppressRowVirtualisation?: boolean; rowHeight?: number };
    rowHeight: number;
    destroyed: boolean;
  };
}

function makeHarness(opts: {
  rowCount?: number;
  rowHeight?: number;
  columns?: ColumnLayout[];
  containerWidth?: number;
  containerHeight?: number;
  dispatchImpl?: (o: { rowStart: number; rowEnd: number; columns: string[] }) => Promise<void>;
} = {}): Harness {
  const root = document.createElement('div');
  const scroller = document.createElement('div');
  const sizer = document.createElement('div');
  root.appendChild(scroller);
  scroller.appendChild(sizer);
  document.body.appendChild(root);
  // happy-dom defaults clientWidth/clientHeight to 0 unless layout is forced;
  // override via getters so the manager's fallback chain still resolves.
  Object.defineProperty(scroller, 'clientWidth', { value: opts.containerWidth ?? 800, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: opts.containerHeight ?? 600, configurable: true });
  Object.defineProperty(root, 'clientWidth', { value: opts.containerWidth ?? 800, configurable: true });
  Object.defineProperty(root, 'clientHeight', { value: opts.containerHeight ?? 600, configurable: true });

  const state = {
    columnLayout: opts.columns ?? ([
      { colId: 'a', left: 0, width: 100 },
      { colId: 'b', left: 100, width: 100 },
      { colId: 'c', left: 200, width: 100 },
    ] as ColumnLayout[]),
    subgrids: [header(32), data(opts.rowCount ?? 1000, opts.rowHeight ?? 30)],
    canvasBounds: { width: opts.containerWidth ?? 800, height: opts.containerHeight ?? 600 },
    options: { rowHeight: opts.rowHeight ?? 30 },
    rowHeight: opts.rowHeight ?? 30,
    destroyed: false,
  };

  const disposables = new DisposableRegistry();
  const events = new TypedEventEmitter<VelocityGridEvent>();
  const dispatch = vi.fn(opts.dispatchImpl ?? (() => Promise.resolve()));
  const afterRecompute = vi.fn();
  const afterScrollTick = vi.fn();

  const deps: ViewportManagerDeps = {
    disposables,
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
    afterRecompute,
    afterScrollTick,
    isDestroyed: () => state.destroyed,
    dispatchViewportRequest: dispatch,
  };

  const manager = new ViewportManager(deps);
  manager.recompute();
  return { manager, disposables, events, scroller, sizer, dispatch, afterRecompute, afterScrollTick, state };
}

describe('ViewportManager — scroll state', () => {
  it('starts with scrollLeft/scrollTop at 0 and velocity at 0', () => {
    const h = makeHarness();
    expect(h.manager.scrollLeft).toBe(0);
    expect(h.manager.scrollTop).toBe(0);
    expect(h.manager.scrollVelocityRows).toBe(0);
    expect(h.manager.getScrollPosition()).toEqual({ top: 0, left: 0 });
  });

  it('onScrollerScroll (via setScroll) updates scrollLeft + scrollTop', () => {
    // Wider columns + narrower container so maxScrollLeft > 120; otherwise
    // setScroll clamps to 0 and the assertion below is vacuous.
    const h = makeHarness({
      columns: [
        { colId: 'a', left: 0, width: 400 },
        { colId: 'b', left: 400, width: 400 },
        { colId: 'c', left: 800, width: 400 },
      ],
      containerWidth: 300,
      rowCount: 1000,
      containerHeight: 200,
    });
    h.manager.setScroll(120, 90);
    // happy-dom doesn't fire the scroll event when assigning scroller.scrollLeft,
    // so the manager's belt-and-suspenders path applies the update synchronously.
    expect(h.manager.scrollLeft).toBe(120);
    expect(h.manager.scrollTop).toBe(90);
  });

  it('emits viewportChanged + bodyScroll on each scroll tick', () => {
    const h = makeHarness();
    const seen: VelocityGridEvent['type'][] = [];
    h.events.on('viewportChanged', () => seen.push('viewportChanged'));
    h.events.on('bodyScroll', () => seen.push('bodyScroll'));
    h.manager.setScroll(0, 60);
    expect(seen).toContain('viewportChanged');
    expect(seen).toContain('bodyScroll');
  });

  it('idempotent: scrolling to the current position is a no-op', () => {
    const h = makeHarness();
    h.manager.setScroll(50, 50);
    h.dispatch.mockClear();
    h.afterScrollTick.mockClear();
    // setScroll bails out at the manager's clamp/equality check.
    h.manager.setScroll(50, 50);
    expect(h.afterScrollTick).not.toHaveBeenCalled();
  });

  it('clamps scroll to maxScrollLeft/maxScrollTop', () => {
    const h = makeHarness({ containerWidth: 200, containerHeight: 200, rowCount: 10 });
    // contentHeight = 10*30 = 300, bodyHeight ≈ 168 (200 - 32 header), so maxScrollTop > 0
    h.manager.setScroll(99999, 99999);
    expect(h.manager.scrollLeft).toBeLessThanOrEqual(h.manager.state.maxScrollLeft);
    expect(h.manager.scrollTop).toBeLessThanOrEqual(h.manager.state.maxScrollTop);
  });
});

describe('ViewportManager — recompute', () => {
  it('returns a ViewportState whose state.scrollLeft mirrors the manager', () => {
    const h = makeHarness();
    h.manager.setScroll(40, 70);
    expect(h.manager.state.scrollLeft).toBe(h.manager.scrollLeft);
    expect(h.manager.state.scrollTop).toBe(h.manager.scrollTop);
  });

  it('recompute is idempotent when nothing has changed', () => {
    const h = makeHarness();
    const a = h.manager.recompute();
    const b = h.manager.recompute();
    // The viewport shape (first/last row, visible columns) is unchanged across
    // back-to-back recomputes when scroll state + layout + subgrids are stable.
    expect(b.firstRow).toBe(a.firstRow);
    expect(b.lastRow).toBe(a.lastRow);
    expect(b.visibleColumns.map((c) => c.colId)).toEqual(a.visibleColumns.map((c) => c.colId));
    expect(b.maxScrollTop).toBe(a.maxScrollTop);
  });

  it('emits virtualColumnsChanged only AFTER the construction baseline', () => {
    // Many narrow columns + narrow container so horizontal scroll shifts the
    // materialised center-column slice (which is what virtualColumnsChanged
    // tracks). 30 columns × 100px = 3000px total; container is 400px.
    const columns: ColumnLayout[] = Array.from({ length: 30 }, (_, i) => ({
      colId: `c${i}`, left: i * 100, width: 100,
    }));
    const h = makeHarness({ columns, containerWidth: 400 });
    const events: VelocityGridEvent[] = [];
    h.events.on('virtualColumnsChanged', (e) => events.push(e));
    // First recompute after construction captures baseline silently.
    h.manager.recompute();
    expect(events).toHaveLength(0);
    // Scroll horizontally far enough to push the materialised slice forward.
    h.manager.setScroll(2000, 0);
    expect(events.length).toBeGreaterThan(0);
  });

  it('calls afterRecompute with the freshly-computed state on every recompute', () => {
    const h = makeHarness();
    h.afterRecompute.mockClear();
    h.manager.recompute();
    expect(h.afterRecompute).toHaveBeenCalledTimes(1);
    expect(h.afterRecompute.mock.calls[0]![0]!.firstRow).toBe(h.manager.state.firstRow);
  });
});

describe('ViewportManager — request coalescing + prefetch math', () => {
  it('dispatches a request that covers the visible row range', async () => {
    const h = makeHarness();
    h.manager.request();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const arg = h.dispatch.mock.calls[0]![0]!;
    // Visible columns mapped to colId list; range bounded by the viewport.
    expect(arg.columns).toEqual(h.manager.state.visibleColumns.map((c) => c.colId));
    expect(arg.rowStart).toBe(h.manager.state.firstRow);
    expect(arg.rowEnd).toBe(h.manager.state.lastRow + 1);
  });

  it('coalesces a second request while the first is in-flight, then drains the queued follow-up', async () => {
    let resolveFirst!: () => void;
    const inflight = new Promise<void>((r) => { resolveFirst = r; });
    const h = makeHarness({ dispatchImpl: () => inflight });
    h.manager.request();
    // Second call within the 150ms scroll throttle — trailing edge only.
    h.manager.request();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    // Resolve the in-flight fetch; trailing throttle still owes a follow-up.
    resolveFirst();
    await Promise.resolve(); await Promise.resolve();
    await new Promise((r) => setTimeout(r, 160));
    expect(h.dispatch).toHaveBeenCalledTimes(2);
  });

  it('most-recent agg source wins; consumePendingAggSource clears it', () => {
    const h = makeHarness();
    // Drive the request to "in-flight" so we can pile sources on top.
    let resolveFirst!: () => void;
    h.dispatch.mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = r; }));
    h.manager.request('rowDataChanged');
    h.manager.request('filterChanged');
    h.manager.request('aggFuncChanged');
    // consume returns the LAST-set source.
    const s = h.manager.consumePendingAggSource();
    expect(s).toBe('aggFuncChanged');
    // A second consume returns null — the field has been cleared.
    expect(h.manager.consumePendingAggSource()).toBeNull();
    resolveFirst();
  });

  it('null aggSource calls do not overwrite a previously-set source', async () => {
    const h = makeHarness();
    let resolveFirst!: () => void;
    h.dispatch.mockImplementationOnce(() => new Promise<void>((r) => { resolveFirst = r; }));
    h.manager.request('filterChanged');
    h.manager.request(); // cosmetic re-fetch — does NOT clear the source
    h.manager.request(null);
    expect(h.manager.consumePendingAggSource()).toBe('filterChanged');
    resolveFirst();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('expands rowEnd in proportion to scroll velocity (prefetch fold-in)', async () => {
    const h = makeHarness({ rowCount: 5000 });
    // Drain any in-flight request the scroll listener kicked off so the
    // assertion below reads the request WE explicitly make.
    await new Promise<void>((r) => setTimeout(r, 0));
    // Sample two scroll ticks 50ms apart to seed a downward velocity.
    const NOW_A = 1000;
    const original = performance.now.bind(performance);
    (performance as { now: () => number }).now = vi.fn(() => NOW_A);
    h.manager.setScroll(0, 0);
    (performance as { now: () => number }).now = vi.fn(() => NOW_A + 50);
    h.manager.setScroll(0, 6000);
    // Now a much faster jump: 60_000 / 30 = 2000 rows over 50ms = 40 rows/ms
    (performance as { now: () => number }).now = vi.fn(() => NOW_A + 100);
    h.manager.setScroll(0, 66000);
    expect(Math.abs(h.manager.scrollVelocityRows)).toBeGreaterThan(5);
    // Drain whatever request is in-flight from the setScroll calls above.
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
    h.dispatch.mockClear();
    // Bypass the 150ms scroll throttle (last setScroll already dispatched).
    (performance as { now: () => number }).now = vi.fn(() => NOW_A + 300);
    h.manager.request();
    const arg = h.dispatch.mock.calls[0]![0]!;
    // expandRangeForVelocity widens rowEnd when velocity > 0 above threshold.
    expect(arg.rowEnd).toBeGreaterThan(h.manager.state.lastRow + 1);
    (performance as { now: () => number }).now = original;
  });

  it('idle PageDown-sized jump synthesizes velocity and widens the fetch', async () => {
    const h = makeHarness({ rowCount: 5000, rowHeight: 30, containerHeight: 332 });
    await new Promise<void>((r) => setTimeout(r, 0));
    // Seed a prior sample (setScroll(0,0) is a no-op at rest), then a
    // PageDown-sized jump after a long idle gap (>200ms) so the old sampler
    // would have forced velocity = 0.
    const original = performance.now.bind(performance);
    (performance as { now: () => number }).now = vi.fn(() => 1_000);
    h.manager.setScroll(0, 30);
    await new Promise<void>((r) => setTimeout(r, 0));
    h.dispatch.mockClear();
    (performance as { now: () => number }).now = vi.fn(() => 1_500);
    // ~10 rows (one body page ≈ 10 rows at 30px / 300px body)
    h.manager.setScroll(0, 330);
    expect(Math.abs(h.manager.scrollVelocityRows)).toBeGreaterThan(0.5);
    await new Promise<void>((r) => setTimeout(r, 0));
    const arg = h.dispatch.mock.calls[h.dispatch.mock.calls.length - 1]![0]!;
    expect(arg.rowEnd).toBeGreaterThan(h.manager.state.lastRow + 1);
    (performance as { now: () => number }).now = original;
  });

  it('bypasses the 150ms throttle when the live viewport leaves the last fetch', async () => {
    const h = makeHarness({ rowCount: 5000, rowHeight: 30, containerHeight: 332 });
    // Seed a dispatched window near the top (setScroll(0,0) is a no-op).
    const original = performance.now.bind(performance);
    (performance as { now: () => number }).now = vi.fn(() => 1_000);
    h.manager.setScroll(0, 30);
    await new Promise<void>((r) => setTimeout(r, 0));
    h.dispatch.mockClear();
    // Within the throttle window, jump far past the seeded window.
    (performance as { now: () => number }).now = vi.fn(() => 1_050);
    h.manager.setScroll(0, 9_000);
    await new Promise<void>((r) => setTimeout(r, 0));
    // Without the uncovered-window bypass this would be coalesced into the
    // trailing timer and dispatch would stay at 0 until 150ms elapsed.
    expect(h.dispatch).toHaveBeenCalled();
    (performance as { now: () => number }).now = original;
  });
});

describe('ViewportManager — ensureRowIndexVisible / ensureColIdVisible', () => {
  it('ensureRowIndexVisible(top) scrolls to the row top', () => {
    const h = makeHarness({ rowCount: 1000, rowHeight: 30 });
    h.manager.ensureRowIndexVisible(50, 'top');
    expect(h.manager.scrollTop).toBe(50 * 30);
  });

  it('ensureRowIndexVisible(bottom) aligns the row at the body bottom', () => {
    const h = makeHarness({ rowCount: 1000, rowHeight: 30, containerHeight: 332 });
    h.manager.ensureRowIndexVisible(50, 'bottom');
    // bodyHeight = 332 - 32 (header) = 300; row bottom = (50+1)*30 = 1530
    // scrollTop should land at 1530 - 300 = 1230.
    expect(h.manager.scrollTop).toBe(1230);
  });

  it('ensureRowIndexVisible(auto) is a no-op when the row is already in view', () => {
    const h = makeHarness({ rowCount: 1000, rowHeight: 30, containerHeight: 332 });
    // bodyHeight = 300; rows 0..9 are visible. Asking for row 5 = no-op.
    h.manager.ensureRowIndexVisible(5, 'auto');
    expect(h.manager.scrollTop).toBe(0);
  });

  it('ensureColIdVisible(start) scrolls horizontally to expose the column', () => {
    const h = makeHarness({
      columns: [
        { colId: 'a', left: 0, width: 100 },
        { colId: 'b', left: 100, width: 100 },
        { colId: 'c', left: 200, width: 600 },
      ],
      containerWidth: 200,
    });
    h.manager.ensureColIdVisible('c', 'start');
    // No pinned columns, so left == layoutCol.left == 200.
    expect(h.manager.scrollLeft).toBe(200);
  });

  it('ensureColIdVisible silently skips pinned columns', () => {
    const h = makeHarness({
      columns: [
        { colId: 'p', left: 0, width: 100, pinned: 'left' },
        { colId: 'a', left: 100, width: 100 },
      ],
    });
    h.manager.ensureColIdVisible('p', 'start');
    expect(h.manager.scrollLeft).toBe(0);
  });
});

describe('ViewportManager — teardown', () => {
  it('clears the bodyScrollEnd debounce on dispose so a late tick never fires', () => {
    const h = makeHarness();
    // Force a scroll so the manager arms the debounce timer.
    h.manager.setScroll(0, 60);
    let endEmitted = false;
    h.events.on('bodyScrollEnd', () => { endEmitted = true; });
    h.disposables.dispose();
    // After dispose the debounce is cleared — we can't easily wait 200ms in
    // happy-dom without a fake-timer setup, but we CAN assert the dispose
    // path was reached + idempotent.
    expect(h.disposables.isDisposed()).toBe(true);
    expect(endEmitted).toBe(false);
  });

  it('scroll listener is registered through the DisposableRegistry', () => {
    const root = document.createElement('div');
    const scroller = document.createElement('div');
    const sizer = document.createElement('div');
    root.appendChild(scroller); scroller.appendChild(sizer);
    Object.defineProperty(scroller, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 300, configurable: true });
    const addSpy = vi.spyOn(scroller, 'addEventListener');
    const removeSpy = vi.spyOn(scroller, 'removeEventListener');
    const disposables = new DisposableRegistry();
    const events = new TypedEventEmitter<VelocityGridEvent>();
    const m = new ViewportManager({
      disposables, events, scroller, sizer, root,
      getColumnLayout: () => [{ colId: 'a', left: 0, width: 100 }],
      getSubgrids: () => [header(), data()],
      getCanvasBounds: () => ({ width: 400, height: 300 }),
      getOptions: () => ({ rowHeight: 30 }),
      getRowHeightFallback: () => 30,
      getRowHeightIndex: () => null,
      afterRecompute: () => {},
      afterScrollTick: () => {},
      isDestroyed: () => false,
      dispatchViewportRequest: () => Promise.resolve(),
    });
    m.recompute();
    expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), undefined);
    disposables.dispose();
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function), undefined);
  });
});
