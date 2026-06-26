/**
 * Cycle 11 / Task 1 — ToolPanelRegistry unit tests.
 *
 * The registry maps tool-panel `id` → `ToolPanelComponent` (constructor).
 * Apps register custom panels via `CGridOptions.components`. Two built-in
 * IDs (`'agColumnsToolPanel'` + `'agFiltersToolPanel'`) are seeded at
 * CGrid construction with stub implementations — Tasks 3 + 4 replace
 * those stubs with the real Columns / Filters panels.
 *
 * The registry itself is framework-agnostic: it knows nothing about the
 * side bar, CGrid, or the catalog. The side bar host (Task 2) consumes
 * `resolve(id)` to instantiate panels on demand.
 */
import { describe, it, expect } from 'vitest';
import { ToolPanelRegistry } from '../src/interaction/toolPanels/registry';
import type { ToolPanel, ToolPanelParams } from '../src/interaction/toolPanels/types';

class StubPanel implements ToolPanel {
  initCount = 0;
  refreshCount = 0;
  destroyCount = 0;
  receivedParams: ToolPanelParams | null = null;
  private gui = document.createElement('div');
  init(params: ToolPanelParams): void {
    this.initCount += 1;
    this.receivedParams = params;
    this.gui.className = 'cg-tool-panel-stub';
  }
  getGui(): HTMLElement {
    return this.gui;
  }
  refresh(): void {
    this.refreshCount += 1;
  }
  destroy(): void {
    this.destroyCount += 1;
  }
}

describe('ToolPanelRegistry', () => {
  it('register + resolve returns the registered ctor', () => {
    const reg = new ToolPanelRegistry();
    reg.register('foo', StubPanel);
    expect(reg.resolve('foo')).toBe(StubPanel);
  });

  it('resolve returns null for an unknown id', () => {
    const reg = new ToolPanelRegistry();
    expect(reg.resolve('does-not-exist')).toBeNull();
  });

  it('instantiate calls init(params) and returns the instance', () => {
    const reg = new ToolPanelRegistry();
    reg.register('foo', StubPanel);
    const api = { marker: 'api-handle' };
    const params: ToolPanelParams = { api, toolPanelParams: { hello: 'world' } };
    const inst = reg.instantiate('foo', params);
    expect(inst).toBeInstanceOf(StubPanel);
    expect((inst as StubPanel).initCount).toBe(1);
    expect((inst as StubPanel).receivedParams).toBe(params);
    // getGui returns a DOM element.
    const gui = inst!.getGui();
    expect(gui).toBeInstanceOf(HTMLElement);
    expect(gui.classList.contains('cg-tool-panel-stub')).toBe(true);
  });

  it('instantiate returns null when the id is unknown', () => {
    const reg = new ToolPanelRegistry();
    expect(reg.instantiate('unknown', { api: {} })).toBeNull();
  });

  it('pre-registers the built-in ids agColumnsToolPanel + agFiltersToolPanel', () => {
    // The Task 1 stubs ship empty getGui() roots — Tasks 3 + 4 replace
    // them with real Columns / Filters panel implementations. The
    // registry itself owns the seeding so a freshly-constructed
    // registry is usable without going through CGrid.
    const reg = new ToolPanelRegistry();
    reg.seedBuiltIns();
    expect(reg.resolve('agColumnsToolPanel')).not.toBeNull();
    expect(reg.resolve('agFiltersToolPanel')).not.toBeNull();
    const cols = reg.instantiate('agColumnsToolPanel', { api: {} });
    const flt = reg.instantiate('agFiltersToolPanel', { api: {} });
    expect(cols).not.toBeNull();
    expect(flt).not.toBeNull();
    expect(cols!.getGui()).toBeInstanceOf(HTMLElement);
    expect(flt!.getGui()).toBeInstanceOf(HTMLElement);
  });

  it('register overrides an existing id (apps replace built-ins)', () => {
    const reg = new ToolPanelRegistry();
    reg.seedBuiltIns();
    class CustomCols implements ToolPanel {
      private gui = document.createElement('section');
      init(): void { this.gui.dataset.custom = 'true'; }
      getGui(): HTMLElement { return this.gui; }
      refresh(): void {}
      destroy(): void {}
    }
    reg.register('agColumnsToolPanel', CustomCols);
    expect(reg.resolve('agColumnsToolPanel')).toBe(CustomCols);
    const inst = reg.instantiate('agColumnsToolPanel', { api: {} });
    expect(inst).toBeInstanceOf(CustomCols);
    expect(inst!.getGui().dataset.custom).toBe('true');
  });

  it('ids() returns the set of registered ids', () => {
    const reg = new ToolPanelRegistry();
    reg.seedBuiltIns();
    reg.register('my-panel', StubPanel);
    const ids = reg.ids().sort();
    expect(ids).toEqual(['agColumnsToolPanel', 'agFiltersToolPanel', 'my-panel']);
  });
});
