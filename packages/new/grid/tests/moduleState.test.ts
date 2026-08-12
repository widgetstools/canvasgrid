/**
 * Cycle 21i Phase 2 / T2 — module-state registry unit tests.
 *
 * The registry folds named, versioned engine-state slices into
 * `GridState.modules` (`{ [id]: { version, data } }` envelopes — the
 * ConfigManager profile-bundle shape) and restores them gracefully
 * per-slice: an unknown module id or a throwing `set()` skips that
 * slice with a dev warning while the rest of the snapshot applies.
 *
 * The v3→v4 snapshot migration relocates the legacy top-level
 * `columnGroupDefs` / `columnGroupOpen` fields (Cycle 21i Task 6/8)
 * into the `modules.columnGroups` envelope so `setState` has ONE
 * restore path — the compat fixtures here pin that pre-Phase-2
 * snapshots still restore.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModuleStateRegistry, type StateModule } from '../src/core/moduleState';
import { migrateSnapshot, STATE_SCHEMA_VERSION, type GridState } from '../src/core/stateSnapshot';

function makeModule(id: string, overrides?: Partial<StateModule>): StateModule & { received: Array<{ data: unknown; version: number }> } {
  const received: Array<{ data: unknown; version: number }> = [];
  return {
    id,
    version: 1,
    get: () => ({ marker: id }),
    set: (data, version) => { received.push({ data, version }); },
    received,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ModuleStateRegistry', () => {
  it('snapshots every registered module under its {version, data} envelope', () => {
    const registry = new ModuleStateRegistry();
    registry.register(makeModule('alpha'));
    registry.register(makeModule('beta', { version: 3, get: () => [1, 2, 3] }));
    expect(registry.snapshot()).toEqual({
      alpha: { version: 1, data: { marker: 'alpha' } },
      beta: { version: 3, data: [1, 2, 3] },
    });
  });

  it('omits modules whose get() returns undefined/null; all-empty → undefined', () => {
    const registry = new ModuleStateRegistry();
    registry.register(makeModule('empty', { get: () => undefined }));
    registry.register(makeModule('nullish', { get: () => null }));
    expect(registry.snapshot()).toBeUndefined();
    registry.register(makeModule('full'));
    expect(Object.keys(registry.snapshot()!)).toEqual(['full']);
  });

  it('a throwing get() omits that slice with a warning; others survive', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new ModuleStateRegistry();
    registry.register(makeModule('boom', { get: () => { throw new Error('get blew up'); } }));
    registry.register(makeModule('ok'));
    expect(registry.snapshot()).toEqual({ ok: { version: 1, data: { marker: 'ok' } } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'boom'"), expect.any(Error));
  });

  it('restore hands each slice + its stored version to the matching module', () => {
    const registry = new ModuleStateRegistry();
    const mod = makeModule('alpha');
    registry.register(mod);
    registry.restore({ alpha: { version: 7, data: { restored: true } } });
    expect(mod.received).toEqual([{ data: { restored: true }, version: 7 }]);
  });

  it('a missing envelope version defaults to 1 on restore', () => {
    const registry = new ModuleStateRegistry();
    const mod = makeModule('alpha');
    registry.register(mod);
    registry.restore({ alpha: { data: { restored: true } } as never });
    expect(mod.received[0]?.version).toBe(1);
  });

  it('unknown module ids are BUFFERED (not dropped); the rest still restore', () => {
    const registry = new ModuleStateRegistry();
    const mod = makeModule('known');
    registry.register(mod);
    registry.restore({
      ghost: { version: 2, data: { keep: true } },
      known: { version: 1, data: 'yes' },
    });
    expect(mod.received).toEqual([{ data: 'yes', version: 1 }]);
    // The unclaimed slice survives in snapshots so autosave can't erase it…
    expect(registry.snapshot()!.ghost).toEqual({ version: 2, data: { keep: true } });
    // …and a late-registering module receives it (wireEditIntoKernel
    // after an await is a supported pattern).
    const ghost = makeModule('ghost');
    registry.register(ghost);
    expect(ghost.received).toEqual([{ data: { keep: true }, version: 2 }]);
    // Once claimed, the live module owns the slice (get() takes over).
    expect(registry.snapshot()!.ghost).toEqual({ version: 1, data: { marker: 'ghost' } });
  });

  it('a throwing set() warns and skips that slice; the rest still restore', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new ModuleStateRegistry();
    registry.register(makeModule('boom', { set: () => { throw new Error('set blew up'); } }));
    const ok = makeModule('ok');
    registry.register(ok);
    registry.restore({
      boom: { version: 1, data: {} },
      ok: { version: 1, data: 'applied' },
    });
    expect(ok.received).toEqual([{ data: 'applied', version: 1 }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'boom'"), expect.any(Error));
  });

  it('re-registering an id warns and replaces; unregister removes only its own registration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new ModuleStateRegistry();
    const first = makeModule('dup', { get: () => 'first' });
    const unregisterFirst = registry.register(first);
    const second = makeModule('dup', { get: () => 'second' });
    registry.register(second);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'dup'"));
    expect(registry.snapshot()).toEqual({ dup: { version: 1, data: 'second' } });
    // The stale unregister from the replaced registration is a no-op.
    unregisterFirst();
    expect(registry.snapshot()).toEqual({ dup: { version: 1, data: 'second' } });
  });

  it('notifyChanged fans the module id into the onChanged callback', () => {
    const changed: string[] = [];
    const registry = new ModuleStateRegistry((id) => changed.push(id));
    registry.notifyChanged('rules');
    expect(changed).toEqual(['rules']);
  });
});

describe('v3 → v4 snapshot migration (pre-Phase-2 compat)', () => {
  it('relocates legacy columnGroupDefs + columnGroupOpen into modules.columnGroups', () => {
    const legacy: GridState = {
      version: 3,
      columnState: [{ colId: 'a' } as never],
      columnGroupDefs: [{ kind: 'group', id: 'G', parentId: null } as never],
      columnGroupOpen: [{ groupId: 'G', open: false }],
      sortModel: [{ colId: 'a', sort: 'asc' }] as never,
    };
    const migrated = migrateSnapshot(legacy);
    expect(migrated.version).toBe(STATE_SCHEMA_VERSION);
    expect(migrated.columnGroupDefs).toBeUndefined();
    expect(migrated.columnGroupOpen).toBeUndefined();
    expect(migrated.modules).toEqual({
      columnGroups: {
        version: 1,
        data: {
          defs: [{ kind: 'group', id: 'G', parentId: null }],
          open: [{ groupId: 'G', open: false }],
        },
      },
    });
    // Untouched fields ride through unchanged.
    expect(migrated.columnState).toEqual(legacy.columnState);
    expect(migrated.sortModel).toEqual(legacy.sortModel);
  });

  it('a v3 snapshot without group fields passes through with no modules key', () => {
    const legacy: GridState = { version: 3, sortModel: [{ colId: 'a', sort: 'asc' }] as never };
    const migrated = migrateSnapshot(legacy);
    expect(migrated.version).toBe(STATE_SCHEMA_VERSION);
    expect(migrated.modules).toBeUndefined();
  });

  it('a v1 snapshot chains v1→v2→v3→v4 and lands relocated', () => {
    const ancient = {
      version: 1,
      columnGroupDefs: [{ kind: 'group', id: 'G', parentId: null }],
    } as GridState;
    const migrated = migrateSnapshot(ancient);
    expect(migrated.version).toBe(STATE_SCHEMA_VERSION);
    expect(migrated.modules?.columnGroups.data).toEqual({
      defs: [{ kind: 'group', id: 'G', parentId: null }],
    });
  });
});

// Grid Layouts — Phase B / B5: `clearAbsent` — an exhaustive (layout-switch)
// restore must CLEAR layout-tier module slices the incoming layout omits, so
// switching to a layout without calc columns / template assignments doesn't
// leak the outgoing layout's slices. Grid-tier ids (shared) are preserved.
describe('ModuleStateRegistry.clearAbsent', () => {
  it('clears registered modules absent from `present`, preserving `preserve` (grid-tier) ids', () => {
    const registry = new ModuleStateRegistry();
    const calc = makeModule('calc');
    const overrides = makeModule('columnOverrides');
    const templates = makeModule('templates'); // grid-tier — must survive
    registry.register(calc);
    registry.register(overrides);
    registry.register(templates);

    // incoming layout carries only `calc`; templates is grid-tier
    registry.clearAbsent(new Set(['calc']), new Set(['templates', 'editSettings']));

    // `columnOverrides` cleared via set(undefined); calc + templates untouched
    expect(overrides.received).toEqual([{ data: undefined, version: 1 }]);
    expect(calc.received).toEqual([]);       // present → not cleared
    expect(templates.received).toEqual([]);  // grid-tier → preserved
  });

  it('clears ALL layout-tier modules when the incoming layout carries none', () => {
    const registry = new ModuleStateRegistry();
    const calc = makeModule('calc');
    const overrides = makeModule('columnOverrides');
    registry.register(calc);
    registry.register(overrides);

    registry.clearAbsent(new Set(), new Set(['templates']));
    expect(calc.received).toEqual([{ data: undefined, version: 1 }]);
    expect(overrides.received).toEqual([{ data: undefined, version: 1 }]);
  });

  it('a throwing module clear is isolated (warns, others still clear)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new ModuleStateRegistry();
    const bad = makeModule('bad', { set: () => { throw new Error('boom'); } });
    const good = makeModule('good');
    registry.register(bad);
    registry.register(good);

    expect(() => registry.clearAbsent(new Set(), new Set())).not.toThrow();
    expect(good.received).toEqual([{ data: undefined, version: 1 }]);
  });
});
