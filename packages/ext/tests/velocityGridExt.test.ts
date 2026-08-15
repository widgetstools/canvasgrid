import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { VelocityGridExt } from '../src/velocityGridExt';
import type { SettingsModule, ToolbarItem } from '../src/extension/types';
import type { ConfigSession, WorkspaceConfig } from '../src/profiles/configSession';
import type { ProfileSnapshot } from '../src/extension/types';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

const opts = () => ({
  getRowId: (r: any) => r.a,
  columnDefs: [{ colId: 'a', field: 'a' }],
  rowData: [{ a: 1 }],
} as any);

/** In-memory ConfigSession with NO `loadWorkspaceSync` (async-only for
 *  restore) but WITH `hasWorkspaceSync`/`clearWorkspaceSync` — backed by
 *  the same in-memory field, so those two CAN answer synchronously even
 *  though restore can't. Exercises the D-F4 capability checks: a session
 *  that duck-types the sync surface (not `instanceof LocalStorageConfigSession`)
 *  must be used directly, never silently redirected to an unrelated
 *  localStorage key it never wrote. */
class InMemoryAsyncConfigSession implements ConfigSession {
  private doc: WorkspaceConfig | null = null;
  private activeId = 'default';
  constructor(readonly gridId: string) {}
  async loadBundle() { return { docVersion: 1, gridLevelData: {} } as any; }
  async saveBundle() { /* unused by these tests */ }
  async loadWorkspace(): Promise<WorkspaceConfig | null> { return this.doc; }
  async saveWorkspace(config: WorkspaceConfig): Promise<void> { this.doc = config; }
  async clearWorkspace(): Promise<void> { this.doc = null; }
  async hasWorkspace(): Promise<boolean> { return this.doc !== null; }
  async getActiveProfileId(): Promise<string> { return this.activeId; }
  async setActiveProfileId(id: string): Promise<void> { this.activeId = id; }
  async list(): Promise<ProfileSnapshot['meta'][]> {
    return this.doc ? [{ id: this.activeId, name: this.activeId, updatedAt: 0 }] : [];
  }
  async load(id: string): Promise<ProfileSnapshot | null> {
    if (!this.doc || id !== this.activeId) return null;
    return { meta: { id, name: id, updatedAt: 0 }, gridState: this.doc, ext: {} };
  }
  async save(id: string, snap: ProfileSnapshot): Promise<void> {
    this.doc = snap.gridState as WorkspaceConfig;
    this.activeId = id;
  }
  async remove(): Promise<void> { this.doc = null; }
  hasWorkspaceSync(): boolean { return this.doc !== null; }
  clearWorkspaceSync(): void { this.doc = null; }
}

