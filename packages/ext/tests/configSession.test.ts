import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalStorageConfigSession,
  extractGridLevelData,
  applyGridLevelDataToState,
  instanceStorageKey,
  LEGACY_CONFIG_PREFIX,
  LEGACY_PROFILES_KEY,
} from '../src/profiles/configSession';
import type { ProfileSnapshot } from '../src/extension/types';
import type { GridState } from '@wellsfargo-starui/velocity-grid';
import {
  saveConfigToLocalStorage,
  loadConfigFromLocalStorage,
  hasConfigInLocalStorage,
  clearConfigFromLocalStorage,
} from '../src/configStorage';

const stateWithProvider = (id: string | null): GridState => ({
  version: 4,
  modules: {
    'data-provider': { version: 1, data: { activeProviderId: id } },
  },
} as GridState);

const snap = (id: string, providerId?: string | null): ProfileSnapshot => ({
  meta: { id, name: id, updatedAt: 1 },
  gridState: providerId === undefined
    ? ({ version: 4 } as GridState)
    : stateWithProvider(providerId),
  ext: {},
});

beforeEach(() => localStorage.clear());

describe('extractGridLevelData / applyGridLevelDataToState', () => {
  it('round-trips activeProviderId through gridLevelData', () => {
    const gld = extractGridLevelData(stateWithProvider('pos-live'));
    expect(gld.activeProviderId).toBe('pos-live');
    const applied = applyGridLevelDataToState({ version: 4 } as GridState, gld);
    expect(applied.modules?.['data-provider']?.data).toEqual({ activeProviderId: 'pos-live' });
  });
});

describe('LocalStorageConfigSession', () => {
  it('persists profiles + layouts + gridLevelData under instance key', async () => {
    const s = new LocalStorageConfigSession('g1');
    await s.save('default', snap('default', 'prov-a'));
    await s.saveWorkspace({
      version: 4,
      filterModel: { a: { filterType: 'text', type: 'contains', filter: 'x' } } as any,
      layouts: { version: 1, activeLayoutId: 'default', layouts: [], grid: {} } as any,
      modules: { 'data-provider': { version: 1, data: { activeProviderId: 'prov-a' } } },
    } as any);

    expect(localStorage.getItem(instanceStorageKey('g1'))).toBeTruthy();
    const bundle = await s.loadBundle();
    expect(bundle.gridLevelData.activeProviderId).toBe('prov-a');
    expect(bundle.layouts).toBeTruthy();
    expect(bundle.activeProfileId).toBe('default');

    const loaded = await s.load('default');
    expect(loaded?.gridState.modules?.['data-provider']?.data).toEqual({
      activeProviderId: 'prov-a',
    });
  });

  it('migrates legacy config + flat profiles into the instance bundle', async () => {
    localStorage.setItem(
      `${LEGACY_CONFIG_PREFIX}g2`,
      JSON.stringify({
        version: 4,
        layouts: { version: 1, activeLayoutId: 'L1', layouts: [{ id: 'L1', name: 'One' }], grid: {} },
        modules: { 'data-provider': { version: 1, data: { activeProviderId: 'legacy-p' } } },
      }),
    );
    localStorage.setItem(
      LEGACY_PROFILES_KEY,
      JSON.stringify({
        narrow: snap('narrow', 'legacy-p'),
      }),
    );

    const s = new LocalStorageConfigSession('g2');
    const bundle = await s.loadBundle();
    expect(bundle.layouts).toBeTruthy();
    expect(bundle.gridLevelData.activeProviderId).toBe('legacy-p');
    expect(bundle.profiles.some((p) => p.meta.id === 'narrow')).toBe(true);
    // Legacy config also seeds a 'default' profile from the workspace view.
    expect(bundle.profiles.some((p) => p.meta.id === 'default')).toBe(true);
    // Subsequent reads use the instance key (no re-migrate wipe).
    expect(localStorage.getItem(instanceStorageKey('g2'))).toBeTruthy();
  });

  it('ProfileStore list/remove stay consistent with the bundle', async () => {
    const s = new LocalStorageConfigSession('g3');
    await s.save('a', snap('a'));
    await s.save('b', snap('b'));
    expect((await s.list()).map((m) => m.id).sort()).toEqual(['a', 'b']);
    await s.remove('a');
    expect((await s.list()).map((m) => m.id)).toEqual(['b']);
    expect(await s.getActiveProfileId()).toBe('b');
  });
});

describe('configStorage helpers route through ConfigSession', () => {
  it('round-trips via velocity-grid:instance:<gridId>', () => {
    const config = {
      version: 4,
      layouts: { version: 1, activeLayoutId: 'default', layouts: [], grid: {} },
      modules: { 'data-provider': { version: 1, data: { activeProviderId: 'p1' } } },
    };
    saveConfigToLocalStorage('grid1', config);
    expect(hasConfigInLocalStorage('grid1')).toBe(true);
    expect(localStorage.getItem(instanceStorageKey('grid1'))).toBeTruthy();
    const loaded = loadConfigFromLocalStorage('grid1') as any;
    expect(loaded.modules['data-provider'].data.activeProviderId).toBe('p1');
    expect(loaded.layouts).toBeTruthy();
    clearConfigFromLocalStorage('grid1');
    expect(hasConfigInLocalStorage('grid1')).toBe(false);
  });
});
