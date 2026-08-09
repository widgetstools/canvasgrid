import { describe, it, expect, vi } from 'vitest';
import { ShellLayout, groupModulesForNav } from '../src/shell/shell';
import type {
  VelocityGridExtContext,
  SettingsModule,
  ToolbarItem,
  ModuleCategory,
} from '../src/extension/types';

const ctx = {} as VelocityGridExtContext;

function toolbarItem(id: string, slot: any): ToolbarItem {
  return {
    id, kind: 'toolbar-item', slot, init: vi.fn(),
    render: (host) => { host.textContent = id; return { destroy() {} }; },
  };
}
function settingsModule(
  id: string,
  category: ModuleCategory = 'layout',
  title = id,
): SettingsModule {
  return {
    id, kind: 'settings-module', title, icon: 'i', category,
    init: vi.fn(),
    mount: (host) => { host.textContent = `panel:${id}`; return { destroy() {} }; },
  };
}

describe('groupModulesForNav', () => {
  it('buckets modules into category order and drops empty groups', () => {
    const groups = groupModulesForNav([
      settingsModule('smart-edit', 'editing', 'Smart Edit'),
      settingsModule('grid-options', 'layout', 'Options'),
      settingsModule('alerts', 'format', 'Alerts'),
      settingsModule('column-settings', 'layout', 'Column Settings'),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['layout', 'format', 'editing']);
    expect(groups[0]!.modules.map((m) => m.id)).toEqual(['grid-options', 'column-settings']);
    expect(groups[0]!.label).toBe('Layout');
  });
});

describe('ShellLayout', () => {
  it('builds the strip regions and exposes a grid mount', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    expect(root.querySelector('.vgext-titlebar')).toBeTruthy();
    expect(root.querySelector('.vgext-ribbon')).toBeTruthy();
    expect(root.querySelector('.vgext-grid')).toBeTruthy();
    expect(shell.gridMount.classList.contains('vgext-grid')).toBe(true);
  });

  it('mounts a toolbar item into its slot', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountToolbarItem(toolbarItem('save', 'primary-right'), ctx);
    expect(root.querySelector('.vgext-titlebar')!.textContent).toContain('save');
  });

  it('opens the settings sheet and renders the requested module panel', async () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountSettingsModule(settingsModule('grid-options'), ctx);
    expect(shell.isSettingsOpen()).toBe(false);
    shell.openSettings('grid-options');
    expect(shell.isSettingsOpen()).toBe(true);
    expect(root.querySelector('.vgext-sheet')!.textContent).toContain('panel:grid-options');
    expect(root.querySelector('.vgext-sheet-nav')).toBeNull(); // single module → no nav
    expect(root.querySelector('.vgext-sheet-footer')).toBeTruthy();
    expect(root.querySelector('[data-testid="vgext-sheet-done"]')).toBeTruthy();
    // Entrance uses rAF — wait so close sees `is-open` and runs the exit path.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    shell.closeSettings();
    await new Promise((r) => setTimeout(r, 200));
    expect(shell.isSettingsOpen()).toBe(false);
  });

  it('shows category dropdowns and switches panels from a menu item', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountSettingsModule(settingsModule('grid-options', 'layout', 'Options'), ctx);
    shell.mountSettingsModule(settingsModule('column-settings', 'layout', 'Column Settings'), ctx);
    shell.mountSettingsModule(settingsModule('smart-edit', 'editing', 'Smart Edit'), ctx);
    shell.openSettings('grid-options');

    const nav = root.querySelector('[data-testid="vgext-sheet-nav"]')!;
    expect(nav).toBeTruthy();
    expect(root.querySelector('[data-testid="vgext-sheet-nav-group-layout"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="vgext-sheet-nav-group-editing"]')).toBeTruthy();
    expect(root.querySelector('.vgext-sheet-nav-scroll--prev')).toBeNull();
    expect(root.querySelector('.vgext-sheet-eyebrow')!.textContent).toBe('Customize · Layout');
    expect(root.querySelector('.vgext-sheet-body')!.textContent).toBe('panel:grid-options');

    // Open Editing menu and pick Smart Edit.
    root.querySelector<HTMLButtonElement>('[data-testid="vgext-sheet-nav-group-editing"]')!.click();
    const menu = root.querySelector('[data-testid="vgext-sheet-nav-menu-editing"]')!;
    expect(menu.hidden).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-testid="vgext-sheet-nav-item-smart-edit"]')!.click();
    expect(root.querySelector('.vgext-sheet-body')!.textContent).toBe('panel:smart-edit');
    expect(root.querySelector('.vgext-sheet-title')!.textContent).toBe('Smart Edit');
    expect(root.querySelector('.vgext-sheet-eyebrow')!.textContent).toBe('Customize · Editing');
  });

  it('destroys mounted toolbar-item instances on teardown', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    let destroyed = 0;
    const item: ToolbarItem = {
      id: 'refresh', kind: 'toolbar-item', slot: 'primary-left', init: vi.fn(),
      render: (host) => { host.textContent = 'refresh'; return { destroy() { destroyed += 1; } }; },
    };
    shell.mountToolbarItem(item, ctx);
    expect(destroyed).toBe(0);
    shell.destroy();
    expect(destroyed).toBe(1);
  });
});
