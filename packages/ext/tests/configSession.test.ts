import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LocalStorageConfigSession,
  extractGridLevelData,
  applyGridLevelDataToState,
  instanceStorageKey,
  normalizeInstanceDoc,
  LEGACY_CONFIG_PREFIX,
  LEGACY_PROFILES_KEY,
  INSTANCE_DOC_VERSION,
  futureDocVersion,
  _resetFutureDocWarnings_forTests,
} from '../src/profiles/configSession';
import type { ProfileSnapshot } from '../src/extension/types';
import type { GridState } from '@wellsfargo-starui/velocity-grid';
import { MemoryStore } from '@wellsfargo-starui/velocity-grid-data/storage';
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

describe('normalizeInstanceDoc', () => {
  it('flattens legacy profiles[] docs (prefers top-level layouts)', () => {
    const flat = normalizeInstanceDoc({
      version: 1,
      activeProfileId: 'default',
      profiles: [
        {
          meta: { id: 'default', name: 'Default', updatedAt: 1 },
          gridState: {
            version: 4,
            filterModel: { a: { filterType: 'text', type: 'contains', filter: 'nested' } },
            modules: { 'data-provider': { version: 1, data: { activeProviderId: 'from-profile' } } },
          },
          ext: {},
        },
      ],
      gridLevelData: { activeProviderId: 'from-gld' },
      layouts: { version: 1, activeLayoutId: 'L1', layouts: [{ id: 'L1', name: 'One' }], grid: {} },
    });
    expect(flat).toBeTruthy();
    expect(flat!.docVersion).toBe(INSTANCE_DOC_VERSION);
    expect((flat as any).profiles).toBeUndefined();
    expect((flat as any).activeProfileId).toBeUndefined();
    expect(flat!.layouts).toEqual({
      version: 1,
      activeLayoutId: 'L1',
      layouts: [{ id: 'L1', name: 'One' }],
      grid: {},
    });
    expect(flat!.gridLevelData.activeProviderId).toBe('from-profile');
    expect((flat as any).filterModel).toBeTruthy();
    expect(flat!.meta?.id).toBe('default');
  });
});

/**
 * D-F12 — a document written by a NEWER build must survive this build
 * untouched. Before the guard: the flat-doc branch matched it on shape,
 * restamped `docVersion` down to 1, `needsRewrite` saw `2 !== 1` and
 * PERSISTED that downgrade on the very first read — silently destroying
 * whatever the newer build had stored.
 */
