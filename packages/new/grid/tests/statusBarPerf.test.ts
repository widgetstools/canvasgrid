/**
 * Cycle 13 / Task 5 — frame-batched status-bar refresh + perf gate.
 *
 * StatusBarHost wraps each mounted panel's `refresh()` with an rAF
 * scheduler so a burst of grid events (selection / filter / rowData)
 * collapses to one refresh per panel per frame. Status updates are
 * DOM-only — they MUST NOT call `cgridCanvas.requestRepaint`. These
 * cases lock both invariants in.
 *
 * Regression this catches:
 *   1. A future commit that has the status bar tickle the canvas
 *      paint loop (e.g. by writing through the api's `redrawRows`
 *      surface) — the spy in test 1 would fire.
 *   2. A future commit that drops the rAF batching (panels refresh
 *      synchronously on every event) — test 2 would observe more
 *      than one refresh per panel per burst.
 *   3. A regression where the rAF handle is held across frames and
 *      stops re-arming — test 3 would observe < 5 refreshes for 5
 *      separate frames.
 *   4. A regression where the per-panel try/catch around
 *      `originalRefresh()` is dropped — test 4 would see the
 *      sibling's refresh skipped after the thrower's throw escapes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import { StatusBarHost } from '../src/interaction/statusBar/host';
import { StatusPanelRegistry } from '../src/interaction/statusBar/registry';
import type { IStatusPanelComp, StatusPanelParams, StatusBarPosition } from '../src/interaction/statusBar/types';

// Worker + canvas stubs so VelocityGrid construction completes under
// happy-dom — same shape as the customStatusPanel.test.ts setup.
beforeAll(() => {
  (globalThis as unknown as { Worker: unknown }).Worker = class {
    listeners: Array<(e: { data: unknown }) => void> = [];
    constructor(public url: URL) {}
    postMessage = vi.fn();
    addEventListener = (_: string, cb: (e: { data: unknown }) => void) => this.listeners.push(cb);
    terminate = vi.fn();
  };
  HTMLCanvasElement.prototype.getContext = (() => {
    const fakeCtx: Record<string, unknown> = {
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
    return () => fakeCtx as unknown as CanvasRenderingContext2D;
  })() as typeof HTMLCanvasElement.prototype.getContext;
});

/** Minimal emitter that satisfies the slice of `VelocityGridApi` the count +
 *  agg panels read (and that we want to drive in unit tests). Used as
 *  the `api` passed to `StatusBarHost` so each panel's `init()` can
 *  register its real listener path. */
interface ApiEmitter {
  addEventListener: (type: string, handler: () => void) => () => void;
  emit: (type: string) => void;
}

function makeApiEmitter(): ApiEmitter {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type, handler) {
      let bucket = listeners.get(type);
      if (!bucket) { bucket = new Set(); listeners.set(type, bucket); }
      bucket.add(handler);
      return () => { bucket?.delete(handler); };
    },
    emit(type) {
      const bucket = listeners.get(type);
      if (!bucket) return;
      // Copy so unsubscribes mid-emit don't mutate the iteration set.
      for (const h of Array.from(bucket)) h();
    },
  };
}

/** Test panel — subscribes to `selectionChanged` in `init()` and bumps
 *  a counter on every `refresh()`. The host swaps `refresh` for the
 *  rAF scheduler at mount, so subsequent counter bumps only happen on
 *  flush. */
class CountingPanel implements IStatusPanelComp {
  refreshCount = 0;
  readonly gui: HTMLDivElement = document.createElement('div');
  private off: (() => void) | null = null;
  init(params: StatusPanelParams): void {
    const api = params.api as ApiEmitter;
    this.off = api.addEventListener('selectionChanged', () => this.refresh());
    this.gui.className = 'vg-counting-status-panel';
  }
  getGui(): HTMLElement { return this.gui; }
  refresh(): void { this.refreshCount += 1; }
  destroy(): void { this.off?.(); }
}

