/**
 * Cycle 13 / Task 1 — StatusBarHost unit tests.
 *
 * StatusBarHost owns the DOM strip that mounts on the bottom (or top)
 * edge of the grid, including three flex zones (left / center / right)
 * and the registry-driven panel mounting. The host is intentionally
 * framework-agnostic: it resolves status panels through a
 * `StatusPanelRegistry` passed in via the `StatusBarGridContext`, and
 * reports geometry changes back to the host grid via
 * `setReservedSpace(side, height)` so the canvas region can shrink /
 * grow in lock-step.
 *
 * Built-in panel keys (`agTotalRowCountComponent`, …) get real
 * implementations in Tasks 2 + 3; Task 1 ships inert stubs, so these
 * tests use custom `RecordingPanel` ctors registered against arbitrary
 * keys to assert lifecycle without depending on the Tasks 2 + 3 work.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StatusBarHost, normalizeStatusBarOption } from '../src/interaction/statusBar/host';
import { StatusPanelRegistry } from '../src/interaction/statusBar/registry';
import type { IStatusPanelComp, StatusPanelParams, StatusBarPosition } from '../src/interaction/statusBar/types';

class RecordingPanel implements IStatusPanelComp {
  initCount = 0;
  refreshCount = 0;
  destroyCount = 0;
  receivedParams: StatusPanelParams | null = null;
  readonly gui: HTMLDivElement = document.createElement('div');
  constructor() {
    this.gui.className = 'cg-status-panel-recording';
  }
  init(params: StatusPanelParams): void {
    this.initCount += 1;
    this.receivedParams = params;
  }
  getGui(): HTMLElement { return this.gui; }
  refresh(): void { this.refreshCount += 1; }
  destroy(): void { this.destroyCount += 1; }
}

class ThrowingRefreshPanel implements IStatusPanelComp {
  readonly gui: HTMLDivElement = document.createElement('div');
  init(_p: StatusPanelParams): void { this.gui.className = 'cg-status-panel-thrower'; }
  getGui(): HTMLElement { return this.gui; }
  refresh(): void { throw new Error('panel refresh blew up'); }
  destroy(): void {}
}

function makeContext() {
  const registry = new StatusPanelRegistry();
  registry.register('countPanel', RecordingPanel);
  registry.register('rangePanel', RecordingPanel);
  registry.register('aggPanel', RecordingPanel);
  registry.register('throwerPanel', ThrowingRefreshPanel);
  const reserveCalls: Array<{ side: StatusBarPosition; height: number }> = [];
  return {
    registry,
    api: { marker: 'cgrid-api' },
    reserveCalls,
    setReservedSpace(side: StatusBarPosition, height: number) {
      reserveCalls.push({ side, height });
    },
  };
}

describe('StatusBarHost', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    Object.assign(root.style, { width: '800px', height: '600px', position: 'relative' });
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.parentElement?.removeChild(root);
  });

  it('constructor mounts a .cg-status-bar with three zones and data-position default "bottom"', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, { statusPanels: [] });
    const bar = root.querySelector('.cg-status-bar') as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar!.dataset.position).toBe('bottom');
    const zones = bar!.querySelectorAll('.cg-status-bar-zone');
    expect(zones.length).toBe(3);
    const zoneOrder = Array.from(zones).map((z) => (z as HTMLElement).dataset.zone);
    expect(zoneOrder).toEqual(['left', 'center', 'right']);
    host.destroy();
  });

  it('empty bar mounts the shell chrome but no panel instances (renders the bar even with zero panels)', () => {
    const ctx = makeContext();
    ctx.reserveCalls.length = 0;
    const host = new StatusBarHost(root, ctx, { statusPanels: [] });
    const bar = root.querySelector('.cg-status-bar') as HTMLElement;
    // Every zone exists but holds no children — the empty-bar acceptance
    // criterion in the design notes ("the chrome alone must read as
    // intentional").
    const allZones = bar.querySelectorAll('.cg-status-bar-zone');
    expect(allZones.length).toBe(3);
    for (const zone of Array.from(allZones)) {
      expect(zone.children.length).toBe(0);
    }
    // Reservation still fires so the canvas shrinks for the empty strip.
    expect(ctx.reserveCalls.length).toBeGreaterThan(0);
    const last = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(last.side).toBe('bottom');
    // happy-dom returns getBoundingClientRect height 0, so the host
    // falls back to the BAR_HEIGHT constant (28). That's the contract
    // for jsdom-style envs.
    expect(last.height).toBe(28);
    host.destroy();
  });

  it('mounts N panels into the zone matching each def.align (default zone is right)', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, {
      statusPanels: [
        { key: 'agAggregationComponent', statusPanel: 'aggPanel', align: 'left' },
        { key: 'midSnap', statusPanel: 'countPanel', align: 'center' },
        { key: 'agTotalAndFilteredRowCountComponent', statusPanel: 'countPanel' },
        { key: 'agSelectedRowCountComponent', statusPanel: 'rangePanel' },
      ],
    });
    const bar = root.querySelector('.cg-status-bar') as HTMLElement;
    const leftZone = bar.querySelector('.cg-status-bar-zone--left') as HTMLElement;
    const centerZone = bar.querySelector('.cg-status-bar-zone--center') as HTMLElement;
    const rightZone = bar.querySelector('.cg-status-bar-zone--right') as HTMLElement;
    expect(leftZone.children.length).toBe(1);
    expect(centerZone.children.length).toBe(1);
    // Two panels with no explicit align both default to right and stack
    // in declaration order.
    expect(rightZone.children.length).toBe(2);
    host.destroy();
  });

  it('panels in the same zone stack in declaration order', () => {
    const ctx = makeContext();
    // Custom ctor that records its own key (passed via statusPanelParams)
    // into its DOM node, so the zone's child ordering can be asserted by
    // reading data-key off each mounted element.
    class TaggingPanel implements IStatusPanelComp {
      readonly gui: HTMLDivElement = document.createElement('div');
      init(params: StatusPanelParams): void {
        const tag = (params.statusPanelParams?.tag as string) ?? '';
        this.gui.dataset.tag = tag;
        this.gui.className = 'cg-status-panel-tagging';
      }
      getGui(): HTMLElement { return this.gui; }
      refresh(): void {}
      destroy(): void {}
    }
    ctx.registry.register('taggingPanel', TaggingPanel);
    const host = new StatusBarHost(root, ctx, {
      statusPanels: [
        { key: 'a', statusPanel: 'taggingPanel', align: 'left', statusPanelParams: { tag: 'a' } },
        { key: 'b', statusPanel: 'taggingPanel', align: 'left', statusPanelParams: { tag: 'b' } },
        { key: 'c', statusPanel: 'taggingPanel', align: 'left', statusPanelParams: { tag: 'c' } },
      ],
    });
    const leftZone = root.querySelector('.cg-status-bar-zone--left') as HTMLElement;
    const tags = Array.from(leftZone.children).map((c) => (c as HTMLElement).dataset.tag);
    expect(tags).toEqual(['a', 'b', 'c']);
    host.destroy();
  });

  it('panel init receives the context api + StatusPanelDef.statusPanelParams', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, {
      statusPanels: [{
        key: 'agAggregationComponent',
        statusPanel: 'aggPanel',
        statusPanelParams: { aggFuncs: ['sum', 'avg'] },
      }],
    });
    const inst = host.getInstance('agAggregationComponent') as RecordingPanel | null;
    expect(inst).not.toBeNull();
    expect(inst!.initCount).toBe(1);
    expect(inst!.receivedParams?.api).toBe(ctx.api);
    expect(inst!.receivedParams?.statusPanelParams).toEqual({ aggFuncs: ['sum', 'avg'] });
    host.destroy();
  });

  it('host.refresh() fans out a refresh() call to every live panel instance', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, {
      statusPanels: [
        { key: 'a', statusPanel: 'countPanel', align: 'left' },
        { key: 'b', statusPanel: 'rangePanel', align: 'right' },
      ],
    });
    const a = host.getInstance('a') as RecordingPanel;
    const b = host.getInstance('b') as RecordingPanel;
    expect(a.refreshCount).toBe(0);
    expect(b.refreshCount).toBe(0);
    host.refresh();
    expect(a.refreshCount).toBe(1);
    expect(b.refreshCount).toBe(1);
    host.destroy();
  });

  it('a panel that throws in refresh does not prevent siblings from refreshing', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, {
      statusPanels: [
        { key: 'good1', statusPanel: 'countPanel' },
        { key: 'bad', statusPanel: 'throwerPanel' },
        { key: 'good2', statusPanel: 'rangePanel' },
      ],
    });
    const good1 = host.getInstance('good1') as RecordingPanel;
    const good2 = host.getInstance('good2') as RecordingPanel;
    expect(() => host.refresh()).not.toThrow();
    expect(good1.refreshCount).toBe(1);
    expect(good2.refreshCount).toBe(1);
    host.destroy();
  });

  it('setVisible(false) hides the bar (display:none) and reserves zero height', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, { statusPanels: [] });
    host.setVisible(false);
    const bar = root.querySelector('.cg-status-bar') as HTMLElement;
    expect(bar.style.display).toBe('none');
    expect(host.isVisible()).toBe(false);
    const last = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(last.height).toBe(0);
    host.setVisible(true);
    expect(bar.style.display).not.toBe('none');
    expect(host.isVisible()).toBe(true);
    host.destroy();
  });

  it('hiddenByDefault starts the bar with display:none and zero reservation', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, {
      statusPanels: [{ key: 'a', statusPanel: 'countPanel' }],
      hiddenByDefault: true,
    });
    const bar = root.querySelector('.cg-status-bar') as HTMLElement;
    expect(bar.style.display).toBe('none');
    expect(host.isVisible()).toBe(false);
    // Panel instance still mounts (the bar's contents are intact); the
    // reservation is what drops to zero.
    expect(host.getInstance('a')).not.toBeNull();
    const last = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(last.height).toBe(0);
    host.destroy();
  });

  it('setPosition("top") flips data-position and re-reserves on the new edge', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, { statusPanels: [], position: 'bottom' });
    ctx.reserveCalls.length = 0;
    host.setPosition('top');
    const bar = root.querySelector('.cg-status-bar') as HTMLElement;
    expect(bar.dataset.position).toBe('top');
    // setPosition releases the old edge first, then reserves on the new.
    expect(ctx.reserveCalls.length).toBe(2);
    expect(ctx.reserveCalls[0]).toEqual({ side: 'bottom', height: 0 });
    expect(ctx.reserveCalls[1].side).toBe('top');
    expect(ctx.reserveCalls[1].height).toBe(28);
    host.destroy();
  });

  it('setStatusBarDef destroys the old instances and re-mounts the new def', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, {
      statusPanels: [
        { key: 'old1', statusPanel: 'countPanel' },
        { key: 'old2', statusPanel: 'rangePanel' },
      ],
    });
    const old1 = host.getInstance('old1') as RecordingPanel;
    const old2 = host.getInstance('old2') as RecordingPanel;
    expect(old1.destroyCount).toBe(0);
    expect(old2.destroyCount).toBe(0);
    host.setStatusBarDef({
      statusPanels: [
        { key: 'new1', statusPanel: 'aggPanel', align: 'center' },
      ],
    });
    // Old instances destroyed, lookup returns null.
    expect(old1.destroyCount).toBe(1);
    expect(old2.destroyCount).toBe(1);
    expect(host.getInstance('old1')).toBeNull();
    expect(host.getInstance('old2')).toBeNull();
    // New instance mounted into the center zone.
    expect(host.getInstance('new1')).not.toBeNull();
    const centerZone = root.querySelector('.cg-status-bar-zone--center') as HTMLElement;
    expect(centerZone.children.length).toBe(1);
    host.destroy();
  });

  it('opening an unknown panel key leaves the slot empty and does NOT throw', () => {
    const ctx = makeContext();
    expect(() => new StatusBarHost(root, ctx, {
      statusPanels: [{ key: 'mystery', statusPanel: 'no-such-component' }],
    })).not.toThrow();
    // Find the bar and the host instance via the constructor again.
    const host = new StatusBarHost(root, ctx, {
      statusPanels: [{ key: 'mystery2', statusPanel: 'no-such-other' }],
    });
    expect(host.getInstance('mystery2')).toBeNull();
    host.destroy();
  });

  it('destroy removes the .cg-status-bar element and destroys mounted instances', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, {
      statusPanels: [{ key: 'a', statusPanel: 'countPanel' }],
    });
    const inst = host.getInstance('a') as RecordingPanel;
    expect(inst.destroyCount).toBe(0);
    host.destroy();
    expect(root.querySelector('.cg-status-bar')).toBeNull();
    expect(inst.destroyCount).toBe(1);
    // Final reserveCalls entry is height 0 — the canvas regains the inset.
    const last = ctx.reserveCalls[ctx.reserveCalls.length - 1];
    expect(last.height).toBe(0);
  });

  it('getStatusBarDef returns the resolved (position-defaulted) def', () => {
    const ctx = makeContext();
    const host = new StatusBarHost(root, ctx, {
      statusPanels: [{ key: 'a', statusPanel: 'countPanel' }],
    });
    const def = host.getStatusBarDef();
    expect(def.statusPanels).toHaveLength(1);
    expect(def.position).toBe('bottom');
    host.destroy();
  });

  it('normalizeStatusBarOption maps boolean/undefined acceptance shapes to a canonical def or null', () => {
    expect(normalizeStatusBarOption(undefined)).toBeNull();
    expect(normalizeStatusBarOption(false)).toBeNull();
    const trueDef = normalizeStatusBarOption(true);
    expect(trueDef).not.toBeNull();
    expect(trueDef!.statusPanels).toEqual([]);
    const explicit = normalizeStatusBarOption({
      statusPanels: [{ key: 'k', statusPanel: 'countPanel' }],
      position: 'top',
    });
    expect(explicit).not.toBeNull();
    expect(explicit!.position).toBe('top');
    expect(explicit!.statusPanels[0]?.key).toBe('k');
  });
});
