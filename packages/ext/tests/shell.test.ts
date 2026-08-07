import { describe, it, expect, vi } from 'vitest';
import { ShellLayout } from '../src/shell/shell';
import type { CgExtContext, SettingsModule, ToolbarItem } from '../src/extension/types';

const ctx = {} as CgExtContext;

function toolbarItem(id: string, slot: any): ToolbarItem {
  return {
    id, kind: 'toolbar-item', slot, init: vi.fn(),
    render: (host) => { host.textContent = id; return { destroy() {} }; },
  };
}
function settingsModule(id: string): SettingsModule {
  return {
    id, kind: 'settings-module', title: id, icon: 'i', category: 'layout',
    init: vi.fn(),
    mount: (host) => { host.textContent = `panel:${id}`; return { destroy() {} }; },
  };
}

describe('ShellLayout', () => {
  it('builds the strip regions and exposes a grid mount', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    expect(root.querySelector('.cgext-titlebar')).toBeTruthy();
    expect(root.querySelector('.cgext-ribbon')).toBeTruthy();
    expect(root.querySelector('.cgext-grid')).toBeTruthy();
    expect(shell.gridMount.classList.contains('cgext-grid')).toBe(true);
  });

  it('mounts a toolbar item into its slot', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountToolbarItem(toolbarItem('save', 'primary-right'), ctx);
    expect(root.querySelector('.cgext-titlebar')!.textContent).toContain('save');
  });

  it('opens the settings sheet and renders the requested module panel', async () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountSettingsModule(settingsModule('grid-options'), ctx);
    expect(shell.isSettingsOpen()).toBe(false);
    shell.openSettings('grid-options');
    expect(shell.isSettingsOpen()).toBe(true);
    expect(root.querySelector('.cgext-sheet')!.textContent).toContain('panel:grid-options');
    expect(root.querySelector('.cgext-sheet-nav')).toBeNull(); // single module → no tabs
    expect(root.querySelector('.cgext-sheet-footer')).toBeTruthy();
    expect(root.querySelector('[data-testid="cgext-sheet-done"]')).toBeTruthy();
    // Entrance uses rAF — wait so close sees `is-open` and runs the exit path.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    shell.closeSettings();
    await new Promise((r) => setTimeout(r, 200));
    expect(shell.isSettingsOpen()).toBe(false);
  });

  it('shows a module nav and switches panels when multiple modules are mounted', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountSettingsModule(settingsModule('grid-options'), ctx);
    shell.mountSettingsModule(settingsModule('column-settings'), ctx);
    shell.openSettings('grid-options');
    const wrap = root.querySelector('.cgext-sheet-nav-wrap')!;
    const nav = root.querySelector('.cgext-sheet-nav')!;
    expect(wrap).toBeTruthy();
    expect(nav).toBeTruthy();
    expect(root.querySelector('.cgext-sheet-nav-scroll--prev')).toBeTruthy();
    expect(root.querySelector('.cgext-sheet-nav-scroll--next')).toBeTruthy();
    expect(nav.textContent).toContain('grid-options');
    expect(nav.textContent).toContain('column-settings');
    expect(root.querySelector('.cgext-sheet-body')!.textContent).toBe('panel:grid-options');
    nav.querySelectorAll('.cgext-sheet-nav-item')[1]!.click();
    expect(root.querySelector('.cgext-sheet-body')!.textContent).toBe('panel:column-settings');
    expect(root.querySelector('.cgext-sheet-title')!.textContent).toBe('column-settings');
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
