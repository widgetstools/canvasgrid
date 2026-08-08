/**
 * Cycle 13 / Task 4 — custom status panel API + getStatusPanel(key).
 *
 * Asserts the public surface that lets apps:
 *   1. Register custom status-panel components via the shared
 *      `VelocityGridOptions.components` channel (same map that feeds the
 *      tool-panel registry — `IStatusPanelComp` and `ToolPanel` have
 *      identical lifecycle shapes, so one channel serves both).
 *   2. Reach those custom instances at runtime via
 *      `api.getStatusPanel(key)` — returns the LIVE instance for a
 *      panel that is currently mounted, `undefined` otherwise. Apps
 *      use this to invoke panel-specific methods that aren't on the
 *      `IStatusPanelComp` contract (e.g. a snapshot getter).
 *
 * The custom panel implementations here are intentionally tiny
 * recording stubs so each test owns its own RecordingPanel state and
 * the assertions stay self-contained.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { VelocityGrid } from '../src/velocityGrid';
import type { IStatusPanelComp, StatusPanelParams } from '../src/interaction/statusBar/types';

// Same Worker + canvas stubs the cgrid.integration tests register so
// VelocityGrid construction completes under happy-dom. VelocityGrid posts to a
// worker on construction and reads a 2D context off the canvas;
// without these stubs neither code path can run.
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

/** Recording status panel — captures every lifecycle call + the
 *  params it was init'd with so tests can assert on both the call
 *  counts and the param payload (api identity + statusPanelParams
 *  pass-through). */
class RecordingStatusPanel implements IStatusPanelComp {
  initCount = 0;
  refreshCount = 0;
  destroyCount = 0;
  receivedParams: StatusPanelParams | null = null;
  readonly gui: HTMLDivElement = document.createElement('div');
  init(params: StatusPanelParams): void {
    this.initCount += 1;
    this.receivedParams = params;
    this.gui.className = 'vg-recording-status-panel';
    // Surface a marker so DOM-based assertions can distinguish multiple
    // instances mounted into the same bar.
    const tag = (params.statusPanelParams?.tag as string) ?? '';
    this.gui.dataset.tag = tag;
  }
  getGui(): HTMLElement { return this.gui; }
  refresh(): void { this.refreshCount += 1; }
  destroy(): void { this.destroyCount += 1; }
}

/** Custom panel exposing a non-`IStatusPanelComp` method so a test can
 *  prove the `getStatusPanel<T>` generic lets apps narrow to the
 *  concrete subtype and call panel-specific methods (e.g. a snapshot
 *  getter) without `any` casts. */
class CustomPanelWithCustomMethod implements IStatusPanelComp {
  readonly gui: HTMLDivElement = document.createElement('div');
  private internalState = 'initial';
  init(_p: StatusPanelParams): void {
    this.gui.className = 'vg-custom-panel-with-method';
  }
  getGui(): HTMLElement { return this.gui; }
  refresh(): void { /* no-op for this test */ }
  destroy(): void { /* no-op for this test */ }
  /** Panel-specific method that getStatusPanel<T> should let callers
   *  invoke after narrowing the return to this concrete class. */
  getSnapshot(): string {
    return this.internalState;
  }
  setSnapshot(v: string): void {
    this.internalState = v;
  }
}

interface MakeGridResult {
  grid: VelocityGrid<{ id: string }>;
  container: HTMLElement;
}

function makeGrid(
  components?: Record<string, new () => IStatusPanelComp>,
  statusPanels?: Array<{ key: string; statusPanel: string; align?: 'left' | 'center' | 'right'; statusPanelParams?: Record<string, unknown> }>,
): MakeGridResult {
  const container = document.createElement('div');
  container.style.cssText = 'width:800px; height:600px;';
  container.className = 'vg-theme-quartz';
  document.body.appendChild(container);
  const grid = new VelocityGrid<{ id: string }>(container, {
    columnDefs: [{ field: 'id' }],
    getRowId: (r) => r.id,
    components: components as Record<string, new () => IStatusPanelComp>,
    statusBar: statusPanels ? { statusPanels } : undefined,
  });
  return { grid, container };
}

