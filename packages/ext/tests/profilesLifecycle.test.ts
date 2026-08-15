import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGridTestEnv } from './setup';
import { VelocityGrid } from '@wellsfargo-starui/velocity-grid';
import { ProfilesController } from '../src/profiles/controller';
import { LocalStorageConfigSession } from '../src/profiles/configSession';
import type { ConfigSession, WorkspaceConfig } from '../src/profiles/configSession';
import type { ProfileMeta, ProfileSnapshot } from '../src/extension/types';

beforeAll(() => installGridTestEnv());
beforeEach(() => localStorage.clear());

function makeGrid(): VelocityGrid {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new VelocityGrid(host, {
    getRowId: (r: any) => r.a,
    columnDefs: [{ colId: 'a', field: 'a' }],
    rowData: [],
  } as any);
}

/** A ConfigSession whose `loadWorkspace()` only settles when the test calls
 *  the returned `release` — simulates a slow/late store round-trip racing
 *  `ProfilesController.dispose()` (D-F2). Every other member resolves
 *  immediately so the gate isolates exactly the one await under test. */
function makeGatedConfigSession(seed: { meta?: ProfileMeta; workspace?: WorkspaceConfig } = {}) {
  let release!: (v: WorkspaceConfig | null) => void;
  const gate = new Promise<WorkspaceConfig | null>((r) => { release = r; });
  let activeId = seed.meta?.id ?? 'default';
  const session: ConfigSession = {
    gridId: 'gated',
    async loadBundle() { return { docVersion: 1, gridLevelData: {} } as any; },
    async saveBundle() {},
    async loadWorkspace() { return gate; },
    async saveWorkspace() {},
    async clearWorkspace() {},
    async hasWorkspace() { return false; },
    async getActiveProfileId() { return activeId; },
    async setActiveProfileId(id: string) { activeId = id; },
    async list() { return seed.meta ? [seed.meta] : []; },
    async load(id: string): Promise<ProfileSnapshot | null> {
      if (seed.meta && id === seed.meta.id) {
        return { meta: seed.meta, gridState: (seed.workspace ?? { version: 4 }) as any, ext: {} };
      }
      return null;
    },
    async save() {},
    async remove() {},
  };
  return { session, release };
}

describe('ProfilesController.dispose — cancellable bootstrap/switchTo (D-F2)', () => {
  it('runBootstrap continuation after dispose() does not call grid.setState', async () => {
    const grid = makeGrid();
    const { session, release } = makeGatedConfigSession();
    const profiles = new ProfilesController(grid, session, { initialId: 'default' });
    const setStateSpy = vi.spyOn(grid, 'setState');

    const boot = profiles.bootstrap();
    profiles.dispose();
    release({ version: 4 } as any);
    await boot;

    expect(setStateSpy).not.toHaveBeenCalled();
    grid.destroy();
  });

  it('switchTo continuation after dispose() does not call grid.setState', async () => {
    const grid = makeGrid();
    const meta: ProfileMeta = { id: 'saved', name: 'Saved', updatedAt: 1 };
    const { session, release } = makeGatedConfigSession({ meta, workspace: { version: 4 } as any });
    const profiles = new ProfilesController(grid, session, { initialId: 'default' });
    const setStateSpy = vi.spyOn(grid, 'setState');

    const switching = profiles.switchTo('saved');
    profiles.dispose();
    release({ version: 4 } as any);
    await switching;

    expect(setStateSpy).not.toHaveBeenCalled();
    grid.destroy();
  });

  it('dispose() is idempotent and safe to call before any bootstrap/switchTo', async () => {
    const grid = makeGrid();
    const { session } = makeGatedConfigSession();
    const profiles = new ProfilesController(grid, session, { initialId: 'default' });
    expect(() => { profiles.dispose(); profiles.dispose(); }).not.toThrow();
    grid.destroy();
  });
});

describe('ProfilesController.bootstrap adopts the persisted active id (D-F5)', () => {
  it('adopts store.getActiveProfileId() over the ctor initialId, and discard() actually reverts', async () => {
    const grid1 = makeGrid();
    const session = new LocalStorageConfigSession('df5-grid');
    const profiles1 = new ProfilesController(grid1, session, { initialId: 'default' });
    // saveAs persists a snapshot under a NEW id and sets it active — the
    // stored doc's meta.id now diverges from the ctor's 'default'.
    const id = await profiles1.saveAs('Trader Desk');
    expect(id).toBe('trader-desk');
    grid1.destroy();

    const grid2 = makeGrid();
    const profiles2 = new ProfilesController(grid2, session, { initialId: 'default' });
    await profiles2.bootstrap();

    // Pre-fix: bootstrap never read the stored pointer, so `activeId()`
    // stayed 'default' and syncActivePointer() clobbered the persisted
    // 'trader-desk' back to 'default'.
    expect(profiles2.activeId()).toBe('trader-desk');

    profiles2.markDirty();
    expect(profiles2.isDirty()).toBe(true);
    // Pre-fix: discard() == switchTo(this.id) == switchTo('default'), and the
    // single-slot facade's load('default') returns null (meta.id is
    // 'trader-desk') — a silent no-op, dirty stays true.
    await profiles2.discard();
    expect(profiles2.isDirty()).toBe(false);
    expect(profiles2.activeId()).toBe('trader-desk');

    grid2.destroy();
  });
});
