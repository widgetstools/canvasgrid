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

/** ConfigSession with NO sync surface at all — not `loadWorkspaceSync`, not
 *  `hasWorkspaceSync`, not `clearWorkspaceSync`. Exercises the MINOR 8
 *  (fix wave 2) warn-once path for `hasPersistedConfig()` /
 *  `clearPersistedConfig()`, which previously no-op'd silently instead of
 *  mirroring `restorePersistedConfig()`'s warn-once pattern. */
class FullyAsyncConfigSession implements ConfigSession {
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
  async list(): Promise<ProfileSnapshot['meta'][]> { return []; }
  async load(): Promise<ProfileSnapshot | null> { return null; }
  async save(id: string, snap: ProfileSnapshot): Promise<void> {
    this.doc = snap.gridState as WorkspaceConfig;
    this.activeId = id;
  }
  async remove(): Promise<void> { this.doc = null; }
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

  it('mirrors a string theme class onto the container and removes it on destroy (D-F9)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, { ...opts(), theme: 'vg-theme-cursor-dark' });
    expect(host.classList.contains('vg-theme-cursor-dark')).toBe(true);
    ext.destroy();
    expect(host.classList.contains('vg-theme-cursor-dark')).toBe(false);
  });

  it('does not strip a theme class the host already applied to the container (MINOR 9)', () => {
    const host = document.createElement('div');
    // Host pre-applies its own theme class BEFORE handing the container to
    // VelocityGridExt — a real scenario when the host wires theming itself
    // and also passes the same class via `theme:`.
    host.classList.add('vg-theme-cursor-dark');
    document.body.appendChild(host);
    const ext = new VelocityGridExt(host, { ...opts(), theme: 'vg-theme-cursor-dark' });
    expect(host.classList.contains('vg-theme-cursor-dark')).toBe(true);
    ext.destroy();
    // Ext didn't add this class, so destroy() must not remove it either.
    expect(host.classList.contains('vg-theme-cursor-dark')).toBe(true);
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

  it('a non-DOM container throws during shell construction, before any grid exists', () => {
    // `ShellLayout`'s constructor throws when handed something without a
    // real DOM `classList` — before the kernel grid is ever created, so
    // there is nothing to leak and the ctor simply rethrows uncaught. The
    // D-F1b "no Worker leaks" guarantee itself is covered by the next test
    // below (a factory throwing AFTER the grid exists, asserting
    // `destroySpy` fired) — this one only proves construction doesn't
    // silently swallow a malformed container.
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

  it('a store whose write-path rejects (D-F12 forward-compat refusal) does not produce an unhandled rejection, and the view state still applies (final review)', async () => {
    // Reproduces the scenario a real LocalStorageConfigSession hits when
    // the stored doc was written by a newer build: `loadWorkspace` returns
    // real content (a future doc still normalizes to a readable doc), but
    // the bookkeeping write `setActiveProfileId` — reached from
    // `runBootstrap`'s `syncActivePointer()` — rejects. Before the final
    // review fix, `ctor → void this.profiles.bootstrap()` had no `.catch`,
    // so this was a genuine unhandled rejection on ordinary startup
    // whenever a future-versioned doc was on disk — not a rare event.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const restoredState = { version: 4, columnState: [{ colId: 'a', width: 123 }] } as WorkspaceConfig;
    const store: ConfigSession = {
      gridId: 'g-future-doc',
      async loadBundle() { return { docVersion: 1, gridLevelData: {} } as any; },
      async saveBundle() {},
      async loadWorkspace() { return restoredState; },
      async saveWorkspace() { throw new Error('save refused: stored config is a newer docVersion'); },
      async clearWorkspace() {},
      async hasWorkspace() { return true; },
      async getActiveProfileId() { return 'default'; },
      async setActiveProfileId() { throw new Error('save refused: stored config is a newer docVersion'); },
      async list() { return []; },
      async load() { return null; },
      async save() {},
      async remove() {},
    };

    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);

    const ext = new VelocityGridExt(host, { ...opts(), ext: { profiles: { store, initialId: 'default' } } });
    const setStateSpy = vi.spyOn(ext.grid, 'setState');

    // `profiles`/`ctx` are private on VelocityGridExt — internals access
    // matching this test suite's established pattern elsewhere.
    interface Internals {
      profiles: { onListChange: (fn: () => void) => () => void; isDirty: () => boolean };
    }
    const internals = ext as unknown as Internals;
    let notified = 0;
    internals.profiles.onListChange(() => { notified++; });

    // Drain every microtask/macrotask the ctor's fire-and-forget bootstrap
    // chain touches (loadWorkspace → applyWorkspace/setState →
    // syncActivePointer's rejected write → catch-and-log → setDirty/notify).
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);

    // The REAL view state still applied — a refused bookkeeping write must
    // not roll back or skip the data that already landed successfully.
    expect(setStateSpy).toHaveBeenCalled();
    // …and the list/dirty sync that used to be skipped by the propagated
    // throw now still runs.
    expect(notified).toBeGreaterThan(0);
    expect(internals.profiles.isDirty()).toBe(false);

    ext.destroy();
  });

  it('a store with NO existing workspace whose seed save rejects reaches the OUTER ctor catch, not just syncActivePointer (final review round 2)', async () => {
    // Companion to the previous test — that scenario never actually
    // exercises `velocityGridExt.ts`'s own `bootstrap().catch(...)`,
    // because `syncActivePointer()`'s own try/catch absorbs the rejection
    // before it can propagate. This scenario is the one that genuinely
    // needs the outer catch: `loadWorkspace()` returning null (e.g. a real
    // LocalStorageConfigSession reading a future-version doc whose shape
    // this build recognizes NO root workspace keys in — normalizes to
    // `hasWorkspaceContent() === false`) takes `runBootstrap`'s SEED
    // branch (`await this.save()`), whose `saveWorkspace` call rejects and
    // propagates all the way out of `bootstrap()` uncaught by
    // `syncActivePointer` (never reached on this branch).
    const host = document.createElement('div');
    document.body.appendChild(host);
    const store: ConfigSession = {
      gridId: 'g-future-doc-no-content',
      async loadBundle() { return { docVersion: 1, gridLevelData: {} } as any; },
      async saveBundle() {},
      async loadWorkspace() { return null; },
      async saveWorkspace() { throw new Error('save refused: stored config is a newer docVersion'); },
      async clearWorkspace() {},
      async hasWorkspace() { return false; },
      async getActiveProfileId() { return 'default'; },
      async setActiveProfileId() { throw new Error('save refused: stored config is a newer docVersion'); },
      async list() { return []; },
      async load() { return null; },
      async save() {},
      async remove() {},
    };

    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ext = new VelocityGridExt(host, { ...opts(), ext: { profiles: { store, initialId: 'default' } } });

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
    // The ctor's own bootstrap().catch(...) is what logged this, not
    // syncActivePointer's internal one (that path is never reached here).
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('profile bootstrap failed'),
      expect.any(Error),
    );

    error.mockRestore();
    ext.destroy();
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

  it('hasPersistedConfig()/clearPersistedConfig() warn once (not silently) on a fully async-only ConfigSession (MINOR 8)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const store = new FullyAsyncConfigSession('g-fully-async');
    const ext = new VelocityGridExt(host, {
      ...opts(), gridId: 'g-fully-async', ext: { profiles: { store } },
    });

    ext.persistConfig();
    await Promise.resolve();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // No hasWorkspaceSync — degrades to `false`, but must warn (not
    // silently lie that nothing is persisted).
    expect(ext.hasPersistedConfig()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(ext.hasPersistedConfig()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1); // one-time warning — no repeat

    // No clearWorkspaceSync — must warn that nothing was actually cleared,
    // distinct warning from the has() one above.
    ext.clearPersistedConfig();
    expect(warn).toHaveBeenCalledTimes(2);
    ext.clearPersistedConfig();
    expect(warn).toHaveBeenCalledTimes(2); // one-time warning per method — no repeat
    warn.mockRestore();

    // The async path still actually works (async-only just means no sync
    // shortcut, not "broken").
    expect(await store.hasWorkspace()).toBe(true);
    await store.clearWorkspace();
    expect(await store.hasWorkspace()).toBe(false);

    ext.destroy();
  });
});