describe('Custom status panel API (Cycle 13 / Task 4)', () => {
  // 1. Registering a custom panel via `VelocityGridOptions.components` mounts it.
  it('registers a custom panel via VelocityGridOptions.components and mounts it into the bar', () => {
    const { grid, container } = makeGrid(
      { myCustomPanel: RecordingStatusPanel },
      [{ key: 'mine', statusPanel: 'myCustomPanel' }],
    );
    // The bar mounted and the custom panel's DOM node is in the right zone.
    const bar = container.querySelector('.vg-status-bar');
    expect(bar).not.toBeNull();
    const mounted = container.querySelector('.vg-recording-status-panel');
    expect(mounted).not.toBeNull();
    grid.destroy();
  });

  // 2. init() is called with params carrying the live api + the
  //    statusPanelParams the def passed.
  it('init() receives params.api + the def.statusPanelParams payload', () => {
    const { grid } = makeGrid(
      { myCustomPanel: RecordingStatusPanel },
      [{
        key: 'mine',
        statusPanel: 'myCustomPanel',
        statusPanelParams: { snapshotKey: 'k', threshold: 7 },
      }],
    );
    const api = (grid as unknown as { makeApi: () => { getStatusPanel: (k: string) => IStatusPanelComp | undefined } }).makeApi();
    const inst = api.getStatusPanel('mine') as RecordingStatusPanel | undefined;
    expect(inst).toBeDefined();
    expect(inst!.initCount).toBe(1);
    // The api forwarded into init.params.api must carry the public surface
    // — at minimum, the methods callable through VelocityGridApi. Asserting on a
    // sentinel method shape (rather than identity) keeps the test robust
    // against makeApi() returning a fresh object each call.
    expect(typeof (inst!.receivedParams?.api as { getStatusPanel?: unknown })?.getStatusPanel).toBe('function');
    expect(inst!.receivedParams?.statusPanelParams).toEqual({ snapshotKey: 'k', threshold: 7 });
    grid.destroy();
  });

  // 3. api.getStatusPanel(key) returns the live instance (and the
  //    generic narrowing lets callers invoke panel-specific methods).
  it('getStatusPanel<T>(key) returns the live instance + permits subtype narrowing', () => {
    const { grid } = makeGrid(
      { myMethodPanel: CustomPanelWithCustomMethod },
      [{ key: 'methody', statusPanel: 'myMethodPanel' }],
    );
    const api = (grid as unknown as { makeApi: () => { getStatusPanel: <T extends IStatusPanelComp>(k: string) => T | undefined } }).makeApi();
    const inst = api.getStatusPanel<CustomPanelWithCustomMethod>('methody');
    expect(inst).toBeDefined();
    expect(inst).toBeInstanceOf(CustomPanelWithCustomMethod);
    // Subtype narrowing is the whole point — this method does NOT exist on
    // `IStatusPanelComp`. Round-trip a state mutation to prove the live
    // instance is what the host has mounted (not a defensive copy).
    inst!.setSnapshot('after');
    expect(inst!.getSnapshot()).toBe('after');
    const sameInst = api.getStatusPanel<CustomPanelWithCustomMethod>('methody');
    expect(sameInst).toBe(inst);
    expect(sameInst!.getSnapshot()).toBe('after');
    grid.destroy();
  });

  // 4. The host's batched refresh() propagates to every custom instance.
  it('host.refresh() propagates to custom-panel.refresh()', () => {
    const { grid } = makeGrid(
      { myCustomPanel: RecordingStatusPanel },
      [{ key: 'mine', statusPanel: 'myCustomPanel' }],
    );
    const api = (grid as unknown as { makeApi: () => { getStatusPanel: (k: string) => IStatusPanelComp | undefined } }).makeApi();
    const inst = api.getStatusPanel('mine') as RecordingStatusPanel;
    expect(inst.refreshCount).toBe(0);
    // The host's refresh() is what Task 5's rAF-batched dispatcher will
    // ultimately call; for Task 4 we trigger it directly to assert the
    // fan-out path includes custom panels.
    const host = (grid as unknown as { statusBar: { refresh: () => void } }).statusBar;
    host.refresh();
    expect(inst.refreshCount).toBe(1);
    host.refresh();
    host.refresh();
    expect(inst.refreshCount).toBe(3);
    grid.destroy();
  });

  // 5. grid.destroy() runs destroy() on every mounted custom instance.
  it('grid.destroy() calls destroy() on every mounted custom panel', () => {
    const { grid } = makeGrid(
      { panelA: RecordingStatusPanel, panelB: RecordingStatusPanel },
      [
        { key: 'a', statusPanel: 'panelA' },
        { key: 'b', statusPanel: 'panelB' },
      ],
    );
    const api = (grid as unknown as { makeApi: () => { getStatusPanel: (k: string) => IStatusPanelComp | undefined } }).makeApi();
    const a = api.getStatusPanel('a') as RecordingStatusPanel;
    const b = api.getStatusPanel('b') as RecordingStatusPanel;
    expect(a.destroyCount).toBe(0);
    expect(b.destroyCount).toBe(0);
    grid.destroy();
    expect(a.destroyCount).toBe(1);
    expect(b.destroyCount).toBe(1);
  });

  // 6. Unknown keys (and absent status bar) return undefined — never null,
  //    never throw — so app code can `?.method()` off the result safely.
  it('getStatusPanel(key) returns undefined for unknown keys and when no status bar is configured', () => {
    // (a) Configured bar with one panel; unknown key → undefined.
    const withBar = makeGrid(
      { myCustomPanel: RecordingStatusPanel },
      [{ key: 'mine', statusPanel: 'myCustomPanel' }],
    );
    const apiWith = (withBar.grid as unknown as { makeApi: () => { getStatusPanel: (k: string) => IStatusPanelComp | undefined } }).makeApi();
    expect(apiWith.getStatusPanel('mine')).toBeDefined();
    expect(apiWith.getStatusPanel('does-not-exist')).toBeUndefined();
    withBar.grid.destroy();

    // (b) No status bar configured → every key returns undefined and
    //     the call does NOT throw.
    const noBarContainer = document.createElement('div');
    noBarContainer.style.cssText = 'width:800px; height:600px;';
    noBarContainer.className = 'vg-theme-quartz';
    document.body.appendChild(noBarContainer);
    const noBarGrid = new VelocityGrid<{ id: string }>(noBarContainer, {
      columnDefs: [{ field: 'id' }],
      getRowId: (r) => r.id,
    });
    const apiNo = (noBarGrid as unknown as { makeApi: () => { getStatusPanel: (k: string) => IStatusPanelComp | undefined } }).makeApi();
    expect(() => apiNo.getStatusPanel('mine')).not.toThrow();
    expect(apiNo.getStatusPanel('mine')).toBeUndefined();
    noBarGrid.destroy();
  });

  // 7. Multiple custom panels in one zone stack in declaration order.
  it('multiple custom panels in the same zone stack in declaration order', () => {
    const { grid, container } = makeGrid(
      { tagger: RecordingStatusPanel },
      [
        { key: 'first', statusPanel: 'tagger', align: 'left', statusPanelParams: { tag: 'first' } },
        { key: 'second', statusPanel: 'tagger', align: 'left', statusPanelParams: { tag: 'second' } },
        { key: 'third', statusPanel: 'tagger', align: 'left', statusPanelParams: { tag: 'third' } },
      ],
    );
    const leftZone = container.querySelector('.vg-status-bar-zone--left') as HTMLElement;
    expect(leftZone).not.toBeNull();
    const tags = Array.from(leftZone.children).map((c) => (c as HTMLElement).dataset.tag);
    expect(tags).toEqual(['first', 'second', 'third']);
    // Each panel is also reachable by key — the same insertion-order
    // contract the host's slot map promises.
    const api = (grid as unknown as { makeApi: () => { getStatusPanel: (k: string) => IStatusPanelComp | undefined } }).makeApi();
    expect(api.getStatusPanel('first')).toBeDefined();
    expect(api.getStatusPanel('second')).toBeDefined();
    expect(api.getStatusPanel('third')).toBeDefined();
    grid.destroy();
  });

  // 8. Custom + built-in keys coexist in the same bar — neither
  //    registration path clobbers the other.
  it('custom + built-in keys coexist in the same bar', () => {
    const { grid, container } = makeGrid(
      { myCustomPanel: RecordingStatusPanel },
      [
        { key: 'agTotalRowCountComponent', statusPanel: 'agTotalRowCountComponent', align: 'right' },
        { key: 'mine', statusPanel: 'myCustomPanel', align: 'left' },
      ],
    );
    const api = (grid as unknown as { makeApi: () => { getStatusPanel: (k: string) => IStatusPanelComp | undefined } }).makeApi();
    // Built-in resolves to the real count-panel ctor wired in Task 2; the
    // exact class identity isn't important here, only that the slot
    // resolved to a live instance.
    expect(api.getStatusPanel('agTotalRowCountComponent')).toBeDefined();
    // Custom resolves to RecordingStatusPanel via the shared
    // `components` channel.
    const mine = api.getStatusPanel('mine') as RecordingStatusPanel | undefined;
    expect(mine).toBeDefined();
    expect(mine!.initCount).toBe(1);
    // DOM placement: left zone hosts the custom panel, right zone hosts
    // the built-in count panel.
    const leftZone = container.querySelector('.vg-status-bar-zone--left') as HTMLElement;
    const rightZone = container.querySelector('.vg-status-bar-zone--right') as HTMLElement;
    expect(leftZone.children.length).toBe(1);
    expect(rightZone.children.length).toBe(1);
    expect(leftZone.querySelector('.vg-recording-status-panel')).not.toBeNull();
    grid.destroy();
  });
});