describe('forward-compat: future docVersion (D-F12)', () => {
  const FUTURE = {
    docVersion: INSTANCE_DOC_VERSION + 1,
    version: 4,
    gridLevelData: { activeProviderId: 'prov-future' },
    columnState: [{ colId: 'a', width: 100 }],
    somethingThisBuildHasNeverHeardOf: { deep: ['payload'] },
  };

  beforeEach(() => {
    _resetFutureDocWarnings_forTests();
  });

  it('normalizeInstanceDoc preserves the future version instead of downgrading it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = normalizeInstanceDoc(FUTURE);
    expect(doc).toBeTruthy();
    expect(doc!.docVersion).toBe(INSTANCE_DOC_VERSION + 1);
    expect(doc!.gridLevelData.activeProviderId).toBe('prov-future');
    // Unknown fields ride through — this build must not strip what it can't read.
    expect((doc as any).somethingThisBuildHasNeverHeardOf).toEqual({ deep: ['payload'] });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('futureDocVersion only fires for versions ABOVE the current one', () => {
    expect(futureDocVersion({ docVersion: INSTANCE_DOC_VERSION })).toBeNull();
    expect(futureDocVersion({ docVersion: INSTANCE_DOC_VERSION - 1 })).toBeNull();
    expect(futureDocVersion({ docVersion: INSTANCE_DOC_VERSION + 1 })).toBe(INSTANCE_DOC_VERSION + 1);
    expect(futureDocVersion({})).toBeNull();
    expect(futureDocVersion({ docVersion: 'nope' })).toBeNull();
    expect(futureDocVersion(null)).toBeNull();
  });

  it('a future-version doc survives a full load/save cycle byte-for-byte', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const key = instanceStorageKey('gf');
    const onDisk = JSON.stringify(FUTURE);
    localStorage.setItem(key, onDisk);

    const s = new LocalStorageConfigSession('gf');
    // Load: readable, and reading alone must not rewrite (the old
    // `needsRewrite` path wrote on the very first read).
    const loaded = await s.loadWorkspace();
    expect(loaded).toBeTruthy();
    expect(localStorage.getItem(key)).toBe(onDisk);

    // Save: refused rather than downgraded — AND the caller is told, not
    // just left with a resolved promise and nothing on disk (final review).
    await expect(
      s.saveWorkspace({ version: 4, columnState: [{ colId: 'b', width: 999 }] } as any),
    ).rejects.toThrow(/save refused/);
    expect(localStorage.getItem(key)).toBe(onDisk);

    await expect(s.setActiveProfileId('other')).rejects.toThrow(/save refused/);
    expect(localStorage.getItem(key)).toBe(onDisk);

    expect(warn).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it('every refused save is logged, not just the first (unlike the read-path warn-once)', async () => {
    // `warnFutureDoc`'s warn-once-per-version dedup exists for the READ
    // path (`loadWorkspace` runs on every load — must not become console
    // spam). A refused SAVE is a much rarer, user-triggered event; deduping
    // it against the read-path warning for the same version would make
    // every save after the first completely silent.
    const key = instanceStorageKey('gs');
    localStorage.setItem(key, JSON.stringify(FUTURE));
    const s = new LocalStorageConfigSession('gs');

    // Exhaust the read-path's warn-once for this version first.
    await s.loadWorkspace();

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(s.saveWorkspace({ version: 4 } as any)).rejects.toThrow();
    await expect(s.saveWorkspace({ version: 4 } as any)).rejects.toThrow();
    await expect(s.saveWorkspace({ version: 4 } as any)).rejects.toThrow();

    expect(error).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });

  it('a CURRENT-version doc is still rewritten/migrated as before', async () => {
    const key = instanceStorageKey('gc');
    // Legacy shape (no docVersion) — must still migrate in place on read.
    localStorage.setItem(key, JSON.stringify({ version: 4, columnState: [{ colId: 'a' }] }));
    const s = new LocalStorageConfigSession('gc');
    await s.loadWorkspace();
    expect(JSON.parse(localStorage.getItem(key)!).docVersion).toBe(INSTANCE_DOC_VERSION);

    await s.saveWorkspace({ version: 4, columnState: [{ colId: 'b', width: 999 }] } as any);
    const after = JSON.parse(localStorage.getItem(key)!);
    expect(after.docVersion).toBe(INSTANCE_DOC_VERSION);
    expect(after.columnState).toEqual([{ colId: 'b', width: 999 }]);
  });
});

describe('LocalStorageConfigSession', () => {
  it('persists a flat workspace (no profiles[]) under the instance key', async () => {
    const s = new LocalStorageConfigSession('g1');
    await s.saveWorkspace({
      version: 4,
      filterModel: { a: { filterType: 'text', type: 'contains', filter: 'x' } } as any,
      layouts: { version: 1, activeLayoutId: 'default', layouts: [], grid: {} } as any,
      modules: { 'data-provider': { version: 1, data: { activeProviderId: 'prov-a' } } },
    } as any);

    const raw = JSON.parse(localStorage.getItem(instanceStorageKey('g1'))!);
    expect(raw.docVersion).toBe(INSTANCE_DOC_VERSION);
    expect(raw.profiles).toBeUndefined();
    expect(raw.activeProfileId).toBeUndefined();
    expect(raw.gridLevelData.activeProviderId).toBe('prov-a');
    expect(raw.layouts).toBeTruthy();
    expect(raw.version).toBe(4);

    const loaded = await s.loadWorkspace();
    expect(loaded?.modules?.['data-provider']?.data).toEqual({
      activeProviderId: 'prov-a',
    });
    expect(loaded?.layouts).toBeTruthy();

    const facade = await s.load('default');
    expect(facade?.gridState.modules?.['data-provider']?.data).toEqual({
      activeProviderId: 'prov-a',
    });
    expect(await s.getActiveProfileId()).toBe('default');
  });

  it('migrates profiles[] instance docs to flat on read and rewrites storage', async () => {
    localStorage.setItem(
      instanceStorageKey('g-mig'),
      JSON.stringify({
        version: 1,
        activeProfileId: 'default',
        profiles: [snap('default', 'old-prov')],
        gridLevelData: { activeProviderId: 'old-prov' },
        layouts: { version: 1, activeLayoutId: 'default', layouts: [], grid: {} },
      }),
    );

    const s = new LocalStorageConfigSession('g-mig');
    const ws = await s.loadWorkspace();
    expect(ws?.modules?.['data-provider']?.data).toEqual({ activeProviderId: 'old-prov' });
    expect(ws?.layouts).toBeTruthy();

    const rewritten = JSON.parse(localStorage.getItem(instanceStorageKey('g-mig'))!);
    expect(rewritten.docVersion).toBe(INSTANCE_DOC_VERSION);
    expect(rewritten.profiles).toBeUndefined();
    expect(rewritten.activeProfileId).toBeUndefined();
    expect(rewritten.gridLevelData.activeProviderId).toBe('old-prov');
  });

  it('migrates legacy config + flat profiles into a flat instance doc', async () => {
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
    const doc = await s.loadBundle();
    expect(doc.layouts).toBeTruthy();
    expect(doc.gridLevelData.activeProviderId).toBe('legacy-p');
    expect((doc as any).profiles).toBeUndefined();
    // Single-slot facade meta from legacy config seed
    expect(doc.meta?.id).toBe('default');
    expect(localStorage.getItem(instanceStorageKey('g2'))).toBeTruthy();

    const stored = JSON.parse(localStorage.getItem(instanceStorageKey('g2'))!);
    expect(stored.docVersion).toBe(INSTANCE_DOC_VERSION);
    expect(stored.profiles).toBeUndefined();
  });

  it('ProfileStore facade is a single slot over the flat doc', async () => {
    const s = new LocalStorageConfigSession('g3');
    await s.save('default', snap('default', 'p1'));
    expect((await s.list()).map((m) => m.id)).toEqual(['default']);
    // Second save replaces the single slot (not a profiles array)
    await s.save('default', snap('default', 'p2'));
    const loaded = await s.load('default');
    expect(loaded?.gridState.modules?.['data-provider']?.data).toEqual({
      activeProviderId: 'p2',
    });
    await s.remove('default');
    expect(await s.list()).toEqual([]);
    expect(await s.loadWorkspace()).toBeNull();
  });

  it('saveWorkspace round-trips data-provider activeProviderId', async () => {
    const s = new LocalStorageConfigSession('g4');
    await s.saveWorkspace({
      version: 4,
      modules: { 'data-provider': { version: 1, data: { activeProviderId: 'stomp-ssrm' } } },
    } as any);
    const again = new LocalStorageConfigSession('g4');
    const ws = await again.loadWorkspace();
    expect(ws?.modules?.['data-provider']?.data).toEqual({
      activeProviderId: 'stomp-ssrm',
    });
  });

  it('cleared rowGroupColumns stay cleared across saveWorkspace (no merge resurrection)', async () => {
    const s = new LocalStorageConfigSession('g-ungroup');
    await s.saveWorkspace({
      version: 4,
      rowGroupColumns: ['desk', 'region'],
      columnState: [
        { colId: 'desk', rowGroup: true, rowGroupIndex: 0 },
        { colId: 'region', rowGroup: true, rowGroupIndex: 1 },
      ],
    } as any);

    // Ungroup → getState() omits rowGroupColumns (empty slices are dropped).
    await s.saveWorkspace({
      version: 4,
      columnState: [
        { colId: 'desk', rowGroup: false },
        { colId: 'region', rowGroup: false },
      ],
    } as any);

    const raw = JSON.parse(localStorage.getItem(instanceStorageKey('g-ungroup'))!);
    expect(raw.rowGroupColumns).toBeUndefined();

    const loaded = await s.loadWorkspace();
    expect(loaded?.rowGroupColumns).toBeUndefined();
  });

  it('strips data-provider from layout snapshots on save (grid-level only)', async () => {
    const s = new LocalStorageConfigSession('g5');
    await s.saveWorkspace({
      version: 4,
      modules: { 'data-provider': { version: 1, data: { activeProviderId: 'grid-prov' } } },
      layouts: {
        version: 1,
        activeLayoutId: 'L1',
        layouts: [
          {
            id: 'L1',
            name: 'One',
            createdAt: 1,
            updatedAt: 1,
            state: {
              version: 4,
              modules: {
                'data-provider': { version: 1, data: { activeProviderId: 'layout-prov' } },
                columnGroups: { version: 1, data: { x: 1 } },
              },
            },
          },
        ],
        grid: {},
      },
    } as any);
    const raw = JSON.parse(localStorage.getItem(instanceStorageKey('g5'))!);
    const layoutMods = raw.layouts.layouts[0].state.modules;
    expect(layoutMods['data-provider']).toBeUndefined();
    expect(layoutMods.columnGroups).toEqual({ version: 1, data: { x: 1 } });
    expect(raw.gridLevelData.activeProviderId).toBe('grid-prov');
    // Root modules must not carry data-provider — gridLevelData is authoritative
    expect(raw.modules?.['data-provider']).toBeUndefined();
  });

  it('keeps activeProviderId in gridLevelData across a null-modules save (restore race)', async () => {
    const s = new LocalStorageConfigSession('g6');
    await s.saveWorkspace({
      version: 4,
      modules: { 'data-provider': { version: 1, data: { activeProviderId: 'stomp-ssrm' } } },
    } as any);
    // Premature persist before StateModule restore — no data-provider slice.
    await s.saveWorkspace({
      version: 4,
      modules: { calc: { version: 1, data: {} } },
      layouts: {
        version: 1,
        activeLayoutId: 'L2',
        layouts: [{ id: 'default', name: 'Default', state: { version: 4 } }],
        grid: {},
      },
    } as any);
    const raw = JSON.parse(localStorage.getItem(instanceStorageKey('g6'))!);
    // Without a data-provider module in the payload, extract is {} and prior gld is kept.
    expect(raw.gridLevelData.activeProviderId).toBe('stomp-ssrm');
    const ws = await s.loadWorkspace();
    expect(ws?.modules?.['data-provider']?.data).toEqual({ activeProviderId: 'stomp-ssrm' });
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
    const raw = JSON.parse(localStorage.getItem(instanceStorageKey('grid1'))!);
    expect(raw.docVersion).toBe(INSTANCE_DOC_VERSION);
    expect(raw.profiles).toBeUndefined();
    const loaded = loadConfigFromLocalStorage('grid1') as any;
    expect(loaded.modules['data-provider'].data.activeProviderId).toBe('p1');
    expect(loaded.layouts).toBeTruthy();
    clearConfigFromLocalStorage('grid1');
    expect(hasConfigInLocalStorage('grid1')).toBe(false);
  });

  it('accepts an injected MemoryStore shared across helpers', () => {
    const storage = new MemoryStore();
    const config = {
      version: 4,
      modules: { 'data-provider': { version: 1, data: { activeProviderId: 'mem' } } },
    };
    saveConfigToLocalStorage('grid-mem', config, storage);
    expect(hasConfigInLocalStorage('grid-mem', storage)).toBe(true);
    expect(storage.getItem(instanceStorageKey('grid-mem'))).toBeTruthy();
    expect(localStorage.getItem(instanceStorageKey('grid-mem'))).toBeNull();
    const loaded = loadConfigFromLocalStorage('grid-mem', storage) as any;
    expect(loaded.modules['data-provider'].data.activeProviderId).toBe('mem');
    clearConfigFromLocalStorage('grid-mem', storage);
    expect(hasConfigInLocalStorage('grid-mem', storage)).toBe(false);
  });
});