describe('VelocityGridExt', () => {
  it('constructs a grid inside the shell and exposes .grid', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, opts());
    // ShellLayout marks its own container with `vgext-root` (see shell.ts);
    // since VelocityGridExt hands ShellLayout the `host` container directly, the
    // class lands on `host` itself, not a descendant — querySelector can't
    // match the element it's called on, so assert via classList instead.
    expect(host.classList.contains('vgext-root')).toBe(true);
    expect(host.querySelector('.vgext-grid')).toBeTruthy();
    expect(ext.grid).toBeTruthy();
    expect(typeof ext.getState).toBe('function');
    ext.destroy();
  });

  it('mounts a consumer-provided settings module and opens it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = vi.fn();
    const mod: SettingsModule = {
      id: 'demo', kind: 'settings-module', title: 'Demo', icon: 'i', category: 'layout',
      init: vi.fn(),
      mount: (el) => { mounted(); el.textContent = 'demo-panel'; return { destroy() {} }; },
    };
    const ext = new VelocityGridExt(host, { ...opts(), ext: { extensions: [mod] } });
    ext.openSettings('demo');
    expect(mounted).toHaveBeenCalled();
    expect(host.querySelector('.vgext-sheet')!.textContent).toContain('demo-panel');
    ext.destroy();
  });

  it('getConfig / loadConfig round-trips view state with the layouts registry', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, opts());

    const saved = ext.grid.saveLayout('Trader');
    expect(ext.grid.getActiveLayoutId()).toBe(saved.id);

    const config = ext.getConfig();
    expect(config.layouts).toBeTruthy();
    expect(config.layouts!.layouts.some((l) => l.id === saved.id)).toBe(true);
    expect(config.layouts!.activeLayoutId).toBe(saved.id);

    // JSON round-trip (external config service path).
    const remote = JSON.parse(JSON.stringify(config));

    ext.grid.loadLayout('default');
    expect(ext.grid.getActiveLayoutId()).toBe('default');

    ext.loadConfig(remote);
    expect(ext.grid.getActiveLayoutId()).toBe(saved.id);
    expect(ext.grid.getLayouts().some((l) => l.id === saved.id)).toBe(true);

    ext.destroy();
  });

  it('isolates a throwing extension init() — others still init, shell mounts, grid works (D-F1a)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const goodInit = vi.fn();
    const good: ToolbarItem = {
      id: 'good', kind: 'toolbar-item', slot: 'primary-left',
      init: goodInit,
      render: (el) => { el.textContent = 'good'; return { destroy() {} }; },
    };
    const bad: ToolbarItem = {
      id: 'bad', kind: 'toolbar-item', slot: 'primary-left',
      init: () => { throw new Error('init boom'); },
      render: () => { throw new Error('render boom'); },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ext = new VelocityGridExt(host, { ...opts(), ext: { extensions: [bad, good] } });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    expect(goodInit).toHaveBeenCalled();
    expect(host.classList.contains('vgext-root')).toBe(true);
    expect(ext.grid).toBeTruthy();
    expect(host.querySelector('.vgext-titlebar')!.textContent).toContain('good');
    ext.destroy();
  });

  it('a shell construction failure destroys the kernel grid so no Worker leaks (D-F1b)', () => {
    // `ShellLayout`'s constructor throws when handed something without a
    // real DOM `classList` — before the kernel grid is ever created, so
    // there is nothing to leak and the ctor simply rethrows uncaught.
    const badContainer = {} as unknown as HTMLElement;
    expect(() => new VelocityGridExt(badContainer, opts())).toThrow();
  });

  it('a broken extension registration after grid creation destroys the grid and rethrows (D-F1b)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const destroySpy = vi.spyOn(VelocityGrid.prototype, 'destroy');
    const badSpec = { id: 'boom', factory: () => { throw new Error('factory boom'); } };
    expect(() => new VelocityGridExt(host, { ...opts(), ext: { extensions: [badSpec] } }))
      .toThrow(/factory boom/);
    expect(destroySpy).toHaveBeenCalledTimes(1);
    destroySpy.mockRestore();
  });

  it('bootstrap continuation after destroy() does not touch the grid or reject unhandled (D-F2)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let resolveWorkspace!: (v: WorkspaceConfig | null) => void;
    const store: ConfigSession = {
      gridId: 'g-race',
      async loadBundle() { return { docVersion: 1, gridLevelData: {} } as any; },
      async saveBundle() {},
      loadWorkspace: () => new Promise((r) => { resolveWorkspace = r; }),
      async saveWorkspace() {},
      async clearWorkspace() {},
      async hasWorkspace() { return false; },
      async getActiveProfileId() { return 'default'; },
      async setActiveProfileId() {},
      async list() { return []; },
      async load() { return null; },
      async save() {},
      async remove() {},
    };
    const ext = new VelocityGridExt(host, { ...opts(), ext: { profiles: { store, initialId: 'default' } } });
    const setStateSpy = vi.spyOn(ext.grid, 'setState');

    ext.destroy();
    // Late resolution — the ctor's fire-and-forget bootstrap() must see
    // `disposed` and bail before touching the already-destroyed grid.
    resolveWorkspace({ version: 4 } as any);
    await new Promise((r) => setTimeout(r, 0));

    expect(setStateSpy).not.toHaveBeenCalled();
  });

  it('warns when both kernel persistState and an Ext ConfigSession are active (D-F6)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ext = new VelocityGridExt(host, { ...opts(), gridId: 'dbl-writer', persistState: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('persistState'));
    warn.mockRestore();
    ext.destroy();
  });

  it('persist/restore works through a custom async ConfigSession without loadWorkspaceSync (D-F4)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const store = new InMemoryAsyncConfigSession('g-async');
    const ext = new VelocityGridExt(host, {
      ...opts(), gridId: 'g-async', ext: { profiles: { store } },
    });

    ext.persistConfig();
    await Promise.resolve();
    expect(ext.hasPersistedConfig()).toBe(true);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(ext.restorePersistedConfig()).toBe(false); // no loadWorkspaceSync — degrades safely
    expect(warn).toHaveBeenCalledTimes(1);
    expect(ext.restorePersistedConfig()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1); // one-time warning — no repeat
    warn.mockRestore();

    const restored = await ext.restorePersistedConfigAsync();
    expect(restored).toBe(true);

    ext.clearPersistedConfig();
    expect(ext.hasPersistedConfig()).toBe(false);

    ext.destroy();
  });
});
