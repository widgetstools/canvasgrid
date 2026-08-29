import { describe, it, expect, vi, beforeAll } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { ShellLayout, groupModulesForNav, tabForModule } from '../src/shell/shell';
import { createExtContext } from '../src/extension/context';
import { ProfilesController } from '../src/profiles/controller';
import { LocalStorageProfileStore } from '../src/profiles/localStorageStore';
import type {
  VelocityGridExtContext,
  SettingsModule,
  ToolbarItem,
  ModuleCategory,
} from '../src/extension/types';

beforeAll(() => installGridTestEnv());

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

  it('shows underline category tabs and switches panels', () => {
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
    // The category tabs and the subnav ARE the trail. A breadcrumb and a
    // "CUSTOMIZE" eyebrow above them restated what they already showed, so
    // two facts were being reported by five elements. Both are gone; these
    // assertions lock that they stay gone.
    expect(root.querySelector('.vgext-sheet-eyebrow')).toBeNull();
    expect(root.querySelector('[data-testid="vgext-sheet-nav-crumb"]')).toBeNull();
    expect(root.querySelector('.vgext-sheet-title')!.textContent).toBe('Options');
    expect(root.querySelector('.vgext-sheet-body')!.textContent).toBe('panel:grid-options');

    // Sibling modules under Columns appear as a subnav when that tab is active.
    root.querySelector<HTMLButtonElement>('[data-testid="vgext-sheet-nav-tab-columns"]')!.click();
    expect(root.querySelector('.vgext-sheet-body')!.textContent).toBe('panel:column-settings');
    expect(root.querySelector('[data-testid="vgext-sheet-subnav"]')).toBeTruthy();
    // Where you are is still legible: the active category tab and the title.
    expect(root.querySelector<HTMLElement>('[data-testid="vgext-sheet-nav-tab-columns"]')!
      .getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('.vgext-sheet-title')!.textContent).toBe('Column Settings');
    root.querySelector<HTMLButtonElement>('[data-testid="vgext-sheet-nav-item-column-groups"]')!.click();
    expect(root.querySelector('.vgext-sheet-body')!.textContent).toBe('panel:column-groups');

    root.querySelector<HTMLButtonElement>('[data-testid="vgext-sheet-nav-tab-editing"]')!.click();
    expect(root.querySelector('.vgext-sheet-body')!.textContent).toBe('panel:smart-edit');
    expect(root.querySelector('.vgext-sheet-title')!.textContent).toBe('Smart Edit');
    expect(root.querySelector<HTMLElement>('[data-testid="vgext-sheet-nav-tab-editing"]')!
      .getAttribute('aria-selected')).toBe('true');
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

  it('moduleCtx.profiles delegates every ProfileController member, correctly bound through two wrapper layers (D-F3)', () => {
    // Real ProfilesController + createExtContext, not a hand-rolled fixture —
    // `ctx.profiles` from createExtContext is ALREADY a delegating wrapper,
    // so this exercises shell.ts's wrapper-of-a-wrapper for real: the
    // pre-fix `{ ...ctx.profiles }` spread dropped every prototype method
    // past markDirty/save/discard/isDirty, and a naive second
    // `Object.create` layer would silently shadow-write controller state
    // onto the wrapper instead of the shared instance (see context.test.ts).
    const host = document.createElement('div');
    document.body.appendChild(host);
    const grid = new VelocityGrid(host, {
      getRowId: (r: any) => r.a,
      columnDefs: [{ colId: 'a', field: 'a' }],
      rowData: [],
    } as any);
    const store = new LocalStorageProfileStore('shell-df3');
    const profiles = new ProfilesController(grid, store, { initialId: 'default' });
    const realCtx = createExtContext(grid, profiles);

    const root = document.createElement('div');
    const shell = new ShellLayout(root);
    let seenCtx: VelocityGridExtContext | null = null;
    const probe: SettingsModule = {
      id: 'probe', kind: 'settings-module', title: 'Probe', icon: 'i', category: 'layout',
      init: vi.fn(),
      mount: (host2, moduleCtx) => { seenCtx = moduleCtx; return { destroy() {} }; },
    };
    shell.mountSettingsModule(probe, realCtx);
    shell.openSettings('probe');

    expect(seenCtx).toBeTruthy();
    const seen = seenCtx as unknown as VelocityGridExtContext;
    for (const m of ['isDirty', 'activeId', 'saveAs', 'switchTo', 'rename', 'remove', 'list'] as const) {
      expect(typeof seen.profiles[m]).toBe('function');
    }

    // markDirty is overridden at the shell layer (stages the drawer
    // session) but must still reach the REAL controller through the
    // ctx.profiles layer beneath it.
    expect(profiles.isDirty()).toBe(false);
    seen.profiles.markDirty();
    expect(profiles.isDirty()).toBe(true);

    grid.destroy();
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
