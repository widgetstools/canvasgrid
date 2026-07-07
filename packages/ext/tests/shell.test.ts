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

  it('opens the settings sheet and renders the requested module panel', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountSettingsModule(settingsModule('grid-options'), ctx);
    expect(shell.isSettingsOpen()).toBe(false);
    shell.openSettings('grid-options');
    expect(shell.isSettingsOpen()).toBe(true);
    expect(root.querySelector('.cgext-sheet')!.textContent).toContain('panel:grid-options');
    shell.closeSettings();
    expect(shell.isSettingsOpen()).toBe(false);
  });
});