/** Test panel — throws on every `refresh()`. Used to verify the
 *  per-panel try/catch around `originalRefresh()` keeps siblings
 *  running. */
class ThrowingPanel implements IStatusPanelComp {
  readonly gui: HTMLDivElement = document.createElement('div');
  private off: (() => void) | null = null;
  init(params: StatusPanelParams): void {
    const api = params.api as ApiEmitter;
    this.off = api.addEventListener('selectionChanged', () => this.refresh());
    this.gui.className = 'vg-throwing-status-panel';
  }
  getGui(): HTMLElement { return this.gui; }
  refresh(): void { throw new Error('counting panel refresh blew up'); }
  destroy(): void { this.off?.(); }
}

function makeRegistry(): StatusPanelRegistry {
  const r = new StatusPanelRegistry();
  r.register('counting', CountingPanel);
  r.register('thrower', ThrowingPanel);
  return r;
}

function makeRoot(): HTMLElement {
  const root = document.createElement('div');
  Object.assign(root.style, { width: '800px', height: '600px', position: 'relative' });
  document.body.appendChild(root);
  return root;
}

/** rAF stub state — captured callbacks pile up until `flushRaf()`
 *  invokes them. Each test owns its own queue via beforeEach so cross-
 *  test bleed doesn't accumulate frames. */
let pendingRafCallbacks: Array<FrameRequestCallback> = [];
let nextRafId = 1;

function flushRaf(): void {
  const cbs = pendingRafCallbacks;
  pendingRafCallbacks = [];
  for (const cb of cbs) cb(performance.now());
}

