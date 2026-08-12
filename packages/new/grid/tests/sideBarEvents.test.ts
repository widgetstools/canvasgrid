/**
 * Cycle 11 / Task 7 — Side bar events.
 *
 * Two new events on the grid emitter:
 *
 *   - `toolPanelVisibleChanged` fires when a tool panel opens or closes.
 *     Payload: `{ key: string | null, visible: boolean,
 *                 source: 'api' | 'sideBarButtonClicked' | 'sideBarInitializing' }`.
 *
 *   - `sideBarVisibleChanged` fires when the WHOLE side bar shows or hides.
 *     Payload: `{ visible: boolean,
 *                 source: 'api' | 'sideBarButtonClicked' }`.
 *
 * Source tagging:
 *   - `'sideBarInitializing'` — emitted exactly once at mount when
 *     `SideBarDef.defaultToolPanel` causes the host to auto-open a panel.
 *   - `'api'` — emitted from any of the seven Task 6 VelocityGridApi setters
 *     (`setSideBarVisible`, `openToolPanel`, `closeToolPanel`, …) and from
 *     direct programmatic calls to the host's public methods that don't
 *     specify another source.
 *   - `'sideBarButtonClicked'` — emitted from the in-tab `click` handler
 *     that the SideBarHost binds when building the tab strip.
 *
 * The host fires events through an optional `emit` callback on its
 * `SideBarGridContext`. VelocityGrid wires the callback into its typed event
 * emitter so apps can `grid.on('toolPanelVisibleChanged', ...)` like any
 * other event. These tests pin the emit callback directly on a custom
 * context so we can assert payloads without standing up a full VelocityGrid.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SideBarHost, type SideBarGridContext } from '../src/interaction/sideBar/host';
import { ToolPanelRegistry } from '../src/interaction/toolPanels/registry';
import type { ToolPanel, ToolPanelParams } from '../src/interaction/toolPanels/types';

class StubPanel implements ToolPanel {
  readonly gui = document.createElement('div');
  constructor() { this.gui.className = 'vg-tool-panel-stub'; }
  init(_params: ToolPanelParams): void {}
  getGui(): HTMLElement { return this.gui; }
  refresh(): void {}
  destroy(): void {}
}

class ColumnsStub extends StubPanel {}
class FiltersStub extends StubPanel {}

interface RecordedEvent {
  type: 'toolPanelVisibleChanged' | 'sideBarVisibleChanged';
  key?: string | null;
  visible: boolean;
  source: string;
}

function makeContext(): SideBarGridContext & { events: RecordedEvent[] } {
  const registry = new ToolPanelRegistry();
  registry.register('agColumnsToolPanel', ColumnsStub);
  registry.register('agFiltersToolPanel', FiltersStub);
  const events: RecordedEvent[] = [];
  return {
    registry,
    api: { marker: 'cgrid-api' },
    events,
    setReservedSpace() {},
    emit(event) {
      events.push(event as RecordedEvent);
    },
  };
}

describe('SideBarHost events (Cycle 11 / Task 7)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    Object.assign(root.style, { width: '800px', height: '600px', position: 'relative' });
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.parentElement?.removeChild(root);
  });

  describe('toolPanelVisibleChanged', () => {
    it('fires with source="sideBarInitializing" when defaultToolPanel auto-opens a panel at mount', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, {
        toolPanels: ['columns', 'filters'],
        defaultToolPanel: 'agColumnsToolPanel',
      });
      // The mount-time auto-open MUST emit exactly one
      // toolPanelVisibleChanged with the init source — apps that listen
      // for it can wire panel-mount analytics or restore-on-load logic.
      const panelEvents = ctx.events.filter((e) => e.type === 'toolPanelVisibleChanged');
      expect(panelEvents).toHaveLength(1);
      expect(panelEvents[0]).toMatchObject({
        type: 'toolPanelVisibleChanged',
        key: 'agColumnsToolPanel',
        visible: true,
        source: 'sideBarInitializing',
      });
      host.destroy();
    });

    it('does NOT fire at mount when no defaultToolPanel is set', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns', 'filters'] });
      const panelEvents = ctx.events.filter((e) => e.type === 'toolPanelVisibleChanged');
      expect(panelEvents).toHaveLength(0);
      host.destroy();
    });

    it('does NOT fire at mount when hiddenByDefault: true (the panel never actually opens)', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, {
        toolPanels: ['columns'],
        defaultToolPanel: 'agColumnsToolPanel',
        hiddenByDefault: true,
      });
      const panelEvents = ctx.events.filter((e) => e.type === 'toolPanelVisibleChanged');
      expect(panelEvents).toHaveLength(0);
      host.destroy();
    });

    it('fires with source="api" when openPanel(id) is called programmatically (no explicit source)', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns', 'filters'] });
      ctx.events.length = 0;
      host.openPanel('agFiltersToolPanel');
      const panelEvents = ctx.events.filter((e) => e.type === 'toolPanelVisibleChanged');
      expect(panelEvents).toHaveLength(1);
      expect(panelEvents[0]).toMatchObject({
        key: 'agFiltersToolPanel',
        visible: true,
        source: 'api',
      });
      host.destroy();
    });

    it('fires with source="api" + visible=false when closePanel() is called programmatically', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
      host.openPanel('agColumnsToolPanel');
      ctx.events.length = 0;
      host.closePanel();
      const panelEvents = ctx.events.filter((e) => e.type === 'toolPanelVisibleChanged');
      expect(panelEvents).toHaveLength(1);
      expect(panelEvents[0]).toMatchObject({
        key: 'agColumnsToolPanel',
        visible: false,
        source: 'api',
      });
      host.destroy();
    });

    it('fires with source="sideBarButtonClicked" when the tab is clicked', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
      ctx.events.length = 0;
      const tab = root.querySelector('.vg-side-bar-tab') as HTMLButtonElement;
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const opened = ctx.events.filter((e) => e.type === 'toolPanelVisibleChanged');
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatchObject({
        key: 'agColumnsToolPanel',
        visible: true,
        source: 'sideBarButtonClicked',
      });
      // Click again — toggle closes.
      ctx.events.length = 0;
      tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const closed = ctx.events.filter((e) => e.type === 'toolPanelVisibleChanged');
      expect(closed).toHaveLength(1);
      expect(closed[0]).toMatchObject({
        key: 'agColumnsToolPanel',
        visible: false,
        source: 'sideBarButtonClicked',
      });
      host.destroy();
    });

    it('switching panels via tab click emits TWO events (close old, open new) both with source="sideBarButtonClicked"', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns', 'filters'] });
      host.openPanel('agColumnsToolPanel'); // mount-time open under 'api'
      ctx.events.length = 0;
      // Click the Filters tab.
      const filtersTab = root.querySelectorAll('.vg-side-bar-tab')[1] as HTMLButtonElement;
      filtersTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const panelEvents = ctx.events.filter((e) => e.type === 'toolPanelVisibleChanged');
      expect(panelEvents).toHaveLength(2);
      expect(panelEvents[0]).toMatchObject({
        key: 'agColumnsToolPanel',
        visible: false,
        source: 'sideBarButtonClicked',
      });
      expect(panelEvents[1]).toMatchObject({
        key: 'agFiltersToolPanel',
        visible: true,
        source: 'sideBarButtonClicked',
      });
      host.destroy();
    });

    it('switching panels via openPanel(id) API also emits TWO events, both with source="api"', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns', 'filters'] });
      host.openPanel('agColumnsToolPanel');
      ctx.events.length = 0;
      host.openPanel('agFiltersToolPanel');
      const panelEvents = ctx.events.filter((e) => e.type === 'toolPanelVisibleChanged');
      expect(panelEvents).toHaveLength(2);
      expect(panelEvents[0]).toMatchObject({
        key: 'agColumnsToolPanel',
        visible: false,
        source: 'api',
      });
      expect(panelEvents[1]).toMatchObject({
        key: 'agFiltersToolPanel',
        visible: true,
        source: 'api',
      });
      host.destroy();
    });

    it('opening the SAME panel that is already open is a no-op (no event fires)', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
      host.openPanel('agColumnsToolPanel');
      ctx.events.length = 0;
      host.openPanel('agColumnsToolPanel');
      expect(ctx.events).toHaveLength(0);
      host.destroy();
    });

    it('closing when nothing is open is a no-op (no event fires)', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
      ctx.events.length = 0;
      host.closePanel();
      expect(ctx.events).toHaveLength(0);
      host.destroy();
    });

    it('opening an unknown id is a no-op (no event fires)', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
      ctx.events.length = 0;
      host.openPanel('not-registered');
      expect(ctx.events).toHaveLength(0);
      host.destroy();
    });
  });

  describe('sideBarVisibleChanged', () => {
    it('fires with source="api" when setVisible(false) hides the bar', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
      ctx.events.length = 0;
      host.setVisible(false);
      const barEvents = ctx.events.filter((e) => e.type === 'sideBarVisibleChanged');
      expect(barEvents).toHaveLength(1);
      expect(barEvents[0]).toMatchObject({
        visible: false,
        source: 'api',
      });
      host.destroy();
    });

    it('fires with source="api" when setVisible(true) shows the bar', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, {
        toolPanels: ['columns'],
        hiddenByDefault: true,
      });
      ctx.events.length = 0;
      host.setVisible(true);
      const barEvents = ctx.events.filter((e) => e.type === 'sideBarVisibleChanged');
      expect(barEvents).toHaveLength(1);
      expect(barEvents[0]).toMatchObject({
        visible: true,
        source: 'api',
      });
      host.destroy();
    });

    it('setVisible to the SAME state is a no-op (no event fires)', () => {
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
      ctx.events.length = 0;
      // Already visible — no event.
      host.setVisible(true);
      expect(ctx.events.filter((e) => e.type === 'sideBarVisibleChanged')).toHaveLength(0);
      host.setVisible(false);
      ctx.events.length = 0;
      host.setVisible(false);
      expect(ctx.events.filter((e) => e.type === 'sideBarVisibleChanged')).toHaveLength(0);
      host.destroy();
    });

    it('hiding the bar while a panel is open does NOT fire toolPanelVisibleChanged (only sideBarVisibleChanged)', () => {
      // Hiding the bar leaves the open panel intact in host state;
      // setVisible(true) later restores the same panel without a re-open
      // event. Therefore hiding/showing the bar must not fan out into
      // panel-visibility events — only the bar event fires.
      const ctx = makeContext();
      const host = new SideBarHost(root, ctx, {
        toolPanels: ['columns'],
        defaultToolPanel: 'agColumnsToolPanel',
      });
      ctx.events.length = 0;
      host.setVisible(false);
      const events = ctx.events;
      expect(events.filter((e) => e.type === 'sideBarVisibleChanged')).toHaveLength(1);
      expect(events.filter((e) => e.type === 'toolPanelVisibleChanged')).toHaveLength(0);
      host.destroy();
    });
  });

  describe('emit is optional', () => {
    it('a context with no emit callback works without throwing', () => {
      const registry = new ToolPanelRegistry();
      registry.register('agColumnsToolPanel', ColumnsStub);
      registry.register('agFiltersToolPanel', FiltersStub);
      const host = new SideBarHost(root, {
        registry,
        api: {},
        setReservedSpace() {},
      }, {
        toolPanels: ['columns'],
        defaultToolPanel: 'agColumnsToolPanel',
      });
      expect(() => {
        host.openPanel('agColumnsToolPanel');
        host.closePanel();
        host.setVisible(false);
        host.setVisible(true);
      }).not.toThrow();
      host.destroy();
    });
  });
});
