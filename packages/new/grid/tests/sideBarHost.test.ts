/**
 * Cycle 11 / Task 2 — SideBarHost unit tests.
 *
 * SideBarHost owns the DOM panel that mounts on the right (or left) edge
 * of the grid, including the vertical tab strip, the panel content host,
 * and the inner-edge resize handle. The host is intentionally framework-
 * agnostic: it resolves tool panels through a `ToolPanelRegistry` passed
 * in via the `SideBarGridContext`, and reports geometry changes back to
 * the host grid via `setReservedSpace(side, width)` so the canvas region
 * can shrink/grow in lock-step.
 *
 * String shortcuts in `SideBarDef.toolPanels` (`'columns'` /
 * `'filters'`) expand into the canonical `ToolPanelDef` shape with the
 * built-in IDs `'agColumnsToolPanel'` / `'agFiltersToolPanel'`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SideBarHost } from '../src/interaction/sideBar/host';
import { ToolPanelRegistry } from '../src/interaction/toolPanels/registry';
import type { ToolPanel, ToolPanelParams } from '../src/interaction/toolPanels/types';

class RecordingPanel implements ToolPanel {
  initCount = 0;
  refreshCount = 0;
  destroyCount = 0;
  receivedParams: ToolPanelParams | null = null;
  readonly gui = document.createElement('div');
  constructor() {
    this.gui.className = 'vg-tool-panel-recording';
  }
  init(params: ToolPanelParams): void {
    this.initCount += 1;
    this.receivedParams = params;
  }
  getGui(): HTMLElement { return this.gui; }
  refresh(): void { this.refreshCount += 1; }
  destroy(): void { this.destroyCount += 1; }
}

class ColumnsRecorder extends RecordingPanel {}
class FiltersRecorder extends RecordingPanel {}

function makeContext() {
  const registry = new ToolPanelRegistry();
  registry.register('agColumnsToolPanel', ColumnsRecorder);
  registry.register('agFiltersToolPanel', FiltersRecorder);
  const reserveCalls: Array<{ side: 'left' | 'right'; width: number }> = [];
  return {
    registry,
    api: { marker: 'cgrid-api' },
    reserveCalls,
    setReservedSpace(side: 'left' | 'right', width: number) {
      reserveCalls.push({ side, width });
    },
  };
}

describe('SideBarHost', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    // Give the root a measurable size so the resize-handle drag math has a
    // viewport to clamp against. Inline-block style avoids a wider parent
    // dragging the layout under happy-dom.
    Object.assign(root.style, { width: '800px', height: '600px', position: 'relative' });
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.parentElement?.removeChild(root);
  });

  it('constructor mounts a .vg-side-bar inside root with one tab per panel', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns', 'filters'], position: 'right' });
    const bar = root.querySelector('.vg-side-bar') as HTMLElement | null;
    expect(bar).not.toBeNull();
    const tabs = bar!.querySelectorAll('.vg-side-bar-tab');
    expect(tabs.length).toBe(2);
    // Labels mirror the built-in defaults.
    const labels = Array.from(tabs).map((t) => t.getAttribute('aria-label'));
    expect(labels).toEqual(['Columns', 'Filters']);
    // No panel is open yet — no aria-pressed=true.
    expect(bar!.querySelector('.vg-side-bar-tab[aria-pressed="true"]')).toBeNull();
    host.destroy();
  });

  it('position defaults to "right" and sets data-position on the root element', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
    const bar = root.querySelector('.vg-side-bar') as HTMLElement;
    expect(bar.dataset.position).toBe('right');
    host.destroy();
  });

  it('openPanel marks the matching tab aria-pressed and mounts panel GUI inside .vg-side-bar-panel', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns', 'filters'] });
    host.openPanel('agColumnsToolPanel');
    const bar = root.querySelector('.vg-side-bar') as HTMLElement;
    const pressed = bar.querySelectorAll('.vg-side-bar-tab[aria-pressed="true"]');
    expect(pressed.length).toBe(1);
    expect((pressed[0] as HTMLElement).getAttribute('aria-label')).toBe('Columns');
    // The panel's getGui() lives inside the panel host.
    const panelHost = bar.querySelector('.vg-side-bar-panel') as HTMLElement;
    expect(panelHost.querySelector('.vg-tool-panel-recording')).not.toBeNull();
    expect(host.getOpenedToolPanelId()).toBe('agColumnsToolPanel');
    host.destroy();
  });

  it('panel init receives the context api + ToolPanelDef.toolPanelParams', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, {
      toolPanels: [{
        id: 'agColumnsToolPanel',
        labelDefault: 'Columns',
        toolPanel: 'agColumnsToolPanel',
        toolPanelParams: { hidePivotMode: true },
      }],
    });
    host.openPanel('agColumnsToolPanel');
    const inst = host.getInstance('agColumnsToolPanel') as ColumnsRecorder | null;
    expect(inst).not.toBeNull();
    expect(inst!.initCount).toBe(1);
    expect(inst!.receivedParams?.api).toBe(ctx.api);
    expect(inst!.receivedParams?.toolPanelParams).toEqual({ hidePivotMode: true });
    host.destroy();
  });

  it('closePanel removes the mounted GUI, clears aria-pressed, and destroys the instance', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
    host.openPanel('agColumnsToolPanel');
    const inst = host.getInstance('agColumnsToolPanel') as ColumnsRecorder;
    expect(inst.destroyCount).toBe(0);
    host.closePanel();
    const bar = root.querySelector('.vg-side-bar') as HTMLElement;
    expect(bar.querySelector('.vg-tool-panel-recording')).toBeNull();
    expect(bar.querySelector('.vg-side-bar-tab[aria-pressed="true"]')).toBeNull();
    expect(inst.destroyCount).toBe(1);
    expect(host.getOpenedToolPanelId()).toBeNull();
    expect(host.getInstance('agColumnsToolPanel')).toBeNull();
    host.destroy();
  });

  it('clicking a tab opens the panel; clicking it again closes it (toggle)', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns', 'filters'] });
    const bar = root.querySelector('.vg-side-bar') as HTMLElement;
    const colsTab = bar.querySelectorAll('.vg-side-bar-tab')[0] as HTMLElement;
    colsTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.getOpenedToolPanelId()).toBe('agColumnsToolPanel');
    colsTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.getOpenedToolPanelId()).toBeNull();
    host.destroy();
  });

  it('switching tabs closes the old panel and opens the new one (only one open)', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns', 'filters'] });
    host.openPanel('agColumnsToolPanel');
    const firstCols = host.getInstance('agColumnsToolPanel') as ColumnsRecorder;
    host.openPanel('agFiltersToolPanel');
    expect(host.getOpenedToolPanelId()).toBe('agFiltersToolPanel');
    // The Columns instance was destroyed.
    expect(firstCols.destroyCount).toBe(1);
    expect(host.getInstance('agColumnsToolPanel')).toBeNull();
    host.destroy();
  });

  it('setPosition re-mounts on the opposite edge (data-position flips)', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns'], position: 'right' });
    const bar = root.querySelector('.vg-side-bar') as HTMLElement;
    expect(bar.dataset.position).toBe('right');
    host.setPosition('left');
    expect(bar.dataset.position).toBe('left');
    // reserveCalls record the side change.
    const lastReserved = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(lastReserved.side).toBe('left');
    host.destroy();
  });

  it('setVisible(false) hides the side bar (display:none) and reserves zero space', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
    host.setVisible(false);
    const bar = root.querySelector('.vg-side-bar') as HTMLElement;
    expect(bar.style.display).toBe('none');
    expect(host.isVisible()).toBe(false);
    const lastReserved = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(lastReserved.width).toBe(0);
    host.setVisible(true);
    expect(bar.style.display).not.toBe('none');
    expect(host.isVisible()).toBe(true);
    host.destroy();
  });

  it('hiddenByDefault starts the side bar with display:none and no panel open', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, {
      toolPanels: ['columns'],
      hiddenByDefault: true,
      defaultToolPanel: 'agColumnsToolPanel',
    });
    const bar = root.querySelector('.vg-side-bar') as HTMLElement;
    expect(bar.style.display).toBe('none');
    expect(host.isVisible()).toBe(false);
    // Even with defaultToolPanel, the panel is not mounted when hiddenByDefault.
    expect(host.getOpenedToolPanelId()).toBeNull();
    host.destroy();
  });

  it('defaultToolPanel opens that panel on mount', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, {
      toolPanels: ['columns', 'filters'],
      defaultToolPanel: 'agFiltersToolPanel',
    });
    expect(host.getOpenedToolPanelId()).toBe('agFiltersToolPanel');
    const inst = host.getInstance('agFiltersToolPanel') as FiltersRecorder | null;
    expect(inst).not.toBeNull();
    expect(inst!.initCount).toBe(1);
    host.destroy();
  });

  it('the resize handle is present and changes panel width on a mousedown/mousemove/mouseup drag', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, {
      toolPanels: [{
        id: 'agColumnsToolPanel',
        labelDefault: 'Columns',
        toolPanel: 'agColumnsToolPanel',
        width: 280,
        minWidth: 200,
        maxWidth: 600,
      }],
      defaultToolPanel: 'agColumnsToolPanel',
    });
    const bar = root.querySelector('.vg-side-bar') as HTMLElement;
    const handle = bar.querySelector('.vg-side-bar-resize') as HTMLElement;
    expect(handle).not.toBeNull();
    // Initial reserved width is panelWidth (280) + tab-strip width (28).
    expect(host.getReservedWidth()).toBeGreaterThanOrEqual(280);

    // Right-positioned side bar: dragging the handle LEFT widens the panel.
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 460, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 460, bubbles: true }));
    // Width should have grown by ~40px.
    expect(host.getPanelWidth()).toBeGreaterThan(280);
    host.destroy();
  });

  it('resize handle drag clamps to minWidth / maxWidth', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, {
      toolPanels: [{
        id: 'agColumnsToolPanel',
        labelDefault: 'Columns',
        toolPanel: 'agColumnsToolPanel',
        width: 250,
        minWidth: 200,
        maxWidth: 400,
      }],
      defaultToolPanel: 'agColumnsToolPanel',
    });
    const bar = root.querySelector('.vg-side-bar') as HTMLElement;
    const handle = bar.querySelector('.vg-side-bar-resize') as HTMLElement;
    // Drag a huge amount RIGHT (shrink, clamped at minWidth).
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 9999, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 9999, bubbles: true }));
    expect(host.getPanelWidth()).toBe(200);
    // Drag a huge amount LEFT (widen, clamped at maxWidth).
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: -9999, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: -9999, bubbles: true }));
    expect(host.getPanelWidth()).toBe(400);
    host.destroy();
  });

  it('setReservedSpace is called on open / close with the matching width', () => {
    const ctx = makeContext();
    ctx.reserveCalls.length = 0;
    const host = new SideBarHost(root, ctx, {
      toolPanels: [{
        id: 'agColumnsToolPanel',
        labelDefault: 'Columns',
        toolPanel: 'agColumnsToolPanel',
        width: 260,
      }],
    });
    // Mount-time reserve (no panel open): 36 px tabs + 1 px sidebar
    // border-left = 37 px. (Under happy-dom getBoundingClientRect returns
    // 0, so getReservedWidth uses its constant-summed fallback.)
    const initial = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(initial.width).toBe(37);
    host.openPanel('agColumnsToolPanel');
    // Open: + 3 px resize handle + panelWidth.
    const afterOpen = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(afterOpen.width).toBe(260 + 36 + 1 + 3);
    host.closePanel();
    const afterClose = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(afterClose.width).toBe(37);
    host.destroy();
  });

  it('destroy removes the .vg-side-bar element and destroys mounted instances', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
    host.openPanel('agColumnsToolPanel');
    const inst = host.getInstance('agColumnsToolPanel') as ColumnsRecorder;
    host.destroy();
    expect(root.querySelector('.vg-side-bar')).toBeNull();
    expect(inst.destroyCount).toBe(1);
  });

  it('hideButtons hides the tab strip (entire side bar collapses to zero width)', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, {
      toolPanels: ['columns', 'filters'],
      hideButtons: true,
    });
    const bar = root.querySelector('.vg-side-bar') as HTMLElement;
    const tabs = bar.querySelector('.vg-side-bar-tabs') as HTMLElement;
    expect(tabs.style.display).toBe('none');
    host.destroy();
  });

  it('opening an unknown panel id is a silent no-op (does not throw)', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns'] });
    expect(() => host.openPanel('not-registered')).not.toThrow();
    expect(host.getOpenedToolPanelId()).toBeNull();
    host.destroy();
  });

  it('exposes getSideBarDef returning the resolved (string-shortcuts-expanded) def', () => {
    const ctx = makeContext();
    const host = new SideBarHost(root, ctx, { toolPanels: ['columns', 'filters'] });
    const def = host.getSideBarDef();
    expect(def.toolPanels).toHaveLength(2);
    const first = def.toolPanels[0] as { id: string; labelDefault: string; toolPanel: string };
    expect(first.id).toBe('agColumnsToolPanel');
    expect(first.labelDefault).toBe('Columns');
    expect(first.toolPanel).toBe('agColumnsToolPanel');
    host.destroy();
  });
});