beforeEach(() => {
  pendingRafCallbacks = [];
  nextRafId = 1;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    pendingRafCallbacks.push(cb);
    return nextRafId++;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((_id: number) => {
    // Tests that exercise cancellation don't rely on the queue actually
    // shrinking; they assert via behavioural state (no flush happened).
    // Keep the noop here so destroy / setStatusBarDef can call cAF
    // without throwing.
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  pendingRafCallbacks = [];
});

describe('Cycle 13 / Task 5 — status-bar perf gate + rAF batching', () => {
  // Case 1 — the perf gate. Status-bar event subscriptions write only
  // DOM text + the `hidden` flag; nothing in that path may touch the
  // canvas paint loop. Trigger 100 selectionChanged events through the
  // grid's own emitter (bypassing the SelectionModel which legitimately
  // does call `requestRepaint`) and assert the spy stayed at zero.
  it('triggering 100 selectionChanged events does NOT call cgridCanvas.requestRepaint', () => {
    const container = document.createElement('div');
    container.style.cssText = 'width:800px; height:600px;';
    container.className = 'vg-theme-quartz';
    document.body.appendChild(container);
    const grid = new VelocityGrid<{ id: string }>(container, {
      columnDefs: [{ field: 'id' }],
      getRowId: (r) => r.id,
      statusBar: {
        statusPanels: [
          { key: 'agSelectedRowCountComponent', statusPanel: 'agSelectedRowCountComponent' },
          { key: 'agAggregationComponent', statusPanel: 'agAggregationComponent' },
        ],
      },
    });
    const cgridCanvas = (grid as unknown as { cgridCanvas: { requestRepaint: () => void } }).cgridCanvas;
    const spy = vi.spyOn(cgridCanvas, 'requestRepaint');
    spy.mockClear();
    const events = (grid as unknown as {
      events: { emit: (e: { type: string; selectedRowIds: string[] }) => void };
    }).events;
    for (let i = 0; i < 100; i++) {
      events.emit({ type: 'selectionChanged', selectedRowIds: [] });
    }
    expect(spy).not.toHaveBeenCalled();
    grid.destroy();
    container.parentElement?.removeChild(container);
  });

  // Case 2 — burst of N events in one frame collapses to one refresh per
  // panel. Without the rAF batching, refreshCount would track event
  // count (100). With batching, it lands at exactly 1 per panel per
  // flushed frame.
  it('100 events in one frame collapse to a single refresh call per panel', () => {
    const root = makeRoot();
    const apiEmitter = makeApiEmitter();
    const registry = makeRegistry();
    const reserveCalls: Array<{ side: StatusBarPosition; height: number }> = [];
    const host = new StatusBarHost(root, {
      registry,
      api: apiEmitter,
      setReservedSpace: (side, height) => reserveCalls.push({ side, height }),
    }, {
      statusPanels: [
        { key: 'a', statusPanel: 'counting' },
        { key: 'b', statusPanel: 'counting' },
      ],
    });
    const a = host.getInstance('a') as CountingPanel;
    const b = host.getInstance('b') as CountingPanel;
    expect(a.refreshCount).toBe(0);
    expect(b.refreshCount).toBe(0);

    for (let i = 0; i < 100; i++) apiEmitter.emit('selectionChanged');

    // Pre-flush: every event scheduled but nothing has run yet.
    expect(a.refreshCount).toBe(0);
    expect(b.refreshCount).toBe(0);
    // Exactly one rAF callback was queued for the whole burst.
    expect(pendingRafCallbacks.length).toBe(1);

    flushRaf();

    expect(a.refreshCount).toBe(1);
    expect(b.refreshCount).toBe(1);
    host.destroy();
    root.parentElement?.removeChild(root);
  });

  // Case 3 — five separate frames each get their own refresh. Asserts
  // the rAF handle resets between flushes and the next scheduleRefresh
  // re-arms a fresh frame instead of being silently dropped.
  it('events across 5 separate rAF ticks each get their own refresh', () => {
    const root = makeRoot();
    const apiEmitter = makeApiEmitter();
    const registry = makeRegistry();
    const host = new StatusBarHost(root, {
      registry,
      api: apiEmitter,
      setReservedSpace: () => {},
    }, {
      statusPanels: [
        { key: 'a', statusPanel: 'counting' },
        { key: 'b', statusPanel: 'counting' },
      ],
    });
    const a = host.getInstance('a') as CountingPanel;
    const b = host.getInstance('b') as CountingPanel;

    for (let frame = 0; frame < 5; frame++) {
      apiEmitter.emit('selectionChanged');
      // Each frame schedules exactly one rAF callback (handle re-arms
      // on the next scheduleRefresh after a flush).
      expect(pendingRafCallbacks.length).toBe(1);
      flushRaf();
    }

    expect(a.refreshCount).toBe(5);
    expect(b.refreshCount).toBe(5);
    host.destroy();
    root.parentElement?.removeChild(root);
  });

  // Case 4 — a panel that throws inside `refresh()` MUST NOT prevent
  // its neighbours from refreshing on the same flush. Per-panel
  // try/catch around `slot.originalRefresh()` is what makes the bar
  // tolerant to one broken custom panel taking down all the others.
  it('a panel that throws in refresh does NOT prevent siblings from refreshing under rAF dispatch', () => {
    const root = makeRoot();
    const apiEmitter = makeApiEmitter();
    const registry = makeRegistry();
    const host = new StatusBarHost(root, {
      registry,
      api: apiEmitter,
      setReservedSpace: () => {},
    }, {
      statusPanels: [
        { key: 'before', statusPanel: 'counting' },
        { key: 'broken', statusPanel: 'thrower' },
        { key: 'after', statusPanel: 'counting' },
      ],
    });
    const before = host.getInstance('before') as CountingPanel;
    const after = host.getInstance('after') as CountingPanel;
    // Silence the console.error side effect so the test output stays
    // clean — the catch path under flushPending logs the thrower's
    // error and we don't want it polluting the run.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    apiEmitter.emit('selectionChanged');
    expect(() => flushRaf()).not.toThrow();

    expect(before.refreshCount).toBe(1);
    expect(after.refreshCount).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    host.destroy();
    root.parentElement?.removeChild(root);
  });
});
