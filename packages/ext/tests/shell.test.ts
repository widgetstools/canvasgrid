import { describe, it, expect, vi } from 'vitest';
import { ShellLayout, groupModulesForNav, tabForModule } from '../src/shell/shell';
import type {
  VelocityGridExtContext,
  SettingsModule,
  ToolbarItem,
  ModuleCategory,
} from '../src/extension/types';

const ctx = {
  session: {
    stage() {},
    unstage() {},
    isDirty: () => false,
    pendingCount: () => 0,
    clear() {},
    onChange: () => () => {},
  },
  profiles: {
    isDirty: () => false,
    onDirtyChange: () => () => {},
    markDirty() {},
    save: async () => {},
    discard: async () => {},
  },
} as unknown as VelocityGridExtContext;

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

describe('groupModulesForNav / tabForModule', () => {
  it('maps modules into Options/Columns/Styling/Editing/Data tabs', () => {
    const groups = groupModulesForNav([
      settingsModule('smart-edit', 'editing', 'Smart Edit'),
      settingsModule('grid-options', 'layout', 'Options'),
      settingsModule('alerts', 'format', 'Alerts'),
      settingsModule('column-settings', 'layout', 'Column Settings'),
      settingsModule('calculated-columns', 'data', 'Calculated Columns'),
      settingsModule('data-provider', 'data', 'Data Provider'),
    ]);
    expect(groups.map((g) => g.id)).toEqual([
      'options',
      'columns',
      'styling',
      'editing',
      'data',
    ]);
    expect(groups[0]!.modules.map((m) => m.id)).toEqual(['grid-options']);
    expect(groups[1]!.modules.map((m) => m.id)).toEqual([
      'column-settings',
      'calculated-columns',
    ]);
    expect(groups[1]!.label).toBe('Columns');
    expect(tabForModule(settingsModule('column-groups', 'layout'))).toBe('columns');
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
    expect(root.querySelector('.vgext-sheet-footer-hint')!.textContent).toBe('All changes saved');
    expect(root.querySelector('[data-testid="vgext-sheet-done"]')).toBeTruthy();
    // Entrance uses rAF — wait so close sees `is-open` and runs the exit path.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    shell.closeSettings();
    await new Promise((r) => setTimeout(r, 200));
    expect(shell.isSettingsOpen()).toBe(false);
  });

  it('shows underline category tabs, breadcrumb, and switches panels', () => {
    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountSettingsModule(settingsModule('grid-options', 'layout', 'Options'), ctx);
    shell.mountSettingsModule(settingsModule('column-settings', 'layout', 'Column Settings'), ctx);
    shell.mountSettingsModule(settingsModule('column-groups', 'layout', 'Column Groups'), ctx);
    shell.mountSettingsModule(settingsModule('smart-edit', 'editing', 'Smart Edit'), ctx);
    shell.openSettings('grid-options');

    const nav = root.querySelector('[data-testid="vgext-sheet-nav"]')!;
    expect(nav).toBeTruthy();
    expect(root.querySelector('[data-testid="vgext-sheet-nav-tab-options"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="vgext-sheet-nav-tab-columns"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="vgext-sheet-nav-tab-editing"]')).toBeTruthy();
    expect(root.querySelector('.vgext-sheet-eyebrow')!.textContent).toBe('Customize');
    expect(root.querySelector('[data-testid="vgext-sheet-nav-crumb"]')!.textContent)
      .toContain('Options');
    expect(root.querySelector('.vgext-sheet-body')!.textContent).toBe('panel:grid-options');

    // Sibling modules under Columns appear as a subnav when that tab is active.
    root.querySelector<HTMLButtonElement>('[data-testid="vgext-sheet-nav-tab-columns"]')!.click();
    expect(root.querySelector('.vgext-sheet-body')!.textContent).toBe('panel:column-settings');
    expect(root.querySelector('[data-testid="vgext-sheet-subnav"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="vgext-sheet-nav-crumb"]')!.textContent)
      .toMatch(/Columns/);
    root.querySelector<HTMLButtonElement>('[data-testid="vgext-sheet-nav-item-column-groups"]')!.click();
    expect(root.querySelector('.vgext-sheet-body')!.textContent).toBe('panel:column-groups');

    root.querySelector<HTMLButtonElement>('[data-testid="vgext-sheet-nav-tab-editing"]')!.click();
    expect(root.querySelector('.vgext-sheet-body')!.textContent).toBe('panel:smart-edit');
    expect(root.querySelector('.vgext-sheet-title')!.textContent).toBe('Smart Edit');
    expect(root.querySelector('[data-testid="vgext-sheet-nav-crumb"]')!.textContent)
      .toMatch(/Editing/);
  });

  it('unsubscribes drawer footer listeners when remounting and closing', async () => {
    let sessionSubs = 0;
    let dirtySubs = 0;
    const leakCtx = {
      session: {
        stage() {},
        unstage() {},
        isDirty: () => false,
        pendingCount: () => 0,
        clear() {},
        onChange() {
          sessionSubs += 1;
          return () => { sessionSubs -= 1; };
        },
      },
      profiles: {
        isDirty: () => false,
        onDirtyChange() {
          dirtySubs += 1;
          return () => { dirtySubs -= 1; };
        },
        markDirty() {},
        save: async () => {},
        discard: async () => {},
      },
    } as unknown as VelocityGridExtContext;

    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    shell.mountSettingsModule(settingsModule('grid-options', 'layout', 'Options'), leakCtx);
    shell.mountSettingsModule(settingsModule('smart-edit', 'editing', 'Smart Edit'), leakCtx);
    shell.openSettings('grid-options');
    expect(sessionSubs).toBe(1);
    expect(dirtySubs).toBe(1);

    root.querySelector<HTMLButtonElement>('[data-testid="vgext-sheet-nav-tab-editing"]')!.click();
    expect(sessionSubs).toBe(1);
    expect(dirtySubs).toBe(1);

    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    shell.closeSettings();
    await new Promise((r) => setTimeout(r, 200));
    expect(sessionSubs).toBe(0);
    expect(dirtySubs).toBe(0);
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
