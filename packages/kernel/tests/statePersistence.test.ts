// Cycle 21i / Phase 1 (T2) — native state persistence unit tests.
//
// `core/statePersistence.ts` provides the restore-then-autosave controller
// behind the `gridId` + `persistState` options, plus the default
// localStorage adapter. The controller contract under test:
//   - restore(): adapter.load → applyState (only when a snapshot exists),
//     THEN arms the autosave subscription (construction-time emits before
//     restore can never clobber the saved snapshot)
//   - autosave: debounced; latest snapshot wins; flush() bypasses
//   - clear(): drops pending write + delegates to adapter.clear
//   - destroy(): unsubscribes and flushes the pending snapshot
//   - adapter failures degrade to warnings, never throw out

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StatePersistenceController,
  LocalStorageStateAdapter,
  persistenceStorageKey,
  type StateStorageAdapter,
} from '../src/core/statePersistence';
import type { GridState } from '../src/core/stateSnapshot';

const snap = (marker: number): GridState =>
  ({ version: 1, scroll: { top: marker, left: 0 } }) as unknown as GridState;

function makeHooks() {
  let listener: ((state: GridState) => void) | null = null;
  const applied: GridState[] = [];
  const unsubscribe = vi.fn(() => { listener = null; });
  return {
    hooks: {
      applyState: (s: GridState) => { applied.push(s); },
      onStateUpdated: (fn: (state: GridState) => void) => {
        listener = fn;
        return unsubscribe;
      },
    },
    emit: (s: GridState) => listener?.(s),
    isArmed: () => listener !== null,
    applied,
    unsubscribe,
  };
}

function makeAdapter(initial: GridState | null = null): StateStorageAdapter & {
  saves: Array<{ gridId: string; state: GridState }>;
  cleared: string[];
} {
  return {
    saves: [],
    cleared: [],
    load: () => initial,
    save(gridId: string, state: GridState) { this.saves.push({ gridId, state }); },
    clear(gridId: string) { this.cleared.push(gridId); },
  };
}

describe('StatePersistenceController', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('restores a saved snapshot then arms autosave', async () => {
    const saved = snap(42);
    const adapter = makeAdapter(saved);
    const h = makeHooks();
    const ctrl = new StatePersistenceController('g1', { adapter }, h.hooks);

    expect(h.isArmed()).toBe(false);
    await ctrl.restore();
    expect(h.applied).toEqual([saved]);
    expect(h.isArmed()).toBe(true);
  });

  it('skips applyState when nothing is saved, still arms autosave', async () => {
    const adapter = makeAdapter(null);
    const h = makeHooks();
    const ctrl = new StatePersistenceController('g1', { adapter }, h.hooks);
    await ctrl.restore();
    expect(h.applied).toEqual([]);
    expect(h.isArmed()).toBe(true);
  });

  it('debounces autosave — latest snapshot wins, one write', async () => {
    const adapter = makeAdapter();
    const h = makeHooks();
    const ctrl = new StatePersistenceController('g1', { adapter, debounceMs: 100 }, h.hooks);
    await ctrl.restore();

    h.emit(snap(1));
    vi.advanceTimersByTime(50);
    h.emit(snap(2));
    vi.advanceTimersByTime(50);
    expect(adapter.saves).toHaveLength(0); // debounce restarted at t=50
    vi.advanceTimersByTime(50);
    expect(adapter.saves).toHaveLength(1);
    expect((adapter.saves[0]!.state as ReturnType<typeof snap>).scroll!.top).toBe(2);
    expect(adapter.saves[0]!.gridId).toBe('g1');
  });

  it('clear() drops the pending write and delegates to the adapter', async () => {
    const adapter = makeAdapter();
    const h = makeHooks();
    const ctrl = new StatePersistenceController('g1', { adapter, debounceMs: 100 }, h.hooks);
    await ctrl.restore();

    h.emit(snap(7));
    ctrl.clear();
    vi.advanceTimersByTime(200);
    expect(adapter.saves).toHaveLength(0);
    expect(adapter.cleared).toEqual(['g1']);
  });

  it('destroy() unsubscribes and flushes the pending snapshot', async () => {
    const adapter = makeAdapter();
    const h = makeHooks();
    const ctrl = new StatePersistenceController('g1', { adapter, debounceMs: 100 }, h.hooks);
    await ctrl.restore();

    h.emit(snap(9));
    ctrl.destroy();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(adapter.saves).toHaveLength(1); // flushed, no timer wait
    expect((adapter.saves[0]!.state as ReturnType<typeof snap>).scroll!.top).toBe(9);
  });

  it('adapter.load failure degrades to a warning and still arms autosave', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter: StateStorageAdapter = {
      load: () => { throw new Error('boom'); },
      save: () => {},
      clear: () => {},
    };
    const h = makeHooks();
    const ctrl = new StatePersistenceController('g1', { adapter }, h.hooks);
    await expect(ctrl.restore()).resolves.toBeUndefined();
    expect(h.isArmed()).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('applyState failure degrades to a warning and still arms autosave', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = makeAdapter(snap(1));
    let armed = false;
    const ctrl = new StatePersistenceController('g1', { adapter }, {
      applyState: () => { throw new Error('bad snapshot'); },
      onStateUpdated: () => { armed = true; return () => {}; },
    });
    await expect(ctrl.restore()).resolves.toBeUndefined();
    expect(armed).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('LocalStorageStateAdapter', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('round-trips a snapshot under the namespaced key', () => {
    const adapter = new LocalStorageStateAdapter();
    const state = snap(5);
    adapter.save('demo', state);
    expect(store.has(persistenceStorageKey('demo'))).toBe(true);
    expect(adapter.load('demo')).toEqual(state);
    adapter.clear('demo');
    expect(adapter.load('demo')).toBeNull();
  });

  it('returns null (with a warning) on corrupt JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.set(persistenceStorageKey('demo'), '{not json');
    const adapter = new LocalStorageStateAdapter();
    expect(adapter.load('demo')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('save failure (quota) degrades to a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    });
    const adapter = new LocalStorageStateAdapter();
    expect(() => adapter.save('demo', snap(1))).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
